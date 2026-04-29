// engines/groq.js
// Uses Groq's Whisper model — fastest engine, great for free users

import fs from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export async function transcribeGroq(filePath, language = 'en') {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set in your .env file');
  }

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model', 'whisper-large-v3');
  form.append('language', language);
  form.append('response_format', 'verbose_json');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      ...form.getHeaders()
    },
    body: form
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message || 'Groq transcription failed');
  }

  const segments = data.segments || [];
  const text = segments.length > 0
    ? segments.map(s => `[${formatTime(s.start)}] ${s.text.trim()}`).join('\n')
    : data.text || '';

  return { text, segments, engine: 'groq' };
}
