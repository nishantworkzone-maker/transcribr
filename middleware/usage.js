import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url) throw new Error('Missing environment variable: SUPABASE_URL');
  if (!key) throw new Error('Missing environment variable: SUPABASE_SERVICE_KEY');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Plan limits: minutes per month
const PLAN_LIMITS = {
  free:     { minutes: 30,   uploads_mb: 25,   label: 'Free' },
  starter:  { minutes: 300,  uploads_mb: 100,  label: 'Starter' },
  pro:      { minutes: 1500, uploads_mb: 500,  label: 'Pro' },
  business: { minutes: 5000, uploads_mb: 2048, label: 'Business' },
  admin:    { minutes: 99999,uploads_mb: 2048, label: 'Admin' },
  premium:  { minutes: 1500, uploads_mb: 500,  label: 'Premium' },
};

// Engine access by plan
const PLAN_ENGINES = {
  free:     ['groq'],
  starter:  ['groq', 'whisper'],
  pro:      ['groq', 'whisper', 'deepgram'],
  business: ['groq', 'whisper', 'deepgram', 'assemblyai'],
  admin:    ['groq', 'whisper', 'deepgram', 'assemblyai'],
  premium:  ['groq', 'whisper', 'deepgram', 'assemblyai'],
};

// Engine mode mapping to provider keys
const MODE_TO_ENGINE = {
  quick: 'groq', fast: 'groq',
  smart: 'deepgram', balanced: 'deepgram',
  precision: 'whisper', accurate: 'whisper',
  assemblyai: 'assemblyai',
  auto: 'groq',
};

export async function getUserPlanAndUsage(userId) {
  const supabase = getSupabaseAdmin();
  try {
    // Read plan from user_plans (Razorpay)
    let plan = 'free';
    const { data: planData } = await supabase
      .from('user_plans')
      .select('plan, status, plan_expires_at')
      .eq('user_id', userId)
      .single();

    if (planData) {
      // Check expiry — expired paid plans revert to free
      if (planData.plan !== 'free' && planData.plan_expires_at) {
        plan = new Date(planData.plan_expires_at) > new Date() ? planData.plan : 'free';
      } else {
        plan = planData.plan || 'free';
      }
    }
    // No fallback to subscriptions — user_plans is the single source of truth

    // Get this month's usage in minutes
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: usageData } = await supabase
      .from('usage')
      .select('duration_seconds')
      .eq('user_id', userId)
      .gte('created_at', startOfMonth.toISOString());

    const totalSeconds = (usageData || []).reduce((sum, r) => sum + (r.duration_seconds || 0), 0);
    const usedMinutes = Math.ceil(totalSeconds / 60);
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    return {
      plan,
      usedMinutes,
      limitMinutes: limits.minutes,
      uploadLimitMb: limits.uploads_mb,
      count: usedMinutes,
      limit: limits.minutes,
    };
  } catch (err) {
    console.error('getUserPlanAndUsage error:', err.message);
    return { plan: 'free', usedMinutes: 0, limitMinutes: 30, uploadLimitMb: 25, count: 0, limit: 30 };
  }
}

export async function checkUsageLimit(req, res, next) {
  if (!req.user) return next(); // guest handled frontend
  try {
    const { usedMinutes, limitMinutes, plan } = await getUserPlanAndUsage(req.user.id);
    if (usedMinutes >= limitMinutes) {
      return res.status(429).json({
        error: `Monthly limit reached (${limitMinutes} min). Upgrade your plan at transcribr.app/pricing.html`,
        code: 'USAGE_LIMIT',
        plan,
        used: usedMinutes,
        limit: limitMinutes,
      });
    }
    req.userPlan = plan;
    req.usedMinutes = usedMinutes;
    next();
  } catch { next(); }
}

export async function checkEngineAccess(req, res, next) {
  const rawMode = (req.body && req.body.mode) || 'auto';
  const engineKey = MODE_TO_ENGINE[rawMode] || 'groq';

  if (engineKey === 'groq' || !req.user) return next(); // free engine always allowed

  try {
    const { plan } = await getUserPlanAndUsage(req.user.id);
    const allowed = PLAN_ENGINES[plan] || PLAN_ENGINES.free;

    if (!allowed.includes(engineKey)) {
      const engineNames = { whisper: 'Precision AI', deepgram: 'Global AI', assemblyai: 'Smart AI' };
      return res.status(403).json({
        error: `${engineNames[engineKey] || engineKey} requires a higher plan. Upgrade at transcribr.app/pricing.html`,
        code: 'ENGINE_LOCKED',
        required: engineKey === 'whisper' ? 'starter' : engineKey === 'deepgram' ? 'pro' : 'business',
      });
    }
    req.userPlan = plan;
    next();
  } catch { next(); }
}

export async function checkFileSizeLimit(req, res, next) {
  // File size is checked by the multipart parser in transcribe.js
  // This middleware sets the limit on req for downstream use
  if (!req.user) {
    req.fileSizeLimitMb = 25; // guest
    return next();
  }
  try {
    const { plan, uploadLimitMb } = await getUserPlanAndUsage(req.user.id);
    req.fileSizeLimitMb = uploadLimitMb;
    req.userPlan = plan;
    next();
  } catch {
    req.fileSizeLimitMb = 25;
    next();
  }
}

export async function recordUsage(userId, engine, durationSeconds, filename) {
  if (!userId) return;
  try {
    await getSupabaseAdmin().from('usage').insert({
      user_id: userId,
      engine: engine || 'groq',
      duration_seconds: Math.round(durationSeconds || 0),
      filename: filename || 'audio'
    });
  } catch (err) {
    console.error('recordUsage failed:', err.message);
  }
}

export async function saveTranscript(userId, data) {
  if (!userId) return null;
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
