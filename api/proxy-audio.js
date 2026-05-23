// api/proxy-audio.js
// Proxies audio from Supabase Storage with correct CORS headers for browser playback

export const config = { api: { responseLimit: '510mb' } };

function isSafeUrl(url) {
  try {
    const p = new URL(url);
    const h = p.hostname;
    if (p.protocol !== 'https:') return false;
    if (
      h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' ||
      h === '169.254.169.254' || h === 'metadata.google.internal' ||
      /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    ) return false;
    return true;
  } catch { return false; }
}

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGINS?.split(',')[0] || 'https://mytranscribr.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url param' });

  let decoded;
  try { decoded = decodeURIComponent(url); } catch { return res.status(400).end(); }

  if (!isSafeUrl(decoded)) return res.status(403).json({ error: 'URL not permitted' });

  // Only allow our own Supabase storage domain
  const supabaseHost = process.env.SUPABASE_URL
    ? new URL(process.env.SUPABASE_URL).hostname
    : null;
  if (supabaseHost) {
    const reqHost = new URL(decoded).hostname;
    if (reqHost !== supabaseHost) {
      return res.status(403).json({ error: 'Only Supabase storage URLs are allowed' });
    }
  }

  try {
    const headers = {
      'User-Agent': 'Transcribr/3.0',
    };
    // Forward Range header for seeking support
    if (req.headers['range']) headers['Range'] = req.headers['range'];

    const upstream = await fetch(decoded, { headers });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).end();
    }

    const contentType = upstream.headers.get('content-type') || 'audio/mpeg';
    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange)  res.setHeader('Content-Range', contentRange);

    res.status(upstream.status);
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: 'Proxy error' });
  }
}
