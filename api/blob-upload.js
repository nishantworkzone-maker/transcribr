// api/blob-upload.js
// Streams the audio file directly to Vercel Blob, bypassing body size limits
// Uses Vercel's built-in streaming support

import { put } from '@vercel/blob';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN not configured in Vercel' });

  try {
    const filename = req.headers['x-filename'] || 'audio.mp3';
    const contentType = req.headers['content-type'] || 'audio/mpeg';
    const ext = filename.split('.').pop() || 'mp3';
    const storageName = `audio-${Date.now()}-${Math.random().toString(36).slice(2,6)}.${ext}`;

    // Stream directly to Vercel Blob — no body size limit
    const blob = await put(storageName, req, {
      access: 'public',
      contentType,
      token
    });

    return res.status(200).json({ url: blob.url });
  } catch (err) {
    console.error('[blob-upload] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
