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
app.use(express.json());

const upload = multer({ dest: '/tmp/', limits: { fileSize: 100 * 1024 * 1024 } });

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

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
  if (!res.ok) throw new Error(data.error?.message || 'Groq transcription failed');
  const segments = data.segments || [];
  const text = segments.length > 0
    ? segments.map(s => `[${formatTime(s.start)}] ${s.text.trim()}`).join('\n')
    : data.text;
  return { text, segments };
}

async function transcribeDeepgram(filePath, audioUrl, language) {
  const params = `?model=nova-2&language=${language || 'en'}&punctuate=true&utterances=true&diarize=true`;
  const url = `https://api.deepgram.com/v1/listen${params}`;
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
  if (!res.ok) throw new Error(data.err_msg || 'Deepgram transcription failed');

  const utterances = data.results?.utterances || [];
  const text = utterances.length > 0
    ? utterances.map(u => `[${formatTime(u.start)}] Speaker ${u.speaker + 1}: ${u.transcript}`).join('\n')
    : data.results?.channels[0]?.alternatives[0]?.transcript || '';
  return { text, segments: utterances };
}

async function transcribeAssemblyAI(filePath, audioUrl, language) {
  const authHeaders = { 'Authorization': process.env.ASSEMBLYAI_API_KEY, 'Content-Type': 'application/json' };
  let uploadUrl = audioUrl;

  if (!audioUrl && filePath) {
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { 'Authorization': process.env.ASSEMBLYAI_API_KEY, 'Content-Type': 'application/octet-stream' },
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
      format_text: true
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
    ? utterances.map(u => `[${formatTime(u.start / 1000)}] Speaker ${u.speaker}: ${u.text}`).join('\n')
    : result.text || '';
  return { text, segments: utterances };
}

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

export default app;
