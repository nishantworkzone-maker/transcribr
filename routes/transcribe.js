// routes/transcribe.js

import express from 'express';
import multer from 'multer';
import fs from 'fs';

import { optionalAuth } from '../middleware/auth.js';
import { checkUsage } from '../middleware/usage.js';

import { transcribeGroq } from '../engines/groq.js';
import { transcribeDeepgram } from '../engines/deepgram.js';
import { transcribeAssemblyAI } from '../engines/assemblyai.js';
import { detectAndMaskPII } from '../services/pii.js';

const router = express.Router();

const upload = multer({
  dest: '/tmp/',
  limits: { fileSize: 25 * 1024 * 1024 }
});

router.post('/',
  optionalAuth,   // ✅ allow guest + logged-in
  checkUsage,     // ✅ limit logged users only
  upload.single('audio'),
  async (req, res) => {

    const { mode = 'fast', language = 'en', audioUrl, enablePII = 'false', title = '' } = req.body;
    const filePath = req.file?.path;

    // ✅ user may be null (guest)
    const userId = req.user?.id || null;

    try {
      if (!filePath && !audioUrl) {
        return res.status(400).json({ error: 'Please provide an audio file or a URL' });
      }

      let result;
      const shouldMaskPII = enablePII === 'true';

      // 🎯 Engine selection
      if (mode === 'fast') {
        result = await transcribeGroq(filePath, language);
      } else if (mode === 'balanced') {
        result = await transcribeDeepgram(filePath, audioUrl, language);
      } else if (mode === 'accurate') {
        result = await transcribeAssemblyAI(filePath, audioUrl, language);
      } else {
        return res.status(400).json({ error: `Unknown mode: ${mode}` });
      }

      // 🔐 PII handling
      let maskedText = null;
      let piiDetected = false;

      if (shouldMaskPII && result.engine === 'groq') {
        const piiResult = detectAndMaskPII(result.text);
        maskedText = piiResult.masked;
        piiDetected = piiResult.detected.length > 0;
      } else if (shouldMaskPII) {
        maskedText = result.text;
        piiDetected = true;
      }

      // ✅ Only save & track if user is logged in
      let saved = null;

      if (userId) {
        const { recordUsage, saveTranscript } = await import('../middleware/usage.js');

        const duration = result.segments?.[result.segments.length - 1]?.end || 0;

        await recordUsage(userId, result.engine, duration, title);

        saved = await saveTranscript(userId, {
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

      // 🧹 cleanup
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      res.json({
        success: true,
        text: result.text,
        maskedText,
        piiDetected,
        engine: result.engine,
        segments: result.segments,
        transcriptId: saved?.id || null,
        userType: userId ? 'logged-in' : 'guest'
      });

    } catch (err) {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      console.error('Transcription error:', err.message);
      res.status(500).json({ error: err.message || 'Transcription failed' });
    }
  }
);

function countSpeakers(text) {
  const matches = text.match(/Speaker \d+/g) || [];
  return new Set(matches).size || 1;
}

export default router;