// api/audio.js — Audio proxy
// Streams remote audio through the server with correct Content-Type headers
// Supports Range requests so the browser's native audio player can seek

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing URL');

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0',
      'Accept': '*/*',
    };

    // Forward Range header so seeking works
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const response = await fetch(url, { headers });

    if (!response.ok && response.status !== 206) {
      return res.status(502).send(`Remote audio returned HTTP ${response.status}`);
    }

    // Use the actual Content-Type from the remote server
    // Fall back to inferring from URL extension, then default to audio/mpeg
    let contentType = response.headers.get('content-type') || '';
    if (!contentType || contentType === 'application/octet-stream' || contentType.includes('binary')) {
      // Infer from URL
      const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
      contentType = ext === 'wav'  ? 'audio/wav'
        : ext === 'ogg'  ? 'audio/ogg'
        : ext === 'webm' ? 'audio/webm'
        : ext === 'm4a'  ? 'audio/mp4'
        : ext === 'mp4'  ? 'audio/mp4'
        : ext === 'flac' ? 'audio/flac'
        : ext === 'opus' ? 'audio/opus'
        : 'audio/mpeg'; // default: MP3
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // Forward Content-Length and Content-Range if present (needed for seeking)
    const contentLength = response.headers.get('content-length');
    const contentRange = response.headers.get('content-range');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);

    res.status(response.status === 206 ? 206 : 200);

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));

  } catch (err) {
    console.error('[audio proxy] Error:', err.message);
    res.status(500).send('Audio proxy failed: ' + err.message);
  }
}
