// middleware/usage.js
// Tracks how many transcriptions a user has done
// Blocks free users after 3 transcriptions
// Restricts AssemblyAI engine to paid users only

import { createClient } from '@supabase/supabase-js';

// Plan limits — easy to update in one place
const PLAN_LIMITS = {
  free: 3,       // 3 total transcriptions
  pro: 999999,   // Unlimited
  premium: 999999 // Unlimited
};

// Which engines each plan can use
const PLAN_ENGINES = {
  free: ['groq'],                         // Free: Groq only
  pro: ['groq', 'deepgram'],              // Pro: Groq + Deepgram
  premium: ['groq', 'deepgram', 'assemblyai'] // Premium: All engines
};

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url) throw new Error('Missing environment variable: SUPABASE_URL');
  if (!key) throw new Error('Missing environment variable: SUPABASE_SERVICE_KEY');

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/**
 * Gets user's current plan and transcription count
 */
export async function getUserPlanAndUsage(userId) {
  const supabase = getSupabaseAdmin();

  // Get their subscription plan
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plan')
    .eq('user_id', userId)
    .single();

  const plan = sub?.plan || 'free';

  // Count their transcriptions
  const { count } = await supabase
    .from('usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  return { plan, count: count || 0, limit: PLAN_LIMITS[plan] };
}

/**
 * Middleware: checks usage limits before allowing transcription
 * Must be used AFTER requireAuth middleware
 */
export async function checkUsageLimit(req, res, next) {
  // req.user is set by requireAuth middleware
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  try {
    const { plan, count, limit } = await getUserPlanAndUsage(userId);

    // Attach to request for the route to use
    req.userPlan = plan;
    req.usageCount = count;

    if (count >= limit) {
      return res.status(403).json({
        error: 'transcription_limit_reached',
        message: `You've used all ${limit} transcription${limit === 1 ? '' : 's'} on the ${plan} plan.`,
        plan,
        count,
        limit,
        upgrade_url: '/pricing.html'
      });
    }

    next();

  } catch (err) {
    console.error('Usage check error:', err.message);
    return res.status(500).json({ error: 'Could not verify usage limits' });
  }
}

/**
 * Middleware: checks if the requested engine is allowed for user's plan
 * Must be used AFTER checkUsageLimit
 */
export function checkEngineAccess(req, res, next) {
  const plan = req.userPlan || 'free';
  const requestedEngine = req.body.mode; // 'fast' | 'balanced' | 'accurate'

  // Map the mode name to an engine name
  const modeToEngine = {
    fast: 'groq',
    balanced: 'deepgram',
    accurate: 'assemblyai'
  };

  const engine = modeToEngine[requestedEngine] || 'groq';
  const allowedEngines = PLAN_ENGINES[plan] || PLAN_ENGINES.free;

  if (!allowedEngines.includes(engine)) {
    return res.status(403).json({
      error: 'engine_not_allowed',
      message: `The "${requestedEngine}" mode requires a higher plan. You're on the ${plan} plan.`,
      plan,
      upgrade_url: '/pricing.html'
    });
  }

  next();
}

/**
 * Records a completed transcription in the database
 * Call this AFTER a successful transcription
 */
export async function recordUsage(userId, engine, durationSeconds = 0, title = '') {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from('usage').insert({
      user_id: userId,
      engine,
      duration_seconds: Math.round(durationSeconds),
      title: title || 'Untitled'
    });
  } catch (err) {
    // Don't crash if usage recording fails — just log it
    console.error('Failed to record usage:', err.message);
  }
}

/**
 * Saves the completed transcript to the database
 */
export async function saveTranscript(userId, data) {
  try {
    const supabase = getSupabaseAdmin();
    const { data: saved, error } = await supabase
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
      .select()
      .single();

    if (error) throw error;
    return saved;

  } catch (err) {
    console.error('Failed to save transcript:', err.message);
    return null;
  }
}
