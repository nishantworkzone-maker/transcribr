// api/transcribe.js — Vercel Serverless Function (Security Hardened v3)
// FIXED: No file size limit (DoS); CORS wildcard; errors leaked internal messages;
//        SSRF in fetchUrlToBuffer; mode/language not validated; no auth check; no request size cap

export const config = { api: { bodyParser: false, sizeLimit: '510mb' } };

// ── Constants ─────────────────────────────────────────────────────
const FREE_MAX_BYTES  = 50  * 1024 * 1024;  // 50 MB  for free/guest
const MAX_BYTES       = 500 * 1024 * 1024;  // 500 MB absolute ceiling
const FREE_MAX_DUR    = 900;                 // 15 min

const VALID_MODES = new Set(['auto','fast','balanced','accurate','quick','smart','precision']);
const VALID_LANGS = new Set([
  'en','es','fr','de','pt','it','nl','pl','ru','ja','zh','ko','ar','hi',
  'bn','ur','tr','vi','th','id','ms','sw','el','cs','ro','hu','sv','no','da','fi','he','auto',
]);

const ALLOWED_EXTS  = new Set(['.mp3','.wav','.mp4','.m4a','.ogg','.webm','.flac','.opus','.aac']);
const ALLOWED_MIMES = new Set([
  'audio/mpeg','audio/mp3','audio/wav','audio/wave','audio/x-wav','audio/mp4','audio/m4a',
  'audio/x-m4a','audio/ogg','audio/webm','audio/flac','audio/x-flac','audio/opus','audio/aac',
  'video/mp4','video/webm','application/octet-stream',
]);

// ── Supabase Storage upload ────────────────────────────────────────
// Uploads audio buffer to Supabase Storage and returns a permanent public URL.
// This is non-blocking — if it fails, transcription still succeeds.
async function uploadAudioToStorage(buffer, fileName, userId) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) return null;

    const bucket = 'audio-files';
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const filePath = `${Date.now()}_${safeName}`;

    // Upload via Supabase Storage REST API
    const uploadRes = await fetch(
      `${supabaseUrl}/storage/v1/object/${bucket}/${filePath}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'audio/mpeg',
          'x-upsert': 'false',
        },
        body: buffer,
      }
    );

    if (!uploadRes.ok) return null;

    // Return the public URL
    return `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
  } catch {
    return null; // non-critical — never fail transcription over this
  }
}

// ── Helpers ───────────────────────────────────────────────────────
function formatTimeSecs(s) {
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
}
function formatTimeMs(ms) { return formatTimeSecs(Math.floor(ms/1000)); }

