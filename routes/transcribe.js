// routes/transcribe.js
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

import { optionalAuth } from '../middleware/auth.js';
import { checkUsageLimit, checkEngineAccess, recordUsage, saveTranscript } from '../middleware/usage.js';
import { transcribeGroq } from '../engines/groq.js';
import { transcribeDeepgram } from '../engines/deepgram.js';
import { transcribeAssemblyAI } from '../engines/assemblyai.js';
import { detectAndMaskPII } from '../services/pii.js';

const router = express.Router();
const upload = multer({ dest: '/tmp/', limits: { fileSize: 100 * 1024 * 1024 } });

// Give uploaded file the correct extension so Groq accepts it
function ensureExtension(filePath, originalName) {
  if (!filePath) return filePath;
  const ext = path.extname(originalName || '').toLowerCase() || '.mp3';
  const newPath = filePath + ext;
  if (!fs.existsSync(newPath)) fs.copyFileSync(filePath, newPath);
  return newPath;
}

// Download a URL to a local temp file so ALL engines can process it
async function downloadUrlToFile(audioUrl) {
  const response = await fetch(audioUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' }
  });

  if (!response.ok) {
    throw new Error(`Could not download audio (HTTP ${response.status}). Check the URL is a direct audio link.`);
  }

  // Pick file extension from Content-Type or URL path
  const contentType = response.headers.get('content-type') || '';
  let ext = '.mp3';
  if (contentType.includes('wav')) ext = '.wav';
  else if (contentType.includes('mp4') || contentType.includes('mpeg')) ext = '.mp4';
  else if (contentType.includes('m4a')) ext = '.m4a';
  else if (contentType.includes('ogg')) ext = '.ogg';
  else if (contentType.includes('webm')) ext = '.webm';
  else if (contentType.includes('flac')) ext = '.flac';
  else {
    try {
      const urlExt = path.extname(new URL(audioUrl).pathname).toLowerCase();
      if (['.mp3','.wav','.mp4','.m4a','.ogg','.webm','.flac','.opus'].includes(urlExt)) ext = urlExt;
    } catch {}
  }

  const tmpPath = `/tmp/url_${Date.now()}${ext}`;
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(tmpPath, Buffer.from(buffer));
  return tmpPath;
}

router.post('/',
  optionalAuth,
  checkUsageLimit,
  checkEngineAccess,
  upload.single('audio'),
  async (req, res) => {
    const { mode = 'fast', language = 'en', audioUrl, enablePII = 'false', title = '' } = req.body;
    const originalName = req.file?.originalname || 'audio.mp3';
    const rawPath = req.file?.path;
    const userId = req.user?.id || null;

    const tempFiles = [];
    if (rawPath) tempFiles.push(rawPath);
    let filePath = null;

    try {
      if (!rawPath && !audioUrl) {
        return res.status(400).json({ error: 'Please provide an audio file or a URL' });
      }

      // Fix extension on uploaded file so Groq accepts it
      if (rawPath) {
        filePath = ensureExtension(rawPath, originalName);
        if (filePath !== rawPath) tempFiles.push(filePath);
      }

      // Download URL to temp file — fixes the "path received null" crash
      // Groq requires a real file; Deepgram/AssemblyAI also benefit from this
      if (audioUrl && !filePath) {
        try {
          filePath = await downloadUrlToFile(audioUrl);
          tempFiles.push(filePath);
        } catch (dlErr) {
          // Groq MUST have a file — throw immediately
          if (mode === 'fast') {
            throw new Error(`Cannot fetch audio from that URL. Try switching to Balanced mode, or download the file and upload it directly.\n\nDetails: ${dlErr.message}`);
          }
          // Deepgram/AssemblyAI can accept raw URLs as fallback
          filePath = null;
        }
      }

      // Run the correct engine
      let result;
      if (mode === 'fast') {
        result = await transcribeGroq(filePath, language);
      } else if (mode === 'balanced') {
        result = await transcribeDeepgram(filePath, audioUrl, language);
      } else if (mode === 'accurate') {
        result = await transcribeAssemblyAI(filePath, audioUrl, language);
      } else {
        return res.status(400).json({ error: `Unknown mode: ${mode}` });
      }

      // PII masking
      let maskedText = null;
      let piiDetected = false;
      if (enablePII === 'true' && result.engine === 'groq') {
        const piiResult = detectAndMaskPII(result.text);
        maskedText = piiResult.masked;
        piiDetected = piiResult.detected.length > 0;
      } else if (enablePII === 'true') {
        maskedText = result.text;
        piiDetected = true;
      }

      // Save to Supabase for logged-in users
      if (userId) {
        const duration = result.segments?.[result.segments.length - 1]?.end || 0;
        await recordUsage(userId, result.engine, duration, title || originalName);
        await saveTranscript(userId, {
          title: title || originalName || 'Untitled',
          text: result.text,
          maskedText,
          audioUrl: audioUrl || null,
          engine: result.engine,
          language,
          piiDetected,
          speakerCount: countSpeakers(result.text)
        });
      }

      // Cleanup all temp files
      tempFiles.forEach(p => { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} });

      res.json({
        success: true,
        text: result.text,
        maskedText,
        piiDetected,
        engine: result.engine,
        segments: result.segments,
        usageCount: req.usageCount !== undefined ? req.usageCount + 1 : null
      });

    } catch (err) {
      tempFiles.forEach(p => { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
      console.error('Transcription error:', err.message);
      res.status(500).json({ error: err.message || 'Transcription failed' });
    }
  }
);

function countSpeakers(text) {
  const matches = (text || '').match(/Speaker \d+/g) || [];
  return new Set(matches).size || 1;
}

export default router;
