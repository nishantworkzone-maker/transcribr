// middleware/auth.js
// Checks if the user is logged in before allowing access to protected routes
// It reads the user's token from the request header and verifies it with Supabase

import { createClient } from '@supabase/supabase-js';

// Create a Supabase admin client using your service key
// This is only used on the SERVER — never expose this key in the browser
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error('Missing environment variable: SUPABASE_URL — please add it in Vercel → Settings → Environment Variables');
  }
  if (!key) {
    throw new Error('Missing environment variable: SUPABASE_SERVICE_KEY — please add it in Vercel → Settings → Environment Variables');
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/**
 * Middleware: requires user to be authenticated
 * Attach the user to req.user if valid, or return 401 Unauthorized
 */
export async function requireAuth(req, res, next) {
  // Get the Authorization header — looks like: "Bearer eyJhbGci..."
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Not authenticated. Please log in first.'
    });
  }

  const token = authHeader.split(' ')[1]; // Extract just the token part

  try {
    const supabase = getSupabaseAdmin();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        error: 'Invalid or expired session. Please log in again.'
      });
    }

    // Attach user to request so later middlewares/routes can use it
    req.user = user;
    next(); // Continue to the next middleware or route handler

  } catch (err) {
    console.error('Auth middleware error:', err.message);
    return res.status(500).json({ error: 'Authentication check failed' });
  }
}

/**
 * Optional auth: attaches user if token is present, but doesn't block if missing
 * Useful for routes that work for both guests and logged-in users
 */
export async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(' ')[1];

  try {
    const supabase = getSupabaseAdmin();
    const { data: { user } } = await supabase.auth.getUser(token);
    req.user = user || null;
  } catch {
    req.user = null;
  }

  next();
}