function sanitizeString(val, max=255) {
  if (!val || typeof val !== 'string') return '';
  return val.slice(0, max).replace(/[<>"'`]/g, '');
}

// Validate URL — SSRF protection
function isSafeUrl(url) {
  try {
    const p = new URL(url);
    const h = p.hostname;
    if (p.protocol !== 'https:') return false;
    if (
      h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' ||
      h === '169.254.169.254' || h === 'metadata.google.internal' ||
      /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    ) return false;
    return true;
  } catch { return false; }
}

// Get user from Supabase JWT token (optional auth)
async function getOptionalUser(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token || token.length < 20 || !token.includes('.')) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': key },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Get user's plan from Supabase
async function getUserPlan(userId) {
  if (!userId) return 'free';
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  try {
    const r = await fetch(`${url}/rest/v1/user_plans?user_id=eq.${userId}&select=plan,status,plan_expires_at`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
    });
    if (!r.ok) return 'free';
    const rows = await r.json();
    if (!rows?.[0]) return 'free';
    const { plan, status, plan_expires_at } = rows[0];
    if (status !== 'active') return 'free';
    if (plan_expires_at && new Date(plan_expires_at) < new Date()) return 'free';
    return plan || 'free';
  } catch { return 'free'; }
}

// Multipart parser with size enforcement
async function parseMultipart(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=([^\s;]+)/);
    if (!bm) return reject(new Error('No boundary in multipart'));
    const boundary = bm[1].trim();
    const chunks = [];
    let totalSize = 0;

    req.on('data', chunk => {
      totalSize += chunk.length;
      if (totalSize > maxBytes) {
        req.destroy();
        return reject(Object.assign(new Error('Upload too large'), { code: 'TOO_LARGE' }));
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const fields = {};
      let fileBuffer = null;
      let fileName = 'audio.mp3';
      let fileMime = '';

      const delim = Buffer.from(`--${boundary}`);
      let pos = 0;

      while (pos < body.length) {
        const di = body.indexOf(delim, pos);
        if (di === -1) break;
        const partStart = di + delim.length + 2;
        const next = body.indexOf(delim, partStart);
        if (next === -1) break;
        const part = body.slice(partStart, next - 2);
        const he = part.indexOf('\r\n\r\n');
        if (he === -1) { pos = next; continue; }

        const hdr = part.slice(0, he).toString();
        const content = part.slice(he + 4);
        const nm = hdr.match(/name="([^"]+)"/);
        const fm = hdr.match(/filename="([^"]+)"/);
        const ctm = hdr.match(/Content-Type:\s*([^\r\n]+)/i);

        if (nm) {
          if (fm) {
            // Sanitize filename — strip path separators
            fileName = sanitizeString(fm[1].replace(/[/\\]/g, ''), 200) || 'audio.mp3';
            fileMime = ctm ? ctm[1].trim() : '';
            fileBuffer = content;
          } else {
            fields[nm[1]] = content.toString().trim().slice(0, 1000);
          }
        }
        pos = next;
      }
      resolve({ fields, fileBuffer, fileName, fileMime });
    });

    req.on('error', reject);
  });
}

// ── Engine: Groq ──────────────────────────────────────────────────
async function transcribeGroq(fileBuffer, fileName, language) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('Fast engine not configured');

  const form = new FormData();
  form.append('file', new Blob([fileBuffer]), fileName);
  form.append('model', 'whisper-large-v3');
  form.append('language', language === 'auto' ? 'en' : language);
  form.append('response_format', 'verbose_json');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Transcription engine error');

  const segments = (data.segments||[]).map(s => ({
    start: s.start, end: s.end, text: (s.text||'').trim(),
  }));
  const text = segments.length
    ? segments.map(s => `[${formatTimeSecs(s.start)}] ${s.text}`).join('\n')
    : (data.text||'');

  return { text, segments, engine: 'groq' };
}

