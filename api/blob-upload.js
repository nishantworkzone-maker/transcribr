// api/blob-upload.js
// Handles client-side direct uploads using @vercel/blob handleUpload
// Token exchange happens here; actual file goes directly to Vercel Blob CDN

import { handleUpload } from '@vercel/blob/client';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: [
          'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/mp4',
          'audio/m4a', 'audio/ogg', 'audio/webm', 'audio/flac',
          'video/mp4', 'application/octet-stream'
        ],
        maximumSizeInBytes: 500 * 1024 * 1024
      }),
      onUploadCompleted: async ({ blob }) => {
        console.log('[blob] Uploaded:', blob.url);
      }
    });

    return res.status(200).json(jsonResponse);
  } catch (err) {
    console.error('[blob-upload]', err.message);
    return res.status(400).json({ error: err.message });
  }
}
