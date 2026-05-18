// server.js v3.1 — Security hardened + transcript 500 bug fixed
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

// ── Route imports ─────────────────────────────────────────────────
import transcribeRouter from './routes/transcribe.js';
import translateRouter from './routes/translate.js';
import importLinkRouter from './routes/importLink.js';
import userRouter from './routes/user.js';
import paymentCreateOrder from './api/payment/create-order.js';
import paymentVerify from './api/payment/verify.js';
import { requireAuth } from './middleware/auth.js';

const app = express();

// ── Security headers ──────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'", "'unsafe-inline'",
        'https://cdn.jsdelivr.net',
        'https://checkout.razorpay.com',
        'https://js.razorpay.com',
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://*.supabase.co', 'https://api.groq.com',
                   'https://api.deepgram.com', 'https://api.assemblyai.com',
                   'https://api.razorpay.com'],
      mediaSrc:   ["'self'", 'blob:', 'https:'],
      frameSrc:   ["'none'"],
      objectSrc:  ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ──────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : ['https://mytranscribr.vercel.app'];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || process.env.NODE_ENV !== 'production') {
      return cb(null, true);
    }
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(express.json({ limit: '50kb' }));
app.use(express.static('.'));

// ── Rate limiters ─────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in 15 minutes.' },
});
const transcribeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Transcription rate limit reached. Please wait a moment.' },
});
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many payment requests. Please try again later.' },
});

app.use(globalLimiter);

// ── /api/config ───────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Server configuration error.' });
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ supabaseUrl, supabaseKey });
});

// ── Audio proxy ───────────────────────────────────────────────────
function isAllowedAudioUrl(url) {
  try {
    const parsed = new URL(url);
    const h = parsed.hostname;
    if (
      h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' ||
      h === '169.254.169.254' || h === 'metadata.google.internal' ||
      /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      /^192\.168\./.test(h) || /^::1$/.test(h)
    ) return false;
    if (parsed.protocol !== 'https:') return false;
    return true;
  } catch { return false; }
}

app.get('/api/audio', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing URL' });
  if (!isAllowedAudioUrl(url)) return res.status(403).json({ error: 'Audio URL not permitted.' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const headers = { 'User-Agent': 'Transcribr/3.0', 'Accept': 'audio/*' };
    if (req.headers.range) headers['Range'] = req.headers.range;
    const response = await fetch(url, { headers });
    if (!response.ok && response.status !== 206) return res.status(502).json({ error: 'Could not load audio.' });

    let ct = response.headers.get('content-type') || '';
    if (!ct || ct.includes('octet-stream')) {
      const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
      ct = ({ wav:'audio/wav', ogg:'audio/ogg', webm:'audio/webm', m4a:'audio/mp4',
               mp4:'audio/mp4', flac:'audio/flac', opus:'audio/opus' })[ext] || 'audio/mpeg';
    }

    res.setHeader('Content-Type', ct);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const cl = response.headers.get('content-length');
    const cr = response.headers.get('content-range');
    if (cl) res.setHeader('Content-Length', cl);
    if (cr) res.setHeader('Content-Range', cr);
    res.status(response.status === 206 ? 206 : 200);
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.status(500).json({ error: 'Audio proxy failed.' });
  }
});

// ── API routes ────────────────────────────────────────────────────
app.use('/api/transcribe',  transcribeLimiter, transcribeRouter);
app.use('/api/translate',   authLimiter, translateRouter);
app.use('/api/import-link', authLimiter, importLinkRouter);
app.use('/api/user',        userRouter);

// ── Payment routes ────────────────────────────────────────────────
app.post('/api/payment/create-order', paymentLimiter, paymentCreateOrder);
app.post('/api/payment/verify',       paymentLimiter, paymentVerify);
app.options('/api/payment/create-order', (req, res) => res.status(200).end());
app.options('/api/payment/verify',       (req, res) => res.status(200).end());

// ── Supabase admin client ─────────────────────────────────────────
function getAdminClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// ── GET /api/transcripts ──────────────────────────────────────────
// BUG FIX: was failing with 500 because:
// 1. Column 'filename' didn't exist (old schema used 'title')
// 2. Table might not exist yet (first deploy)
// Fix: select only safe columns that exist in both old + new schema,
//      with graceful fallback column aliases.
app.get('/api/transcripts', requireAuth, async (req, res) => {
  try {
    const supabase = getAdminClient();

    // FIX: Request the transcript text too so the viewer can open it
    const { data, error } = await supabase
      .from('transcriptions')
      .select('id, filename, transcript, audio_url, mode, engine, language, created_at, duration_seconds')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[/api/transcripts] Supabase error:', error.message, error.code);

      // Handle "relation does not exist" — table not yet created
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return res.status(200).json({
          data: [],
          _warning: 'Transcriptions table not found. Please run the schema SQL.',
        });
      }

      // Handle missing column (old schema used 'title' not 'filename')
      if (error.code === '42703' || error.message?.includes('column')) {
        // Fallback: try old schema column names
        const { data: fallback, error: fallbackErr } = await supabase
          .from('transcriptions')
          .select('id, title, transcript, audio_url, mode, engine, language, created_at')
          .eq('user_id', req.user.id)
          .order('created_at', { ascending: false })
          .limit(100);

        if (fallbackErr) {
          // Try the old table name as last resort
          const { data: oldData, error: oldErr } = await supabase
            .from('transcripts')
            .select('id, title, transcript, audio_url, engine, language, created_at')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(100);

          if (oldErr) {
            console.error('[/api/transcripts] All fallbacks failed:', oldErr.message);
            return res.status(200).json({ data: [] });
          }

          // Normalize old schema to new format
          const normalized = (oldData || []).map(t => ({
            ...t,
            filename: t.title || 'Untitled',
          }));
          return res.status(200).json({ data: normalized });
        }

        const normalized = (fallback || []).map(t => ({
          ...t,
          filename: t.title || 'Untitled',
        }));
        return res.status(200).json({ data: normalized });
      }

      return res.status(500).json({ error: 'Failed to load transcripts.' });
    }

    // Ensure filename is always set (some rows may have null)
    const normalized = (data || []).map(t => ({
      ...t,
      filename: t.filename || t.title || 'Untitled',
      title: t.filename || t.title || 'Untitled',
    }));

    res.json({ data: normalized });
  } catch (err) {
    console.error('[/api/transcripts] Unexpected error:', err.message);
    res.status(500).json({ error: 'Failed to load transcripts.' });
  }
});

// ── DELETE /api/transcripts/:id ───────────────────────────────────
app.delete('/api/transcripts/:id', requireAuth, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'Invalid ID.' });
  try {
    const supabase = getAdminClient();
    const { error } = await supabase
      .from('transcriptions')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) {
      // Fallback to old table name
      if (error.code === '42P01') {
        const { error: e2 } = await supabase
          .from('transcripts')
          .delete()
          .eq('id', req.params.id)
          .eq('user_id', req.user.id);
        if (e2) return res.status(500).json({ error: 'Delete failed.' });
        return res.json({ success: true });
      }
      throw error;
    }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Delete failed.' });
  }
});

// ── 404 / error handlers ──────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Route not found.' });
  res.sendFile('index.html', { root: '.' });
});

app.use((err, req, res, _next) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Something went wrong.' });
});

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`✅ Transcribr running on http://localhost:${PORT}`));
}

export default app;
