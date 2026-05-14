// routes/transcribe.js — Transcribr v3
// Free plan 15-min cap · Smart Auto routing · Admin bypass · Professional error messages

import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

import { optionalAuth } from '../middleware/auth.js';
import {
  checkUsageLimit,
  checkEngineAccess,
  recordUsage,
  saveTranscript,
  getUserPlanAndUsage,
  resolveSmartAutoEngine,
  MODE_TO_ENGINE,
  PLAN_LIMITS,
} from '../middleware/usage.js';
import { transcribeGroq } from '../engines/groq.js';
import { transcribeDeepgram } from '../engines/deepgram.js';
import { transcribeAssemblyAI } from '../engines/assemblyai.js';
import { detectAndMaskPII } from '../services/pii.js';
import { put } from '@vercel/blob';

const router = express.Router();

// Free plan: max 15 min = 900 seconds per file
const FREE_MAX_DURATION_SECONDS = 900;
const FREE_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB for free (generous but not unlimited)

const upload = multer({
  dest: '/tmp/',
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB hard cap — plan enforced below
});

// ── Helpers ───────────────────────────────────────────────────────
async function uploadAudioToStorage(filePath, fileName) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('Storage not configured');
  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(fileName || filePath).toLowerCase() || '.mp3';
  const storageName = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
  const contentTypeMap = { '.wav': 'audio/wav', '.mp4': 'audio/mp4', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.webm': 'audio/webm', '.flac': 'audio/flac' };
  const contentType = contentTypeMap[ext] || 'audio/mpeg';
  const blob = await put(storageName, fileBuffer, { access: 'public', contentType, token });
  if (!blob?.url) throw new Error('Storage upload failed');
  return blob.url;
}

function ensureExtension(filePath, originalName) {
  if (!filePath) return filePath;
  const ext = path.extname(originalName || '').toLowerCase() || '.mp3';
  const newPath = filePath + ext;
  if (!fs.existsSync(newPath)) fs.copyFileSync(filePath, newPath);
  return newPath;
}

async function downloadUrlToFile(audioUrl) {
  const response = await fetch(audioUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' } });
  if (!response.ok) throw new Error(`Unable to access audio at that URL (HTTP ${response.status}). Please check the link is a direct audio file.`);
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
      if (['.mp3', '.wav', '.mp4', '.m4a', '.ogg', '.webm', '.flac', '.opus'].includes(urlExt)) ext = urlExt;
    } catch {}
  }
  const tmpPath = `/tmp/url_${Date.now()}${ext}`;
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(tmpPath, Buffer.from(buffer));
  return tmpPath;
}

// Estimate audio duration from file size (rough heuristic when metadata unavailable)
function estimateDurationSeconds(fileSizeBytes, ext = '.mp3') {
  // Average bitrates: mp3 ~128kbps, wav ~1411kbps, mp4/m4a ~128kbps
  const bitsPerSecond = ['.wav', '.aiff'].includes(ext) ? 1411000 : 128000;
  return (fileSizeBytes * 8) / bitsPerSecond;
}

