import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'No URL provided' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': '*/*'
      }
    });

    if (!response.ok) {
      return res.status(500).json({ error: 'Failed to fetch audio' });
    }

    const buffer = await response.arrayBuffer();

    const fileName = `audio-${Date.now()}.wav`;

    const { error } = await supabase.storage
      .from('audio-files')
      .upload(fileName, Buffer.from(buffer), {
        contentType: 'audio/wav'
      });

    if (error) {
      return res.status(500).json({ error: 'Upload failed' });
    }

    const { data } = supabase.storage
      .from('audio-files')
      .getPublicUrl(fileName);

    res.json({
      success: true,
      audioUrl: data.publicUrl
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}