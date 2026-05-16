// middleware/auth.js — Security hardened
// FIXED: Token extraction uses safer parsing; error messages sanitized

import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Safely extract Bearer token — guards against header injection tricks
function extractBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  // Basic sanity check: JWTs are at least 20 chars and contain dots
  if (!token || token.length < 20 || !token.includes('.')) return null;
  return token;
}

// requireAuth: BLOCKS request if no valid token
export async function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated. Please log in first.' });
  }
  try {
    const { data: { user }, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });
    req.user = user;
    next();
  } catch {
    res.status(500).json({ error: 'Authentication check failed.' });
  }
}

// optionalAuth: NEVER blocks — guests get req.user = null
export async function optionalAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const { data: { user } } = await getSupabaseAdmin().auth.getUser(token);
    req.user = user || null;
  } catch {
    req.user = null;
  }
  next();
}