// ── Main transcription route ──────────────────────────────────────
router.post('/',
  optionalAuth,
  checkUsageLimit,
  checkEngineAccess,
  upload.single('audio'),
  async (req, res) => {
    const rawMode = req.body?.mode || 'auto';
    const language = req.body?.language || 'en';
    const audioUrl = req.body?.audioUrl;
    const enablePII = req.body?.enablePII || 'false';
    const title = req.body?.title || '';
    const originalName = req.file?.originalname || 'audio.mp3';
    const rawPath = req.file?.path;
    const userId = req.user?.id || null;
    const userPlan = req.userPlan || 'free';
    const isAdmin = req.userUsage?.isAdmin || false;

    const tempFiles = [];
    if (rawPath) tempFiles.push(rawPath);
    let filePath = null;

    const cleanup = () => tempFiles.forEach(p => { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} });

    try {
      if (!rawPath && !audioUrl) {
        return res.status(400).json({ error: 'Please provide an audio file or a URL.' });
      }

      // ── File size enforcement for free users ──────────────────
      if (!isAdmin && userPlan === 'free' && req.file) {
        if (req.file.size > FREE_MAX_FILE_SIZE_BYTES) {
          cleanup();
          return res.status(413).json({
            error: 'This upload exceeds the Free plan limit. Upgrade to Pro for support of larger audio files.',
            code: 'FILE_TOO_LARGE',
            upgradeUrl: '/pricing.html',
          });
        }
      }

      // Fix extension for Groq compatibility
      if (rawPath) {
        filePath = ensureExtension(rawPath, originalName);
        if (filePath !== rawPath) tempFiles.push(filePath);
      }

      // Download URL to temp file for all engines
      if (audioUrl && !filePath) {
        try {
          filePath = await downloadUrlToFile(audioUrl);
          tempFiles.push(filePath);
        } catch (dlErr) {
          if (rawMode === 'fast' || rawMode === 'quick') {
            cleanup();
            return res.status(400).json({ error: dlErr.message });
          }
          filePath = null; // Deepgram/AssemblyAI can take raw URLs as fallback
        }
      }

      // ── Free plan: 15-minute per-file cap ─────────────────────
      // Estimate duration if we have a file (actual duration checked post-transcription too)
      if (!isAdmin && userPlan === 'free' && filePath) {
        const stats = fs.statSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const estimatedDuration = estimateDurationSeconds(stats.size, ext);
        if (estimatedDuration > FREE_MAX_DURATION_SECONDS * 1.5) {
          // 1.5x buffer for estimation error — exact check done post-transcription
          cleanup();
          return res.status(413).json({
            error: 'This upload exceeds the Free plan limit. Upgrade to Pro for longer transcription support.',
            code: 'DURATION_LIMIT',
            upgradeUrl: '/pricing.html',
          });
        }
      }

      // ── Resolve engine ────────────────────────────────────────
      let engineKey;
      if (rawMode === 'auto' || rawMode === 'smart') {
        engineKey = resolveSmartAutoEngine(req, userPlan);
      } else {
        engineKey = MODE_TO_ENGINE[rawMode] || 'groq';
      }

      // ── Run transcription ─────────────────────────────────────
      let result;
      if (engineKey === 'groq') {
        result = await transcribeGroq(filePath, language);
      } else if (engineKey === 'deepgram') {
        result = await transcribeDeepgram(filePath, audioUrl, language);
      } else if (engineKey === 'assemblyai') {
        result = await transcribeAssemblyAI(filePath, audioUrl, language);
      } else {
        cleanup();
        return res.status(400).json({ error: 'Invalid processing mode selected.' });
      }

      // ── Post-transcription: enforce free plan duration cap ────
      const actualDurationSeconds = result.segments?.length
        ? (result.segments[result.segments.length - 1]?.end || 0)
        : 0;

      if (!isAdmin && userPlan === 'free' && actualDurationSeconds > FREE_MAX_DURATION_SECONDS) {
        // Trim result to 15 minutes — process but truncate output
        const cutoff = FREE_MAX_DURATION_SECONDS;
        const trimmedSegments = (result.segments || []).filter(s => (s.start || 0) < cutoff);
        const trimmedText = trimmedSegments.map(s => {
          const m = Math.floor((s.start || 0) / 60);
          const sec = Math.floor((s.start || 0) % 60);
          return `[${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}] ${(s.text || '').trim()}`;
        }).join('\n');

        // Save the trimmed version and return with upgrade prompt
        if (userId) {
          try {
            await recordUsage(userId, result.engine, cutoff, title || originalName);
            await saveTranscript(userId, {
              title: title || originalName || 'Untitled',
              text: trimmedText,
              audioUrl: null,
              engine: result.engine,
              language,
              durationSeconds: cutoff,
              fileSizeMb: req.file?.size ? req.file.size / (1024 * 1024) : 0,
            });
          } catch (e) { console.error('[saveTranscript trimmed]', e.message); }
        }

        cleanup();
        return res.json({
          success: true,
          text: trimmedText,
          engine: result.engine,
          segments: trimmedSegments,
          trimmed: true,
          trimmedAtSeconds: cutoff,
          upgradePrompt: 'Your transcript has been processed up to the Free plan limit (15 minutes). Upgrade to Pro to transcribe the full file.',
          upgradeUrl: '/pricing.html',
        });
      }

      // ── PII masking ───────────────────────────────────────────
      let maskedText = null;
      let piiDetected = false;
      if (enablePII === 'true') {
        if (result.engine === 'groq') {
          const piiResult = detectAndMaskPII(result.text);
          maskedText = piiResult.masked;
          piiDetected = piiResult.detected.length > 0;
        } else {
          maskedText = result.text;
          piiDetected = true;
        }
      }

      // ── Audio storage ─────────────────────────────────────────
      const alreadyUploaded = req.body?.blobUploaded === 'true';
      let storedAudioUrl = audioUrl || null;
      if (filePath && !audioUrl && !alreadyUploaded) {
        try { storedAudioUrl = await uploadAudioToStorage(filePath, originalName); }
        catch (e) { console.error('[audio-upload]', e.message); }
      }

      // ── Save to DB ────────────────────────────────────────────
      let saveError = null;
      if (userId) {
        const duration = actualDurationSeconds || 0;
        const fileSizeMb = req.file?.size ? req.file.size / (1024 * 1024) : 0;
        try {
          await recordUsage(userId, result.engine, duration, title || originalName);
          await saveTranscript(userId, {
            title: title || originalName || 'Untitled',
            text: result.text,
            audioUrl: storedAudioUrl,
            engine: result.engine,
            language,
            durationSeconds: Math.round(duration),
            fileSizeMb: parseFloat(fileSizeMb.toFixed(2)),
          });
        } catch (err) {
          console.error('[saveTranscript]', err.message);
          saveError = err.message;
        }
      }

      cleanup();

      res.json({
        success: true,
        text: result.text,
        maskedText,
        piiDetected,
        engine: result.engine,
        segments: result.segments,
        audioUrl: storedAudioUrl || null,
        saveError: saveError || undefined,
      });

    } catch (err) {
      cleanup();
      console.error('Transcription error:', err.message);
      // Professional error messages — never expose provider/API internals
      let userMessage = 'Transcription could not be completed. Please try again.';
      if (err.message?.includes('GROQ_API_KEY') || err.message?.includes('API key')) {
        userMessage = 'AI processing is temporarily unavailable. Please try again shortly.';
      } else if (err.message?.includes('file size') || err.message?.includes('too large')) {
        userMessage = 'This upload exceeds the Free plan limit. Upgrade to Pro for support of larger audio files.';
      } else if (err.message?.includes('format') || err.message?.includes('codec')) {
        userMessage = 'This audio format is not supported. Please upload MP3, WAV, MP4, M4A, OGG, or FLAC files.';
      } else if (err.message?.toLowerCase().includes('url') || err.message?.includes('download')) {
        userMessage = err.message; // URL errors are user-actionable, show them
      }
      res.status(500).json({ error: userMessage });
    }
  }
);

export default router;
