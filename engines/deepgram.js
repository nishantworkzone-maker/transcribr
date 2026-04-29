// engines/deepgram.js
// Deepgram Nova-2 — good for call recordings, supports speaker diarization

import fs from 'fs';
import fetch from 'node-fetch';

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export async function transcribeDeepgram(filePath, audioUrl, language = 'en') {
  if (!process.env.DEEPGRAM_API_KEY) {
    throw new Error('DEEPGRAM_API_KEY is not set in your .env file');
  }

  // Build query parameters
  const params = new URLSearchParams({
    model: 'nova-2',
    language,
    punctuate: 'true',
    utterances: 'true',
    diarize: 'true',
    redact: 'pii',
  });

  const url = `https://api.deepgram.com/v1/listen?${params.toString()}`;

  let body;
  let headers = {
    'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`
  };

  if (audioUrl) {
    // URL-based transcription
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ url: audioUrl });
  } else {
    // File-based transcription
    headers['Content-Type'] = 'audio/*';
    body = fs.readFileSync(filePath);
  }

  const res = await fetch(url, { method: 'POST', headers, body });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.err_msg || 'Deepgram transcription failed');
  }

  const utterances = data.results?.utterances || [];
  const text = utterances.length > 0
    ? utterances.map(u => `[${formatTime(u.start)}] Speaker ${u.speaker + 1}: ${u.transcript}`).join('\n')
    : data.results?.channels[0]?.alternatives[0]?.transcript || '';

  return { text, segments: utterances, engine: 'deepgram' };
}