// ── Engine: Deepgram ──────────────────────────────────────────────
async function transcribeDeepgram(fileBuffer, audioUrl, language) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('Balanced engine not configured');

  const lang = language === 'auto' ? 'en' : (language||'en');
  const params = new URLSearchParams({
    model: 'nova-2', smart_format: 'true', language: lang,
    punctuate: 'true', utterances: 'true', diarize: 'true',
  });
  const url = `https://api.deepgram.com/v1/listen?${params}`;

  let res;
  if (fileBuffer) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Token ${key}`, 'Content-Type': 'audio/mpeg' },
      body: fileBuffer,
    });
  } else {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Token ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: audioUrl }),
    });
  }

  const data = await res.json();
  if (!res.ok) throw new Error('Balanced engine error');

  const channel = data.results?.channels?.[0];
  const alts    = channel?.alternatives?.[0];
  const words   = alts?.words || [];

  let segments = [];
  if (data.results?.utterances?.length) {
    segments = data.results.utterances.map(u => ({
      start: u.start, end: u.end,
      text: (u.transcript||'').trim(),
      speaker: u.speaker !== undefined ? `Speaker ${u.speaker+1}` : undefined,
    }));
  } else if (words.length) {
    let cur = null;
    for (const w of words) {
      if (!cur || (cur.speaker !== undefined && w.speaker !== cur.speaker) || (w.start - cur.end) > 3) {
        if (cur) segments.push(cur);
        cur = { start: w.start, end: w.end, text: w.word||'',
                speaker: w.speaker !== undefined ? `Speaker ${w.speaker+1}` : undefined };
      } else {
        cur.end = w.end;
        cur.text += ' ' + (w.word||'');
      }
    }
    if (cur) segments.push(cur);
  }

  const text = segments.length
    ? segments.map(s => {
        const ts = `[${formatTimeSecs(s.start)}]`;
        return s.speaker ? `${ts} ${s.speaker}: ${s.text}` : `${ts} ${s.text}`;
      }).join('\n')
    : (alts?.transcript || '');

  return { text, segments, engine: 'deepgram' };
}

// ── Engine: AssemblyAI ────────────────────────────────────────────
async function transcribeAssemblyAI(fileBuffer, audioUrl, language) {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error('Precision engine not configured');

  let uploadUrl = audioUrl;
  if (fileBuffer) {
    const up = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { 'Authorization': key, 'Content-Type': 'application/octet-stream' },
      body: fileBuffer,
    });
    const upData = await up.json();
    if (!up.ok || !upData.upload_url) throw new Error('Precision upload failed');
    uploadUrl = upData.upload_url;
  }

  const lang = language === 'auto' ? null : language;
  const jobRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { 'Authorization': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: uploadUrl, speaker_labels: true,
      ...(lang ? { language_code: lang } : { language_detection: true }),
    }),
  });
  const job = await jobRes.json();
  if (!jobRes.ok || !job.id) throw new Error('Precision engine submission failed');

  const authHeaders = { 'Authorization': key };
  let transcript;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${job.id}`, { headers: authHeaders });
    transcript = await poll.json();
    if (transcript.status === 'completed') break;
    if (transcript.status === 'error') throw new Error('Precision engine processing failed');
  }

  if (!transcript || transcript.status !== 'completed') throw new Error('Precision engine timed out');

  const utterances = transcript.utterances || [];
  const segments = utterances.map(u => ({
    start: u.start / 1000, end: u.end / 1000,
    text: (u.text||'').trim(),
    speaker: `Speaker ${u.speaker}`,
  }));

  const text = segments.length
    ? segments.map(s => `[${formatTimeSecs(s.start)}] ${s.speaker}: ${s.text}`).join('\n')
    : (transcript.text || '');

  return { text, segments, engine: 'assemblyai' };
}

function resolveMode(fileSize, isUrl, requestedMode) {
  if (!VALID_MODES.has(requestedMode)) requestedMode = 'auto';
  const modeMap = { quick: 'fast', smart: 'balanced', precision: 'accurate' };
  const normalized = modeMap[requestedMode] || requestedMode;
  if (normalized && normalized !== 'auto') return normalized;
  if (isUrl) return 'balanced';
  if (fileSize && fileSize < 8 * 1024 * 1024) return 'fast';
  return 'balanced';
}

// Download audio from a URL — with SSRF protection and size cap
async function fetchUrlToBuffer(audioUrl, maxBytes) {
  if (!isSafeUrl(audioUrl)) throw new Error('URL not permitted.');
  const res = await fetch(audioUrl, {
    headers: { 'User-Agent': 'Transcribr/3.0', 'Accept': 'audio/*,video/*' },
  });
  if (!res.ok) throw new Error(`Could not download audio (HTTP ${res.status})`);

  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
  if (contentLength > maxBytes) throw new Object.assign(new Error('File too large'), { code: 'TOO_LARGE' });

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw Object.assign(new Error('File too large'), { code: 'TOO_LARGE' });

  const ct = res.headers.get('content-type') || '';
  const ext = ct.includes('wav') ? '.wav' : ct.includes('ogg') ? '.ogg'
    : ct.includes('webm') ? '.webm' : ct.includes('m4a') ? '.m4a' : '.mp3';

  return { buffer: buf, ext };
}

