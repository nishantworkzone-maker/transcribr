// api/config.js — Hardened
// FIXED: Error response no longer reveals which specific env vars are missing

export default function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300'); // cache 5 min

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Don't reveal which var is missing — just a generic config error
    return res.status(500).json({ error: 'Server configuration error. Contact support.' });
  }

  return res.status(200).json({ supabaseUrl, supabaseKey });
}
