export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send('Missing URL');
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': '*/*'
      }
    });

    if (!response.ok) {
      console.error('Fetch failed:', response.status);
      return res.status(500).send('Failed to fetch audio');
    }

    const buffer = await response.arrayBuffer();

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Access-Control-Allow-Origin', '*');

    res.send(Buffer.from(buffer));

  } catch (err) {
    console.error('Audio proxy error:', err);
    res.status(500).send('Audio proxy failed');
  }
}