// ── Main handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
  // Restrict CORS to own domain
  const allowedOrigin = process.env.ALLOWED_ORIGINS?.split(',')[0] || 'https://mytranscribr.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Optional auth — determines plan limits
    const user     = await getOptionalUser(req);
    const userPlan = user ? await getUserPlan(user.id) : 'free';
    const isGuest  = !user;
    const maxBytes = ['pro','business','admin'].includes(userPlan) ? MAX_BYTES : FREE_MAX_BYTES;

    let fileBuffer = null;
    let fileName   = 'audio.mp3';
    let fileMime   = '';
    let fields     = {};

    const ct = req.headers['content-type'] || '';

    if (ct.includes('multipart/form-data')) {
      const parsed = await parseMultipart(req, maxBytes);
      fileBuffer = parsed.fileBuffer;
      fileName   = parsed.fileName;
      fileMime   = parsed.fileMime;
      fields     = parsed.fields;
    } else if (ct.includes('application/json')) {
      const chunks = [];
      let total = 0;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > 50 * 1024) return res.status(413).json({ error: 'Request body too large.' });
        chunks.push(chunk);
      }
      try { fields = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { return res.status(400).json({ error: 'Invalid JSON.' }); }
    } else {
      return res.status(400).json({ error: 'Unsupported content type.' });
    }

    // Validate and sanitize inputs
    const mode     = VALID_MODES.has(fields.mode)     ? fields.mode     : 'auto';
    const language = VALID_LANGS.has(fields.language)  ? fields.language : 'en';
    const audioUrl = typeof fields.audioUrl === 'string' ? fields.audioUrl.slice(0, 2048) : '';
    const isUrl    = !!audioUrl;

    if (!fileBuffer && !isUrl) {
      return res.status(400).json({ error: 'Please provide an audio file or a URL.' });
    }

    // File extension + MIME type validation
    if (fileBuffer) {
      const ext = '.' + (fileName.split('.').pop()||'').toLowerCase();
      if (!ALLOWED_EXTS.has(ext) && !ALLOWED_MIMES.has(fileMime)) {
        return res.status(400).json({ error: 'Unsupported file format. Upload MP3, WAV, MP4, M4A, OGG, WEBM, or FLAC.' });
      }
    }

    // Free/guest plan file size cap
    if ((isGuest || userPlan === 'free') && fileBuffer && fileBuffer.length > FREE_MAX_BYTES) {
      return res.status(413).json({
        error: 'File exceeds the Free plan limit (50MB). Upgrade to Pro for larger files.',
        code: 'FILE_TOO_LARGE', upgradeUrl: '/pricing.html',
      });
    }

    const resolvedMode = resolveMode(fileBuffer?.length, isUrl, mode);

    let workingBuffer = fileBuffer;
    let workingName   = fileName;

    // Groq needs a local buffer — download URL if needed
    if (isUrl && resolvedMode === 'fast' && !workingBuffer) {
      try {
        const { buffer, ext } = await fetchUrlToBuffer(audioUrl, maxBytes);
        workingBuffer = buffer;
        workingName   = `audio_${Date.now()}${ext}`;
      } catch (dlErr) {
        if (dlErr.code === 'TOO_LARGE') {
          return res.status(413).json({ error: 'Audio file is too large.', upgradeUrl: '/pricing.html' });
        }
        return res.status(400).json({
          error: 'Fast mode requires a downloadable audio file. Try Smart mode instead.',
        });
      }
    }

    // Run engine
    let result;
    try {
      if (resolvedMode === 'fast') {
        result = await transcribeGroq(workingBuffer, workingName, language);
      } else if (resolvedMode === 'balanced') {
        result = await transcribeDeepgram(workingBuffer || null, isUrl && !workingBuffer ? audioUrl : null, language);
      } else if (resolvedMode === 'accurate') {
        // Pro/Business only for AssemblyAI
        if (isGuest || userPlan === 'free') {
          return res.status(403).json({
            error: 'Precision mode requires a Pro plan.', code: 'ENGINE_LOCKED', upgradeUrl: '/pricing.html',
          });
        }
        result = await transcribeAssemblyAI(workingBuffer || null, isUrl && !workingBuffer ? audioUrl : null, language);
      } else {
        return res.status(400).json({ error: 'Unknown processing mode.' });
      }
    } catch (engineErr) {
      // Fallback to balanced if primary fails and Deepgram is available
      if (resolvedMode !== 'balanced' && process.env.DEEPGRAM_API_KEY) {
        result = await transcribeDeepgram(workingBuffer || null, isUrl ? audioUrl : null, language);
        result.fallback = true;
      } else {
        throw engineErr;
      }
    }

    // ── Upload audio to Supabase Storage for permanent playback ──
    // Only for logged-in users (guests use sessionStorage blobs)
    // Only upload if buffer ≤ 50MB to avoid timeout on serverless
    let permanentAudioUrl = null;
    const STORAGE_MAX = 50 * 1024 * 1024; // 50MB cap for storage uploads

    if (!isGuest && workingBuffer && workingBuffer.length <= STORAGE_MAX) {
      // Case 1: file-upload or URL where buffer was already downloaded (fast mode)
      const uploadName = workingName || `audio_${Date.now()}.mp3`;
      permanentAudioUrl = await uploadAudioToStorage(
        workingBuffer, uploadName, user?.id || null
      );
    } else if (!isGuest && isUrl && !workingBuffer) {
      // Case 2: URL-based transcription where Deepgram/AssemblyAI used the URL directly
      // (no local buffer exists yet). Fetch the audio now so we can store it permanently.
      // This is the main fix for URL-based audio playback — without this, we fall back
      // to returning the raw original URL which may expire or be blocked by CORS.
      try {
        const { buffer: dlBuffer, ext } = await fetchUrlToBuffer(audioUrl, STORAGE_MAX);
        const dlName = `url_audio_${Date.now()}${ext}`;
        permanentAudioUrl = await uploadAudioToStorage(dlBuffer, dlName, user?.id || null);
        // Update workingBuffer so audioSize is reported correctly
        workingBuffer = dlBuffer;
        workingName = dlName;
      } catch {
        // Non-critical — fall through to returning the original URL
      }
    }

    // For URL transcriptions where upload wasn't possible (guest, or download failed),
    // keep the original URL as fallback so the download link still works.
    // The frontend will route this through /api/audio proxy for CORS-safe playback.
    const finalAudioUrl = permanentAudioUrl || (isUrl ? audioUrl : null);

    // Free plan duration cap (post-transcription check)
    const lastSeg = result.segments?.[result.segments.length - 1];
    const durationSecs = lastSeg?.end || 0;
    if ((isGuest || userPlan === 'free') && durationSecs > FREE_MAX_DUR) {
      const trimmed = (result.segments || []).filter(s => s.start < FREE_MAX_DUR);
      const trimText = trimmed.map(s => `[${formatTimeSecs(s.start)}] ${s.text}`).join('\n');
      return res.status(200).json({
        success: true, text: trimText, engine: result.engine,
        segments: trimmed,
        audioUrl: finalAudioUrl,
        audioSize: workingBuffer?.length || null,
        resolvedMode, fallback: result.fallback || false,
        trimmed: true, trimmedAtSeconds: FREE_MAX_DUR,
        upgradePrompt: 'Transcript trimmed to 15 minutes (Free plan limit). Upgrade to Pro for full transcription.',
        upgradeUrl: '/pricing.html',
      });
    }

    return res.status(200).json({
      success: true,
      text: result.text,
      engine: result.engine,
      segments: result.segments || [],
      audioUrl: finalAudioUrl,
      audioSize: workingBuffer?.length || null,
      resolvedMode,
      fallback: result.fallback || false,
    });

  } catch (err) {
    // Never expose internal API error details or stack traces to client
    if (err.code === 'TOO_LARGE') {
      return res.status(413).json({ error: 'File too large.', upgradeUrl: '/pricing.html' });
    }
    console.error('[transcribe]', err.message); // server-side only
    return res.status(500).json({ error: 'Transcription could not be completed. Please try again.' });
  }
}