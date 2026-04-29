// middleware/usage.js
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  return createClient(url, key);
}

// Usage middleware
export async function checkUsage(req, res, next) {
  try {
    // 👤 LOGGED-IN USER
    if (req.user) {
      const supabase = getSupabaseAdmin();

      const { count, error } = await supabase
        .from('usage')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', req.user.id);

      if (error) {
        console.error('Usage check error:', error.message);
        return next(); // don't block
      }

      if (count >= 3) {
        return res.status(403).json({
          error: 'Free limit reached. Please upgrade.'
        });
      }

      return next();
    }

    // 👤 GUEST USER
    // Do NOT block — frontend will handle limit via localStorage
    return next();

  } catch (err) {
    console.error('Usage middleware error:', err.message);
    next(); // don't block
  }
}