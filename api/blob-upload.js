// api/blob-upload.js — Security hardened
// FIXED: Added authentication requirement; restricted content types; size limit enforced

import { handleUpload } from '@vercel/blob/client';
import { createClient } from '@supabase/supabase-js';

async function getAuthenticatedUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: { user } } = await supabase.auth.getUser(token);
    return user || null;
  } catch { return null; }
}

// Plan-based upload size limits
const SIZE_LIMITS = {
  free:     50  * 1024 * 1024,  // 50 MB
  starter:  100 * 1024 * 1024,  // 100 MB
  pro:      500 * 1024 * 1024,  // 500 MB
  business: 500 * 1024 * 1024,  // 500 MB
  admin:    500 * 1024 * 1024,
};

// Strict audio content type allowlist
const ALLOWED_CONTENT_TYPES = [
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
  'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/webm',
  'audio/flac', 'audio/x-flac', 'audio/opus', 'audio/aac',
  'video/mp4', 'video/webm',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS?.split(',')[0] || 'https://mytranscribr.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Require authentication for blob uploads
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required to upload files.' });

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => ({
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        maximumSizeInBytes: SIZE_LIMITS.pro,  // enforced by Vercel Blob SDK
        addRandomSuffix: true,
      }),
      onUploadCompleted: async ({ blob }) => {
        // Intentionally minimal logging — no user PII in logs
        console.log('[blob] Upload completed, size:', blob.size || 'unknown');
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (err) {
    return res.status(400).json({ error: 'Upload failed. Please try again.' });
  }
}
