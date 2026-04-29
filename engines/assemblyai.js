// engines/assemblyai.js
// AssemblyAI — highest accuracy, full PII redaction, restricted to paid users

import fs from 'fs';
import fetch from 'node-fetch';

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const BASE_URL = 'https://api.assemblyai.com/v2';

export async function transcribeAssemblyAI(filePath, audioUrl, language = 'en') {
  if (!process.env.ASSEMBLYAI_API_KEY) {
    throw new Error('ASSEMBLYAI_API_KEY is not set in your .env file');
  }

  const authHeaders = {
    'Authorization': process.env.ASSEMBLYAI_API_KEY,
    'Content-Type': 'application/json'
  };

  // Step 1: Upload file if no URL was provided
  let uploadUrl = audioUrl;
  if (!audioUrl && filePath) {
    const uploadRes = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      headers: {
        'Authorization': process.env.ASSEMBLYAI_API_KEY,
        'Content-Type': 'application/octet-stream'
      },
      body: fs.readFileSync(filePath)
    });
    const uploadData = await uploadRes.json();
    if (!uploadData.upload_url) throw new Error('AssemblyAI upload failed');
    uploadUrl = uploadData.upload_url;
  }

  // Step 2: Submit transcription request
  const transcriptRes = await fetch(`${BASE_URL}/transcript`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      audio_url: uploadUrl,
      language_code: language,
      speaker_labels: true,
      punctuate: true,
      format_text: true,
      redact_pii: true,
      redact_pii_audio: false,
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
      redact_pii_sub: 'hash'
    })
  });

  const { id } = await transcriptRes.json();
  if (!id) throw new Error('AssemblyAI did not return a transcript ID');

  // Step 3: Poll until transcription is complete (max 3 minutes)
  let result;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000)); // wait 3 seconds between polls
    const poll = await fetch(`${BASE_URL}/transcript/${id}`, { headers: authHeaders });
    result = await poll.json();

    if (result.status === 'completed') break;
    if (result.status === 'error') throw new Error(`AssemblyAI error: ${result.error}`);
  }

  if (!result || result.status !== 'completed') {
    throw new Error('AssemblyAI transcription timed out');
  }

  const utterances = result.utterances || [];
  const text = utterances.length > 0
    ? utterances.map(u => `[${formatTime(u.start)}] Speaker ${u.speaker}: ${u.text}`).join('\n')
    : result.text || '';

  return { text, segments: utterances, engine: 'assemblyai' };
}
