// middleware/auth.js
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// requireAuth: BLOCKS request if no token — use for delete/save routes only
export async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated. Please log in first.' });
  }
  try {
    const { data: { user }, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Auth check failed: ' + err.message });
  }
}

// optionalAuth: NEVER blocks — guests get req.user = null, logged-in users get req.user = {...}
// This is what the /api/transcribe route uses
export async function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) {
    req.user = null;
    return next(); // guest — let them through
  }
  try {
    const { data: { user } } = await getSupabaseAdmin().auth.getUser(token);
    req.user = user || null;
  } catch {
    req.user = null; // token failed — still treat as guest, don't block
  }
  next();
}
