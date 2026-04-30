// routes/transcribe.js
import express from 'express';
import multer from 'multer';
import fs from 'fs';

import { optionalAuth } from '../middleware/auth.js';
import { checkUsageLimit, checkEngineAccess, recordUsage, saveTranscript } from '../middleware/usage.js';
import { transcribeGroq } from '../engines/groq.js';
import { transcribeDeepgram } from '../engines/deepgram.js';
import { transcribeAssemblyAI } from '../engines/assemblyai.js';
import { detectAndMaskPII } from '../services/pii.js';

const router = express.Router();
const upload = multer({ dest: '/tmp/', limits: { fileSize: 25 * 1024 * 1024 } });

router.post('/',
  optionalAuth,        // never blocks — guests get req.user = null
  checkUsageLimit,     // blocks only if logged-in user hit their plan limit
  checkEngineAccess,   // blocks if plan doesn't allow the selected engine
  upload.single('audio'),
  async (req, res) => {
    const { mode = 'fast', language = 'en', audioUrl, enablePII = 'false', title = '' } = req.body;
    const filePath = req.file?.path;
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

      // Record usage + save transcript only for logged-in users
      if (userId) {
        const duration = result.segments?.[result.segments.length - 1]?.end || 0;
        await recordUsage(userId, result.engine, duration, title);
        await saveTranscript(userId, {
          title: title || req.file?.originalname || 'Untitled',
          text: result.text,
          maskedText,
          audioUrl,
          engine: result.engine,
          language,
          piiDetected,
          speakerCount: countSpeakers(result.text)
        });
      }

      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);

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
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
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
