import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url) throw new Error('Missing environment variable: SUPABASE_URL');
  if (!key) throw new Error('Missing environment variable: SUPABASE_SERVICE_KEY');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function getUserPlanAndUsage(userId) {
  const supabase = getSupabaseAdmin();
  return supabase.from('subscriptions').select('plan').eq('user_id', userId).single()
    .then(({ data }) => ({ plan: data?.plan || 'free', count: 0, limit: 10 }))
    .catch(() => ({ plan: 'free', count: 0, limit: 10 }));
}

export async function checkUsageLimit(req, res, next) {
  if (!req.user) return next(); // guest — handled frontend side
  try {
    const { count, limit } = await getUserPlanAndUsage(req.user.id);
    if (count >= limit) return res.status(429).json({ error: 'Monthly limit reached. Upgrade to Pro for unlimited transcriptions.' });
    next();
  } catch { next(); }
}

export async function checkEngineAccess(req, res, next) {
  const rawMode = req.body.mode || 'auto';
  const modeMap = { quick: 'fast', smart: 'balanced', precision: 'accurate', auto: 'auto' };
  const mode = modeMap[rawMode] || rawMode;
  if (mode === 'accurate' && req.user) {
    try {
      const { plan } = await getUserPlanAndUsage(req.user.id);
      if (!['pro', 'premium', 'admin'].includes(plan)) {
        return res.status(403).json({ error: 'Precision mode requires a Pro plan.' });
      }
    } catch { /* allow */ }
  }
  next();
}

export async function recordUsage(userId, engine, duration, filename) {
  if (!userId) return;
  try {
    await getSupabaseAdmin().from('usage').insert({
      user_id: userId,
      engine: engine || 'groq',
      duration_seconds: Math.round(duration || 0),
      filename: filename || 'audio'
    });
  } catch (err) {
    console.error('recordUsage failed:', err.message);
  }
}

// saveTranscript: only saves to DB for logged-in users
// Throws on error so the caller can surface it
export async function saveTranscript(userId, data) {
  if (!userId) return null; // guest — don't save
  const { data: saved, error } = await getSupabaseAdmin()
    .from('transcriptions')
    .insert({
      user_id: userId,
      filename: data.title || 'Untitled',
      transcript: data.text,
      audio_url: data.audioUrl || null,
      mode: data.engine || 'groq',
      language: data.language || 'en',
      duration_seconds: data.durationSeconds || 0,
      file_size_mb: data.fileSizeMb || 0
    })
    .select().single();
  if (error) throw new Error('saveTranscript failed: ' + error.message);
  return saved;
}
