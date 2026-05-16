// routes/transcribe.js — Security hardened
// FIXED: multer limit was 2GB (should be 500MB); file type validation added;
//        mode/language/title inputs validated; cleanup always runs; errors sanitized

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

// ── Constants ─────────────────────────────────────────────────────
const FREE_MAX_DURATION_SECONDS = 900;  // 15 min
const FREE_MAX_FILE_SIZE_BYTES  = 50  * 1024 * 1024;  // 50 MB
const PRO_MAX_FILE_SIZE_BYTES   = 500 * 1024 * 1024;  // 500 MB

// Allowed audio MIME types (whitelist)
const ALLOWED_MIME_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
  'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/webm',
  'audio/flac', 'audio/x-flac', 'audio/opus', 'audio/aac',
  'video/mp4', 'video/webm',  // video containers with audio
  'application/octet-stream', // some browsers send this for audio
]);

// Allowed audio file extensions
const ALLOWED_EXTENSIONS = new Set([
  '.mp3', '.wav', '.mp4', '.m4a', '.ogg', '.webm', '.flac', '.opus', '.aac',
]);

// Valid modes and languages
const VALID_MODES = new Set(['auto', 'fast', 'balanced', 'accurate', 'quick', 'smart', 'precision']);
const VALID_LANGUAGES = new Set([
  'en','es','fr','de','pt','it','nl','pl','ru','ja','zh','ko','ar','hi',
  'bn','ur','tr','vi','th','id','ms','sw','el','cs','ro','hu','sv','no',
  'da','fi','he','auto',
]);

// Multer with strict limits and file type filter
const upload = multer({
  dest: '/tmp/',
  limits: { fileSize: PRO_MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext  = path.extname(file.originalname || '').toLowerCase();
    const mime = file.mimetype || '';
    if (ALLOWED_EXTENSIONS.has(ext) || ALLOWED_MIME_TYPES.has(mime)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Unsupported file type. Please upload MP3, WAV, MP4, M4A, OGG, WEBM, or FLAC.'));
    }
  },
});

// ── Helpers ───────────────────────────────────────────────────────
async function uploadAudioToStorage(filePath, fileName) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('Storage not configured');
  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(fileName || filePath).toLowerCase() || '.mp3';
  const storageName = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
  const contentTypeMap = {
    '.wav': 'audio/wav', '.mp4': 'audio/mp4', '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg', '.webm': 'audio/webm', '.flac': 'audio/flac',
  };
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
  // Validate URL is safe before fetching
  try {
    const parsed = new URL(audioUrl);
    const h = parsed.hostname;
    if (
      parsed.protocol !== 'https:' ||
      h === 'localhost' || h === '127.0.0.1' ||
      h === '169.254.169.254' || h === 'metadata.google.internal' ||
      /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    ) throw new Error('URL not permitted.');
  } catch (e) {
    throw new Error('Invalid or unsafe audio URL.');
  }

  const response = await fetch(audioUrl, {
    headers: { 'User-Agent': 'Transcribr/3.0', 'Accept': 'audio/*,video/*' },
    size: PRO_MAX_FILE_SIZE_BYTES,
  });
  if (!response.ok) throw new Error(`Unable to access audio (HTTP ${response.status}). Please check the link is a direct audio file.`);

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
      if (ALLOWED_EXTENSIONS.has(urlExt)) ext = urlExt;
    } catch {}
  }

  const tmpPath = `/tmp/url_${Date.now()}_${Math.random().toString(36).slice(2,7)}${ext}`;
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(tmpPath, Buffer.from(buffer));
  return tmpPath;
}

function estimateDurationSeconds(fileSizeBytes, ext = '.mp3') {
  const bitsPerSecond = ['.wav', '.aiff'].includes(ext) ? 1411000 : 128000;
  return (fileSizeBytes * 8) / bitsPerSecond;
}

