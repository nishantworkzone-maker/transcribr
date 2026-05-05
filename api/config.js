// api/config.js — Vercel Serverless Function
// Exposes public Supabase credentials to the frontend
// All values are injected by Vercel from Dashboard → Environment Variables

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[config] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return res.status(500).json({
      error: 'Server configuration missing. Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel Dashboard → Settings → Environment Variables.',
      missing: [
        !supabaseUrl && 'SUPABASE_URL',
        !supabaseKey && 'SUPABASE_ANON_KEY'
      ].filter(Boolean)
    });
  }

  return res.status(200).json({ supabaseUrl, supabaseKey });
}
