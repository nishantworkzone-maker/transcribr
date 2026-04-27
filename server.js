import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50kb' }));

const upload = multer({ dest: '/tmp/', limits: { fileSize: 10 * 1024 * 1024 } });

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ── Supabase config ───────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_ANON_KEY
  });
});

// ── API key endpoints ─────────────────────────────────────────────
app.get('/api/assemblykey', (req, res) => {
  res.json({ key: process.env.ASSEMBLYAI_API_KEY });
});
app.get('/api/deepgramkey', (req, res) => {
  res.json({ key: process.env.DEEPGRAM_API_KEY });
});

// ── TRANSLATE endpoint (uses Groq LLM — fast + free tier) ─────────
app.post('/api/translate', async (req, res) => {
  const { text, targetLanguage } = req.body;
  if (!text || !targetLanguage) {
    return res.status(400).json({ error: 'text and targetLanguage are required' });
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
          {
            role: 'user',
            content: text
          }
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

// ── GROQ ──────────────────────────────────────────────────────────
async function transcribeGroq(filePath, language) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model', 'whisper-large-v3');
  form.append('language', language || 'en');
  form.append('response_format', 'verbose_json');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, ...form.getHeaders() },
    body: form
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Groq failed');
  const segs = data.segments || [];
  const text = segs.length > 0
    ? segs.map(s => `[${formatTime(s.start)}] ${s.text.trim()}`).join('\n')
    : data.text || '';
  return { text, segments: segs };
}

// ── DEEPGRAM (with PII redaction) ─────────────────────────────────
async function transcribeDeepgram(filePath, audioUrl, language) {
  // Added: redact=pii&redact=numbers&redact=ssn for PII masking
  const params = [
    `model=nova-2`,
    `language=${language||'en'}`,
    `punctuate=true`,
    `utterances=true`,
    `diarize=true`,
    `redact=pii`,
    `redact=numbers`,
    `redact=ssn`
  ].join('&');
  const url = `https://api.deepgram.com/v1/listen?${params}`;
  let body, headers = { 'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}` };

  if (audioUrl) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ url: audioUrl });
  } else {
    headers['Content-Type'] = 'audio/*';
    body = fs.readFileSync(filePath);
  }

  const res = await fetch(url, { method: 'POST', headers, body });
  const data = await res.json();
  if (!res.ok) throw new Error(data.err_msg || 'Deepgram failed');

  const utterances = data.results?.utterances || [];
  const text = utterances.length > 0
    ? utterances.map(u => `[${formatTime(u.start)}] Speaker ${u.speaker+1}: ${u.transcript}`).join('\n')
    : data.results?.channels[0]?.alternatives[0]?.transcript || '';
  return { text, segments: utterances };
}

// ── ASSEMBLYAI (with PII redaction) ──────────────────────────────
async function transcribeAssemblyAI(filePath, audioUrl, language) {
  const authHeaders = {
    'Authorization': process.env.ASSEMBLYAI_API_KEY,
    'Content-Type': 'application/json'
  };
  let uploadUrl = audioUrl;

  if (!audioUrl && filePath) {
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        'Authorization': process.env.ASSEMBLYAI_API_KEY,
        'Content-Type': 'application/octet-stream'
      },
      body: fs.readFileSync(filePath)
    });
    const uploadData = await uploadRes.json();
    uploadUrl = uploadData.upload_url;
  }

  const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      audio_url: uploadUrl,
      language_code: language || 'en',
      speaker_labels: true,
      punctuate: true,
      format_text: true,
      // PII redaction — replaces sensitive data with [PII] in transcript
      redact_pii: true,
      redact_pii_audio: false, // keep audio intact, only redact text
      redact_pii_policies: [
        'person_name',
        'phone_number',
        'email_address',
        'ssn',
        'credit_card_number',
        'date_of_birth',
        'location',
        'medical_process',
        'banking_information'
      ],
      redact_pii_sub: 'hash' // replaces with [PII] style hash
    })
  });
  const { id } = await transcriptRes.json();

  let result;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers: authHeaders });
    result = await poll.json();
    if (result.status === 'completed') break;
    if (result.status === 'error') throw new Error(result.error);
  }

  const utterances = result.utterances || [];
  const text = utterances.length > 0
    ? utterances.map(u => `[${formatTime(u.start/1000)}] Speaker ${u.speaker}: ${u.text}`).join('\n')
    : result.text || '';
  return { text, segments: utterances };
}

// ── Main transcribe route ─────────────────────────────────────────
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  const { mode, language, audioUrl } = req.body;
  const filePath = req.file?.path;

  try {
    if (!filePath && !audioUrl) return res.status(400).json({ error: 'No file or URL provided' });

    let result;
    if (mode === 'fast') result = await transcribeGroq(filePath, language);
    else if (mode === 'balanced') result = await transcribeDeepgram(filePath, audioUrl, language);
    else result = await transcribeAssemblyAI(filePath, audioUrl, language);

    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ text: result.text, segments: result.segments });
  } catch (err) {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

// 🔥 AUDIO PROXY (fix CORS)
app.get('/api/audio', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing URL');

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(500).send('Failed to fetch audio');
    }

    res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const buffer = await response.arrayBuffer();
res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Audio proxy error:', err);
    res.status(500).send('Audio proxy failed');
  }
});
export default app;
