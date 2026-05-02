// routes/transcribe.js
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

import { optionalAuth } from '../middleware/auth.js';
import { checkUsageLimit, checkEngineAccess, recordUsage, saveTranscript } from '../middleware/usage.js';
import { transcribeGroq } from '../engines/groq.js';
import { transcribeDeepgram } from '../engines/deepgram.js';
import { transcribeAssemblyAI } from '../engines/assemblyai.js';
import { detectAndMaskPII } from '../services/pii.js';

const router = express.Router();
const upload = multer({ dest: '/tmp/', limits: { fileSize: 100 * 1024 * 1024 } });

// Groq requires a file extension on the filename.
// Multer saves files without extension, so we rename before sending.
function ensureExtension(filePath, originalName) {
  if (!filePath) return filePath;
  const ext = path.extname(originalName || '').toLowerCase() || '.mp3';
  const newPath = filePath + ext;
  if (!fs.existsSync(newPath)) {
    fs.copyFileSync(filePath, newPath);
  }
  return newPath;
}

router.post('/',
  optionalAuth,        // never blocks — guests get req.user = null
  checkUsageLimit,     // blocks only if logged-in user hit their plan limit
  checkEngineAccess,   // blocks if plan doesn't allow the selected engine
  upload.single('audio'),
  async (req, res) => {
    const { mode = 'fast', language = 'en', audioUrl, enablePII = 'false', title = '' } = req.body;
    const originalName = req.file?.originalname || 'audio.mp3';
    const rawPath = req.file?.path;
    // Give the file the correct extension so Groq / other engines accept it
    const filePath = rawPath ? ensureExtension(rawPath, originalName) : null;
    const userId = req.user?.id || null;

    try {
      if (!filePath && !audioUrl) {
        return res.status(400).json({ error: 'Please provide an audio file or a URL' });
      }

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

      // PII masking (Groq only — Deepgram/AssemblyAI handle it natively)
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

      // Save transcript + record usage — logged-in users only
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

      // Clean up both the original and renamed temp files
      [rawPath, filePath].forEach(p => {
        if (p && p !== rawPath && fs.existsSync(p)) fs.unlinkSync(p);
      });
      if (rawPath && fs.existsSync(rawPath)) fs.unlinkSync(rawPath);

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
      // Clean up on error
      [rawPath, filePath].forEach(p => {
        if (p && fs.existsSync(p)) try { fs.unlinkSync(p); } catch {}
      });
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
