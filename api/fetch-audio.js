// api/fetch-audio.js — Security hardened
// FIXED: Was completely unauthenticated open SSRF proxy; now requires auth + SSRF protection

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

// Max size: 200MB
const MAX_BYTES = 200 * 1024 * 1024;

function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    const h = parsed.hostname;
    if (parsed.protocol !== 'https:') return false;
    if (
      h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' ||
      h === '169.254.169.254' || h === 'metadata.google.internal' ||
      /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    ) return false;
    return true;
  } catch { return false; }
}

async function getAuthenticatedUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    return user || null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Require authentication
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required.' });

  const { url } = req.body;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'No URL provided' });
  if (url.length > 2048) return res.status(400).json({ error: 'URL too long.' });
  if (!isSafeUrl(url)) return res.status(403).json({ error: 'This URL is not permitted.' });

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Transcribr/3.0', 'Accept': 'audio/*,video/*' },
    });

    if (!response.ok) return res.status(500).json({ error: 'Failed to fetch audio' });

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_BYTES) return res.status(413).json({ error: 'File too large.' });

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) return res.status(413).json({ error: 'File too large.' });

    const fileName = `audio-${user.id.slice(0, 8)}-${Date.now()}.wav`;

    const { error } = await supabase.storage
      .from('audio-files')
      .upload(fileName, Buffer.from(buffer), { contentType: 'audio/wav' });

    if (error) return res.status(500).json({ error: 'Upload failed' });

    const { data } = supabase.storage.from('audio-files').getPublicUrl(fileName);
    res.json({ success: true, audioUrl: data.publicUrl });

  } catch {
    res.status(500).json({ error: 'Something went wrong' });
  }
}
