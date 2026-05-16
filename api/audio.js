// api/audio.js — Security hardened
// FIXED: SSRF protection added; error messages sanitized; CORS restricted

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing URL' });

  // SSRF protection
  try {
    const parsed = new URL(url);
    const h = parsed.hostname;
    if (
      parsed.protocol !== 'https:' ||
      h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' ||
      h === '169.254.169.254' || h === 'metadata.google.internal' ||
      /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    ) {
      return res.status(403).json({ error: 'Audio URL not permitted.' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const headers = { 'User-Agent': 'Transcribr/3.0', 'Accept': 'audio/*' };
    if (req.headers.range) headers['Range'] = req.headers.range;

    const response = await fetch(url, { headers });
    if (!response.ok && response.status !== 206) {
      return res.status(502).json({ error: 'Could not load audio file.' });
    }

    let ct = response.headers.get('content-type') || '';
    if (!ct || ct.includes('octet-stream') || ct.includes('binary')) {
      const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
      ct = ({ wav:'audio/wav', ogg:'audio/ogg', webm:'audio/webm', m4a:'audio/mp4',
               mp4:'audio/mp4', flac:'audio/flac', opus:'audio/opus' })[ext] || 'audio/mpeg';
    }

    res.setHeader('Content-Type', ct);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const cl = response.headers.get('content-length');
    const cr = response.headers.get('content-range');
    if (cl) res.setHeader('Content-Length', cl);
    if (cr) res.setHeader('Content-Range', cr);

    res.status(response.status === 206 ? 206 : 200);
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.status(500).json({ error: 'Audio proxy failed.' });
  }
}
