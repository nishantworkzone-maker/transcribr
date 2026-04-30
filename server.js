// server.js
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

import transcribeRouter from './routes/transcribe.js';
import translateRouter from './routes/translate.js';
import importLinkRouter from './routes/importLink.js';
import userRouter from './routes/user.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '50kb' }));
app.use(express.static('.'));

// ── /api/config — MUST work even if other env vars are missing ────
// This is the first thing every page calls. Never crash here.
app.get('/api/config', (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment variables');
    return res.status(500).json({
      error: 'Server config missing. Check Vercel environment variables.',
      missing: [
        !supabaseUrl && 'SUPABASE_URL',
        !supabaseKey && 'SUPABASE_ANON_KEY'
      ].filter(Boolean)
    });
  }

  res.json({ supabaseUrl, supabaseKey });
});

// ── Audio proxy ───────────────────────────────────────────────────
app.get('/api/audio', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing URL');
  try {
    const response = await fetch(url);
    if (!response.ok) return res.status(500).send('Failed to fetch audio');
    res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Audio proxy error:', err.message);
    res.status(500).send('Audio proxy failed');
  }
});

// ── Protected routes ──────────────────────────────────────────────
app.use('/api/transcribe', transcribeRouter);
app.use('/api/translate', translateRouter);
app.use('/api/import-link', importLinkRouter);
app.use('/api/user', userRouter);

// ── 404 / catch-all ───────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: `API route not found: ${req.path}` });
  }
  res.sendFile('index.html', { root: '.' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

// ── Local dev only — Vercel does not use app.listen ───────────────
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`✅ Transcribr running on http://localhost:${PORT}`));
}

export default app;
