// server.js
// Main entry point for the Transcribr backend
// This file is intentionally kept short — all logic lives in /routes

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

// Import all route handlers
import transcribeRouter from './routes/transcribe.js';
import translateRouter from './routes/translate.js';
import importLinkRouter from './routes/importLink.js';
import userRouter from './routes/user.js';


// ── Environment variable validation ──────────────────────────────
// Check all required variables are present at startup
const REQUIRED_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY',
  'GROQ_API_KEY'
];

for (const varName of REQUIRED_ENV_VARS) {
  if (!process.env[varName]) {
    console.error(`❌ Missing required environment variable: ${varName}`);
    console.error('   Go to Vercel → your project → Settings → Environment Variables');
    process.exit(1); // Stop the server — it can't run without these
  }
}
console.log('✅ All required environment variables found');

const app = express();

// ── Middleware setup ──────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50kb' }));

// Serve all HTML files as static files (index, login, dashboard, etc.)
app.use(express.static('.'));

// ── Public routes (no login required) ────────────────────────────

// Returns Supabase public keys to the frontend (safe to expose anon key)
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_ANON_KEY
  });
});

// Audio proxy — fixes CORS issues when playing audio from external URLs
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

// ── Protected routes (login required) ────────────────────────────
app.use('/api/transcribe', transcribeRouter);
app.use('/api/translate', translateRouter);
app.use('/api/import-link', importLinkRouter);
app.use('/api/user', userRouter);

// ── 404 handler ───────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: `API route not found: ${req.path}` });
  }
  // For non-API routes, serve index.html (single page app behavior)
  res.sendFile('index.html', { root: '.' });
});

// ── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

// ── Start server ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Transcribr running on http://localhost:${PORT}`);
});

export default app;
