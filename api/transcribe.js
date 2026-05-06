// api/transcribe.js — Vercel Serverless Function
// All env vars come from Vercel Dashboard — No .env file needed
// Supports: Groq (fast), Deepgram (balanced), AssemblyAI (accurate)

export const config = { api: { bodyParser: false } };

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTimeSecs(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatTimeMs(ms) {
  return formatTimeSecs(Math.floor(ms / 1000));
}

// Parse multipart/form-data from raw request stream
async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) return reject(new Error('No boundary in multipart request'));
    const boundary = boundaryMatch[1].trim();

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const fields = {};
      let fileBuffer = null;
      let fileName = 'audio.mp3';

      const delimiter = Buffer.from(`--${boundary}`);
      let start = 0;

      while (start < body.length) {
        const delimIdx = body.indexOf(delimiter, start);
        if (delimIdx === -1) break;
        const partStart = delimIdx + delimiter.length + 2;
        const nextDelim = body.indexOf(delimiter, partStart);
        if (nextDelim === -1) break;
        const partEnd = nextDelim - 2;
        const part = body.slice(partStart, partEnd);
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) { start = nextDelim; continue; }

        const headerStr = part.slice(0, headerEnd).toString();
        const content = part.slice(headerEnd + 4);
        const nameMatch = headerStr.match(/name="([^"]+)"/);
        const fileMatch = headerStr.match(/filename="([^"]+)"/);

        if (nameMatch) {
          const name = nameMatch[1];
          if (fileMatch) {
            fileName = fileMatch[1];
            fileBuffer = content;
          } else {
            fields[name] = content.toString().trim();
          }
        }
        start = nextDelim;
      }
      resolve({ fields, fileBuffer, fileName });
    });
    req.on('error', reject);
  });
}

// ── Engine: Groq (Fast Mode) ─────────────────────────────────────────────────

