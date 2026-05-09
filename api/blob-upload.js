// api/blob-upload.js — Client-side Vercel Blob upload token endpoint
// The browser calls this to get a token, then uploads directly to Blob storage
// This bypasses Vercel's 4.5MB serverless function body limit entirely

import { handleUpload } from '@vercel/blob/client';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
      req.on('error', reject);
    });

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/mp4', 'audio/m4a', 'audio/ogg', 'audio/webm', 'audio/flac', 'video/mp4', 'application/octet-stream'],
        tokenPayload: JSON.stringify({ pathname })
      }),
      onUploadCompleted: async ({ blob }) => {
        console.log('[blob-upload] Upload completed:', blob.url);
      }
    });

    return res.status(200).json(jsonResponse);
  } catch (err) {
    console.error('[blob-upload] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