// Sanitize string inputs to prevent injection
function sanitizeString(val, maxLength = 255) {
  if (!val || typeof val !== 'string') return '';
  return val.slice(0, maxLength).replace(/[<>"'`]/g, '');
}

// ── Main transcription route ──────────────────────────────────────
router.post('/',
  optionalAuth,
  checkUsageLimit,
  checkEngineAccess,
  upload.single('audio'),
  async (req, res) => {
    const rawMode     = VALID_MODES.has(req.body?.mode)     ? req.body.mode     : 'auto';
    const rawLanguage = VALID_LANGUAGES.has(req.body?.language) ? req.body.language : 'en';
    const enablePII   = req.body?.enablePII === 'true';
    const title       = sanitizeString(req.body?.title || '', 200);
    const audioUrl    = typeof req.body?.audioUrl === 'string' ? req.body.audioUrl.slice(0, 2048) : null;

    const originalName = sanitizeString(req.file?.originalname || 'audio.mp3', 200);
    const rawPath      = req.file?.path;
    const userId       = req.user?.id || null;
    const userPlan     = req.userPlan || 'free';
    const isAdmin      = req.userUsage?.isAdmin || false;

    const tempFiles = [];
    if (rawPath) tempFiles.push(rawPath);
    let filePath = null;

    const cleanup = () => {
      tempFiles.forEach(p => {
        try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
      });
    };

    try {
      if (!rawPath && !audioUrl) {
        return res.status(400).json({ error: 'Please provide an audio file or a URL.' });
      }

      // Free plan file size cap
      if (!isAdmin && userPlan === 'free' && req.file) {
        if (req.file.size > FREE_MAX_FILE_SIZE_BYTES) {
          cleanup();
          return res.status(413).json({
            error: 'This upload exceeds the Free plan limit. Upgrade to Pro for support of larger files.',
            code: 'FILE_TOO_LARGE', upgradeUrl: '/pricing.html',
          });
        }
      }

      // Fix extension for Groq compatibility
      if (rawPath) {
        filePath = ensureExtension(rawPath, originalName);
        if (filePath !== rawPath) tempFiles.push(filePath);
      }

      // Download URL to temp file
      if (audioUrl && !filePath) {
        try {
          filePath = await downloadUrlToFile(audioUrl);
          tempFiles.push(filePath);
        } catch (dlErr) {
          if (rawMode === 'fast' || rawMode === 'quick') {
            cleanup();
            return res.status(400).json({ error: dlErr.message });
          }
          filePath = null;
        }
      }

      // Free plan duration pre-check
      if (!isAdmin && userPlan === 'free' && filePath) {
        const stats = fs.statSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const estimated = estimateDurationSeconds(stats.size, ext);
        if (estimated > FREE_MAX_DURATION_SECONDS * 1.5) {
          cleanup();
          return res.status(413).json({
            error: 'This audio file exceeds the Free plan limit. Upgrade to Pro for longer transcription support.',
            code: 'DURATION_LIMIT', upgradeUrl: '/pricing.html',
          });
        }
      }

      // Resolve engine
      let engineKey;
      if (rawMode === 'auto' || rawMode === 'smart') {
        engineKey = resolveSmartAutoEngine(req, userPlan);
      } else {
        engineKey = MODE_TO_ENGINE[rawMode] || 'groq';
      }

      // Run transcription
      let result;
      if (engineKey === 'groq') {
        result = await transcribeGroq(filePath, rawLanguage);
      } else if (engineKey === 'deepgram') {
        result = await transcribeDeepgram(filePath, audioUrl, rawLanguage);
      } else if (engineKey === 'assemblyai') {
        result = await transcribeAssemblyAI(filePath, audioUrl, rawLanguage);
      } else {
        cleanup();
        return res.status(400).json({ error: 'Invalid processing mode selected.' });
      }

      // Post-transcription free plan duration cap
      const actualDurationSeconds = result.segments?.length
        ? (result.segments[result.segments.length - 1]?.end || 0) : 0;

      if (!isAdmin && userPlan === 'free' && actualDurationSeconds > FREE_MAX_DURATION_SECONDS) {
        const cutoff = FREE_MAX_DURATION_SECONDS;
        const trimmedSegments = (result.segments || []).filter(s => (s.start || 0) < cutoff);
        const trimmedText = trimmedSegments.map(s => {
          const m = Math.floor((s.start || 0) / 60);
          const sec = Math.floor((s.start || 0) % 60);
          return `[${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}] ${(s.text||'').trim()}`;
        }).join('\n');

        if (userId) {
          try {
            await recordUsage(userId, result.engine, cutoff, title || originalName);
            await saveTranscript(userId, {
              title: title || originalName || 'Untitled',
              text: trimmedText, audioUrl: null, engine: result.engine,
              language: rawLanguage, durationSeconds: cutoff,
              fileSizeMb: req.file?.size ? req.file.size / (1024 * 1024) : 0,
            });
          } catch {}
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

      // PII masking
      let maskedText = null;
      let piiDetected = false;
      if (enablePII) {
        if (result.engine === 'groq') {
          const piiResult = detectAndMaskPII(result.text);
          maskedText  = piiResult.masked;
          piiDetected = piiResult.detected.length > 0;
        } else {
          maskedText  = result.text;
          piiDetected = true;
        }
      }

      // Audio storage
      const alreadyUploaded = req.body?.blobUploaded === 'true';
      let storedAudioUrl = audioUrl || null;
      if (filePath && !audioUrl && !alreadyUploaded) {
        try { storedAudioUrl = await uploadAudioToStorage(filePath, originalName); }
        catch {}
      }

      // Save to DB
      if (userId) {
        const duration   = actualDurationSeconds || 0;
        const fileSizeMb = req.file?.size ? req.file.size / (1024 * 1024) : 0;
        try {
          await recordUsage(userId, result.engine, duration, title || originalName);
          await saveTranscript(userId, {
            title: title || originalName || 'Untitled',
            text: result.text, audioUrl: storedAudioUrl, engine: result.engine,
            language: rawLanguage,
            durationSeconds: Math.round(duration),
            fileSizeMb: parseFloat(fileSizeMb.toFixed(2)),
          });
        } catch {}
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
      });

    } catch (err) {
      cleanup();
      // Sanitize error messages — never expose internal API details
      let userMessage = 'Transcription could not be completed. Please try again.';
      if (err.code === 'LIMIT_FILE_SIZE') {
        userMessage = 'File exceeds the upload limit. Upgrade to Pro for larger files.';
      } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        userMessage = err.message || 'Unsupported file type.';
      } else if (err.message?.includes('format') || err.message?.includes('codec')) {
        userMessage = 'This audio format is not supported. Please upload MP3, WAV, MP4, M4A, OGG, or FLAC.';
      } else if (err.message?.toLowerCase().includes('url') || err.message?.includes('download')) {
        userMessage = err.message;
      }
      res.status(500).json({ error: userMessage });
    }
  }
);

export default router;
