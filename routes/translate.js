// routes/translate.js — Security hardened
// Translates a transcript using Groq's LLaMA model
// FIXED: No input length limit (cost abuse), no targetLanguage validation (prompt injection)

import express from 'express';
import fetch from 'node-fetch';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Allowlist of supported target languages — prevents prompt injection via targetLanguage
const ALLOWED_LANGUAGES = new Set([
  'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Dutch', 'Polish',
  'Russian', 'Japanese', 'Chinese (Simplified)', 'Chinese (Traditional)',
  'Korean', 'Arabic', 'Hindi', 'Bengali', 'Urdu', 'Turkish', 'Vietnamese',
  'Thai', 'Indonesian', 'Malay', 'Swahili', 'Greek', 'Czech', 'Romanian',
  'Hungarian', 'Swedish', 'Norwegian', 'Danish', 'Finnish', 'Hebrew',
]);

// Max characters to translate per request (prevent LLM cost abuse)
const MAX_TEXT_LENGTH = 50000; // ~12,500 words, well beyond any single transcript

router.post('/', requireAuth, async (req, res) => {
  const { text, targetLanguage } = req.body;

  if (!text || !targetLanguage) {
    return res.status(400).json({ error: 'text and targetLanguage are required' });
  }

  if (typeof text !== 'string' || typeof targetLanguage !== 'string') {
    return res.status(400).json({ error: 'Invalid input types.' });
  }

  // Enforce text length limit
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(413).json({
      error: `Text is too long to translate in one request. Maximum is ${MAX_TEXT_LENGTH.toLocaleString()} characters.`,
    });
  }

  // Strict language allowlist — prevents prompt injection
  if (!ALLOWED_LANGUAGES.has(targetLanguage)) {
    return res.status(400).json({
      error: 'Unsupported target language.',
      supported: [...ALLOWED_LANGUAGES],
    });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: 'Translation is temporarily unavailable.' });
  }

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 8000,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: `You are a professional transcript translator. Translate the given transcript to ${targetLanguage}.
Rules:
- Keep all speaker labels exactly as-is (e.g. "Speaker 1:", "Speaker 2:")
- Keep all timestamps exactly as-is (e.g. [0:05], [1:23])
- Only translate the spoken text content
- Keep the same line structure
- Do NOT add any explanation, preamble, or notes — return ONLY the translated transcript`,
          },
          { role: 'user', content: text },
        ],
      }),
    });

    const data = await groqRes.json();
    if (!groqRes.ok) throw new Error('Translation service error');

    const translated = data.choices?.[0]?.message?.content || '';
    res.json({ translated });

  } catch {
    res.status(500).json({ error: 'Translation failed. Please try again.' });
  }
});

export default router;
