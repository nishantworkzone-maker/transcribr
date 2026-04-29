// middleware/usage.js
import { createClient } from '@supabase/supabase-js';

const PLAN_LIMITS = { free: 3, pro: 999999, premium: 999999 };
const PLAN_ENGINES = {
  free: ['groq'],
  pro: ['groq', 'deepgram'],
  premium: ['groq', 'deepgram', 'assemblyai']
};

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url) throw new Error('Missing environment variable: SUPABASE_URL');
  if (!key) throw new Error('Missing environment variable: SUPABASE_SERVICE_KEY');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function getUserPlanAndUsage(userId) {
  const supabase = getSupabaseAdmin();
  const { data: sub } = await supabase
    .from('subscriptions').select('plan').eq('user_id', userId).single();
  const plan = sub?.plan || 'free';
  const { count } = await supabase
    .from('usage').select('*', { count: 'exact', head: true }).eq('user_id', userId);
  return { plan, count: count || 0, limit: PLAN_LIMITS[plan] };
}

// checkUsageLimit:
//   - Guest (no login): always allowed — frontend tracks 3-use limit via localStorage
//   - Logged-in user: check Supabase usage count against plan limit
export async function checkUsageLimit(req, res, next) {
  if (!req.user) {
    // Guest mode — backend does not block, frontend enforces localStorage limit
    req.userPlan = 'guest';
    req.usageCount = 0;
    return next();
  }

  try {
    const { plan, count, limit } = await getUserPlanAndUsage(req.user.id);
    req.userPlan = plan;
    req.usageCount = count;

    if (count >= limit) {
      return res.status(403).json({
        error: 'transcription_limit_reached',
        message: `You've used all ${limit} transcriptions on the ${plan} plan.`,
        plan, count, limit,
        upgrade_url: '/pricing.html'
      });
    }
    next();
  } catch (err) {
    console.error('Usage check error:', err.message);
    return res.status(500).json({ error: 'Could not verify usage limits' });
  }
}

// checkEngineAccess: guests and free users get Groq only
export function checkEngineAccess(req, res, next) {
  const plan = req.userPlan || 'guest';
  const modeToEngine = { fast: 'groq', balanced: 'deepgram', accurate: 'assemblyai' };
  const engine = modeToEngine[req.body.mode] || 'groq';
  const allowedEngines = (plan === 'guest' || plan === 'free')
    ? ['groq']
    : (PLAN_ENGINES[plan] || ['groq']);

  if (!allowedEngines.includes(engine)) {
    return res.status(403).json({
      error: 'engine_not_allowed',
      message: `The "${req.body.mode}" mode requires a higher plan. You are on the ${plan} plan.`,
      plan, upgrade_url: '/pricing.html'
    });
  }
  next();
}

// recordUsage: only saves to DB for logged-in users
export async function recordUsage(userId, engine, durationSeconds = 0, title = '') {
  if (!userId) return; // guest — nothing to save
  try {
    await getSupabaseAdmin().from('usage').insert({
      user_id: userId,
      engine,
      duration_seconds: Math.round(durationSeconds),
      title: title || 'Untitled'
    });
  } catch (err) {
    console.error('Failed to record usage:', err.message);
  }
}

// saveTranscript: only saves to DB for logged-in users
export async function saveTranscript(userId, data) {
  if (!userId) return null; // guest — don't save
  try {
    const { data: saved, error } = await getSupabaseAdmin()
      .from('transcripts')
      .insert({
        user_id: userId,
        title: data.title || 'Untitled',
        transcript: data.text,
        masked_transcript: data.maskedText || null,
        audio_url: data.audioUrl || null,
        engine: data.engine,
        language: data.language || 'en',
        pii_detected: data.piiDetected || false,
        speaker_count: data.speakerCount || 1
      })
      .select().single();
    if (error) throw error;
    return saved;
  } catch (err) {
    console.error('Failed to save transcript:', err.message);
    return null;
  }
}
