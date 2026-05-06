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

// ── /api/config ───────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return res.status(500).json({
      error: 'Server config missing. Check Vercel environment variables.',
      missing: [!supabaseUrl && 'SUPABASE_URL', !supabaseKey && 'SUPABASE_ANON_KEY'].filter(Boolean)
    });
  }
  res.json({ supabaseUrl, supabaseKey });
});

// ── Audio proxy ───────────────────────────────────────────────────
app.get('/api/audio', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing URL');
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' };
    if (req.headers.range) headers['Range'] = req.headers.range;
    const response = await fetch(url, { headers });
    if (!response.ok && response.status !== 206) return res.status(502).send(`Remote audio returned HTTP ${response.status}`);

    let contentType = response.headers.get('content-type') || '';
    if (!contentType || contentType.includes('octet-stream') || contentType.includes('binary')) {
      const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
      contentType = ext === 'wav' ? 'audio/wav' : ext === 'ogg' ? 'audio/ogg' : ext === 'webm' ? 'audio/webm'
        : ext === 'm4a' ? 'audio/mp4' : ext === 'mp4' ? 'audio/mp4' : ext === 'flac' ? 'audio/flac'
        : ext === 'opus' ? 'audio/opus' : 'audio/mpeg';
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const contentLength = response.headers.get('content-length');
    const contentRange = response.headers.get('content-range');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);
    res.status(response.status === 206 ? 206 : 200);
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

// ── /api/transcripts — uses service key, bypasses RLS ────────────
import { requireAuth } from './middleware/auth.js';
import { createClient } from '@supabase/supabase-js';

function getAdminClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// GET /api/transcripts — list all transcriptions for authenticated user
app.get('/api/transcripts', requireAuth, async (req, res) => {
  try {
    const { data, error } = await getAdminClient()
      .from('transcriptions')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ data: data || [] });
  } catch (err) {
    console.error('/api/transcripts GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/transcripts/:id — delete one transcription owned by the user
app.delete('/api/transcripts/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await getAdminClient()
      .from('transcriptions')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('/api/transcripts DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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
