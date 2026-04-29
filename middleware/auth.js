// middleware/auth.js
import { createClient } from '@supabase/supabase-js';

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY; // use anon key for auth

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }

  return createClient(url, key);
}

// Optional auth → allows guest + logged-in users
export async function optionalAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];

    if (!token) {
      req.user = null; // guest user
      return next();
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      req.user = null; // invalid token → treat as guest
    } else {
      req.user = data.user; // logged-in user
    }

    next();
  } catch (err) {
    console.error('Auth error:', err.message);
    req.user = null;
    next(); // do NOT block
  }
}

// Strict auth → ONLY for protected routes (like subscription)
export async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Login required' });
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    req.user = data.user;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Auth failed: ' + err.message });
  }
}