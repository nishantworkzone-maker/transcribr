// api/blob-upload.js
// Handles the token exchange for client-side direct uploads to Vercel Blob
// The browser never sends the file through our server — it goes directly to Blob CDN

import { handleUpload } from '@vercel/blob/client';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Parse request body (small JSON — well under 4.5MB limit)
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        return {
          allowedContentTypes: [
            'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/mp4',
            'audio/m4a', 'audio/ogg', 'audio/webm', 'audio/flac',
            'video/mp4', 'application/octet-stream'
          ],
          maximumSizeInBytes: 500 * 1024 * 1024, // 500MB
          tokenPayload: JSON.stringify({ pathname })
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('[blob] Upload completed:', blob.url);
      }
    });

    return res.status(200).json(jsonResponse);
  } catch (err) {
    console.error('[blob-upload] Error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
