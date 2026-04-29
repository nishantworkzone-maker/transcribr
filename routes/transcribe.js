// routes/transcribe.js
// This file handles the main transcription endpoint: POST /api/transcribe
// It picks the right engine based on the user's mode selection and plan

import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

import { requireAuth } from '../middleware/auth.js';
import { checkUsageLimit, checkEngineAccess, recordUsage, saveTranscript } from '../middleware/usage.js';
import { transcribeGroq } from '../engines/groq.js';
import { transcribeDeepgram } from '../engines/deepgram.js';
import { transcribeAssemblyAI } from '../engines/assemblyai.js';
import { detectAndMaskPII } from '../services/pii.js';

const router = express.Router();

// Multer handles file uploads — stores them temporarily in /tmp
const upload = multer({
  dest: '/tmp/',
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB max
});

// Main transcription route
// Protected by: requireAuth → checkUsageLimit → checkEngineAccess
router.post('/',
  requireAuth,
  checkUsageLimit,
  checkEngineAccess,
  upload.single('audio'),
  async (req, res) => {
    const { mode = 'fast', language = 'en', audioUrl, enablePII = 'false', title = '' } = req.body;
    const filePath = req.file?.path;
    const userId = req.user.id;

    try {
      if (!filePath && !audioUrl) {
        return res.status(400).json({ error: 'Please provide an audio file or a URL' });
      }

      let result;
      const shouldMaskPII = enablePII === 'true';

      // Pick the engine based on mode
      if (mode === 'fast') {
        result = await transcribeGroq(filePath, language);
      } else if (mode === 'balanced') {
        result = await transcribeDeepgram(filePath, audioUrl, language);
      } else if (mode === 'accurate') {
        result = await transcribeAssemblyAI(filePath, audioUrl, language);
      } else {
        return res.status(400).json({ error: `Unknown mode: ${mode}` });
      }

      // Apply PII masking if requested and engine didn't already handle it
      let maskedText = null;
      let piiDetected = false;
      if (shouldMaskPII && result.engine === 'groq') {
        // Groq doesn't mask PII automatically — we do it ourselves
        const piiResult = detectAndMaskPII(result.text);
        maskedText = piiResult.masked;
        piiDetected = piiResult.detected.length > 0;
      } else if (shouldMaskPII) {
        // Deepgram and AssemblyAI already redact PII in their output
        maskedText = result.text;
        piiDetected = true;
      }

      // Record the usage in database
      const duration = result.segments?.[result.segments.length - 1]?.end || 0;
      await recordUsage(userId, result.engine, duration, title);

      // Save the full transcript
      const saved = await saveTranscript(userId, {
        title: title || req.file?.originalname || 'Untitled',
        text: result.text,
        maskedText,
        audioUrl,
        engine: result.engine,
        language,
        piiDetected,
        speakerCount: countSpeakers(result.text)
      });

      // Clean up the temp file
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Send the response back to the browser
      res.json({
        success: true,
        text: result.text,
        maskedText,
        piiDetected,
        engine: result.engine,
        segments: result.segments,
        transcriptId: saved?.id || null,
        usageCount: req.usageCount + 1
      });

    } catch (err) {
      // Clean up temp file on error
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      console.error('Transcription error:', err.message);
      res.status(500).json({ error: err.message || 'Transcription failed' });
    }
  }
);

// Helper: count unique speakers mentioned in transcript text
function countSpeakers(text) {
  const matches = text.match(/Speaker \d+/g) || [];
  return new Set(matches).size || 1;
}

export default router;
