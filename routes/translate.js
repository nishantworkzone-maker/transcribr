// routes/translate.js
// Translates a transcript to another language using Groq's LLaMA model

import express from 'express';
import fetch from 'node-fetch';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
  const { text, targetLanguage } = req.body;

  if (!text || !targetLanguage) {
    return res.status(400).json({ error: 'text and targetLanguage are required' });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured' });
  }

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
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
- Do NOT add any explanation, preamble, or notes — return ONLY the translated transcript`
          },
          { role: 'user', content: text }
        ]
      })
    });

    const data = await groqRes.json();
    if (!groqRes.ok) throw new Error(data.error?.message || 'Translation failed');

    const translated = data.choices?.[0]?.message?.content || '';
    res.json({ translated });

  } catch (err) {
    console.error('Translate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