async function transcribeGroq(fileBuffer, fileName, language) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not configured in Vercel environment variables');

  const form = new FormData();
  const blob = new Blob([fileBuffer]);
  form.append('file', blob, fileName);
  form.append('model', 'whisper-large-v3');
  form.append('language', language || 'en');
  form.append('response_format', 'verbose_json');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}` },
    body: form
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Groq transcription failed');

  const segments = data.segments || [];
  const text = segments.length > 0
    ? segments.map(s => `[${formatTimeSecs(s.start)}] ${s.text.trim()}`).join('\n')
    : (data.text || '');

  return { text, segments, engine: 'groq' };
}

// ── Engine: Deepgram (Balanced Mode) ─────────────────────────────────────────

async function transcribeDeepgram(fileBuffer, audioUrl, language) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('DEEPGRAM_API_KEY is not configured in Vercel environment variables');

  const params = new URLSearchParams({
    model: 'nova-2', language: language || 'en',
    punctuate: 'true', utterances: 'true', diarize: 'true'
  });

  let body, headers = { 'Authorization': `Token ${key}` };
  if (audioUrl && !fileBuffer) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ url: audioUrl });
  } else {
    headers['Content-Type'] = 'audio/*';
    body = fileBuffer;
  }

  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST', headers, body
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.err_msg || 'Deepgram transcription failed');

  const utterances = data.results?.utterances || [];
  const text = utterances.length > 0
    ? utterances.map(u => `[${formatTimeSecs(u.start)}] Speaker ${u.speaker + 1}: ${u.transcript}`).join('\n')
    : (data.results?.channels[0]?.alternatives[0]?.transcript || '');

  return { text, segments: utterances, engine: 'deepgram' };
}

// ── Engine: AssemblyAI (Accurate Mode) ───────────────────────────────────────

async function transcribeAssemblyAI(fileBuffer, audioUrl, language) {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error('ASSEMBLYAI_API_KEY is not configured in Vercel environment variables');

  const authHeaders = { 'Authorization': key, 'Content-Type': 'application/json' };

  let uploadUrl = audioUrl;
  if (!uploadUrl && fileBuffer) {
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { 'Authorization': key, 'Content-Type': 'application/octet-stream' },
      body: fileBuffer
    });
    const uploadData = await uploadRes.json();
    if (!uploadData.upload_url) throw new Error('AssemblyAI upload failed');
    uploadUrl = uploadData.upload_url;
  }

  const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      audio_url: uploadUrl, language_code: language || 'en',
      speaker_labels: true, punctuate: true, format_text: true
    })
  });
  const { id } = await transcriptRes.json();
  if (!id) throw new Error('AssemblyAI did not return a transcript ID');

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers: authHeaders });
    const result = await poll.json();
    if (result.status === 'completed') {
      const utterances = result.utterances || [];
      const text = utterances.length > 0
        ? utterances.map(u => `[${formatTimeMs(u.start)}] Speaker ${u.speaker}: ${u.text}`).join('\n')
        : (result.text || '');
      return { text, segments: utterances, engine: 'assemblyai' };
    }
    if (result.status === 'error') throw new Error(`AssemblyAI error: ${result.error}`);
  }
  throw new Error('AssemblyAI timed out after 3 minutes');
}

// ── Mode resolver ─────────────────────────────────────────────────────────────

function resolveMode(fileSize, isUrl, requestedMode) {
  const modeMap = { quick: 'fast', smart: 'balanced', precision: 'accurate' };
  const normalized = modeMap[requestedMode] || requestedMode;
  if (normalized && normalized !== 'auto') return normalized;
  if (isUrl) return 'balanced';
  if (fileSize && fileSize < 8 * 1024 * 1024) return 'fast';
  return 'balanced';
}

// ── Download URL to buffer ────────────────────────────────────────────────────

async function fetchUrlToBuffer(audioUrl) {
  const res = await fetch(audioUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' }
  });
  if (!res.ok) throw new Error(`Could not download audio (HTTP ${res.status})`);
  const arrayBuf = await res.arrayBuffer();
  const ct = res.headers.get('content-type') || '';
  const ext = ct.includes('wav') ? '.wav' : ct.includes('ogg') ? '.ogg'
    : ct.includes('webm') ? '.webm' : ct.includes('m4a') ? '.m4a' : '.mp3';
  return { buffer: Buffer.from(arrayBuf), ext };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let fileBuffer = null;
    let fileName = 'audio.mp3';
    let fields = {};

    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
      const parsed = await parseMultipart(req);
      fileBuffer = parsed.fileBuffer;
      fileName = parsed.fileName;
      fields = parsed.fields;
    } else if (contentType.includes('application/json')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      fields = JSON.parse(Buffer.concat(chunks).toString());
    } else {
      return res.status(400).json({ error: 'Unsupported content type. Use multipart/form-data or application/json.' });
    }

    const { mode = 'auto', language = 'en', audioUrl = '' } = fields;
    const isUrl = !!audioUrl;

    if (!fileBuffer && !isUrl) {
      return res.status(400).json({ error: 'Please provide an audio file or a URL' });
    }

    const resolvedMode = resolveMode(fileBuffer?.length, isUrl, mode);

    // For fast mode (Groq) with a URL: download to buffer first since Groq needs a file
    let workingBuffer = fileBuffer;
    let workingName = fileName;

    if (isUrl && resolvedMode === 'fast' && !workingBuffer) {
      try {
        const { buffer, ext } = await fetchUrlToBuffer(audioUrl);
        workingBuffer = buffer;
        workingName = `audio_${Date.now()}${ext}`;
      } catch (dlErr) {
        // Can't download for Groq — switch to balanced which accepts URLs
        return res.status(400).json({
          error: `Fast mode requires a downloadable audio file. This URL could not be fetched. Try Smart mode instead. (${dlErr.message})`
        });
      }
    }

    // Run primary engine
    let result;
    try {
      if (resolvedMode === 'fast') {
        result = await transcribeGroq(workingBuffer, workingName, language);
      } else if (resolvedMode === 'balanced') {
        result = await transcribeDeepgram(workingBuffer, isUrl && !workingBuffer ? audioUrl : null, language);
      } else if (resolvedMode === 'accurate') {
        result = await transcribeAssemblyAI(workingBuffer, isUrl && !workingBuffer ? audioUrl : null, language);
      } else {
        return res.status(400).json({ error: `Unknown mode: ${resolvedMode}` });
      }
    } catch (engineErr) {
      // Fallback to balanced (Deepgram) if primary engine fails
      if (resolvedMode !== 'balanced' && process.env.DEEPGRAM_API_KEY) {
        console.error(`[transcribe] ${resolvedMode} failed, falling back to balanced:`, engineErr.message);
        result = await transcribeDeepgram(workingBuffer, isUrl ? audioUrl : null, language);
        result.fallback = true;
      } else {
        throw engineErr;
      }
    }

    return res.status(200).json({
      success: true,
      text: result.text,
      engine: result.engine,
      segments: result.segments || [],
      audioUrl: isUrl ? audioUrl : null,
      resolvedMode,
      fallback: result.fallback || false
    });

  } catch (err) {
    console.error('[transcribe] Error:', err.message);
    return res.status(500).json({ error: err.message || 'Transcription failed' });
  }
}
