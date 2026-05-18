// middleware/usage.js — v3.1
// FIX: saveTranscript now uses correct column names matching the schema
// FIX: getUserPlanAndUsage handles missing tables gracefully

import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url) throw new Error('Missing SUPABASE_URL');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_KEY');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ── Plan definitions ──────────────────────────────────────────────
export const PLAN_LIMITS = {
  free:     { transcriptions: 3,        maxMinutesPerFile: 15,  totalLifetimeMinutes: 45,   label: 'Free' },
  starter:  { transcriptions: Infinity, maxMinutesPerFile: 60,  monthlyMinutes: 300,        label: 'Starter' },
  pro:      { transcriptions: Infinity, maxMinutesPerFile: 300, monthlyMinutes: 1500,       label: 'Pro' },
  business: { transcriptions: Infinity, maxMinutesPerFile: 600, monthlyMinutes: 5000,       label: 'Business' },
  admin:    { transcriptions: Infinity, maxMinutesPerFile: Infinity, monthlyMinutes: Infinity, label: 'Admin' },
};

// ── Engine access by plan ─────────────────────────────────────────
const PLAN_ENGINES = {
  free:     ['groq', 'deepgram'],
  starter:  ['groq', 'deepgram', 'assemblyai'],
  pro:      ['groq', 'deepgram', 'assemblyai'],
  business: ['groq', 'deepgram', 'assemblyai'],
  admin:    ['groq', 'deepgram', 'assemblyai'],
};

// Frontend mode → internal engine
export const MODE_TO_ENGINE = {
  auto:      'auto',
  fast:      'groq',
  balanced:  'deepgram',
  accurate:  'assemblyai',
  quick:     'groq',
  smart:     'auto',
  precision: 'assemblyai',
};

// ── Smart Auto routing ────────────────────────────────────────────
export function resolveSmartAutoEngine(req, plan) {
  const audioUrl = req.body?.audioUrl;
  const diarize  = req.body?.diarize === 'true' || req.body?.speakers === 'true';
  const lang     = req.body?.language || 'en';
  const fileSize = req.file?.size || 0;
  const isNonEn  = lang !== 'en' && lang !== 'auto';
  const canUseAssemblyAI = ['pro', 'business', 'admin', 'starter'].includes(plan);

  if (audioUrl) return 'deepgram';
  if (diarize) return canUseAssemblyAI ? 'assemblyai' : 'deepgram';
  if (fileSize > 20 * 1024 * 1024 || isNonEn) return 'deepgram';
  return 'groq';
}

// ── Admin check ───────────────────────────────────────────────────
async function isAdminUser(userId) {
  if (!userId) return false;
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();
    return data?.role === 'admin';
  } catch { return false; }
}

// ── Get user plan + usage ─────────────────────────────────────────
export async function getUserPlanAndUsage(userId) {
  const supabase = getSupabaseAdmin();
  try {
    const admin = await isAdminUser(userId);
    if (admin) {
      return {
        plan: 'admin', isAdmin: true,
        usedTranscriptions: 0, limitTranscriptions: Infinity,
        usedMinutes: 0, limitMinutes: Infinity,
        maxMinutesPerFile: Infinity, count: 0, limit: Infinity,
        usageMinutes: 0,
      };
    }

    // Check user_plans first (Razorpay), fall back to subscriptions
    let plan = 'free';
    try {
      const { data: planData } = await supabase
        .from('user_plans')
        .select('plan, status, plan_expires_at')
        .eq('user_id', userId)
        .single();

      if (planData) {
        if (planData.status !== 'active') {
          plan = 'free';
        } else if (planData.plan_expires_at && new Date(planData.plan_expires_at) < new Date()) {
          plan = 'free';
        } else {
          plan = planData.plan || 'free';
        }
      }
    } catch {
      // user_plans table may not exist yet — try subscriptions
      try {
        const { data: subData } = await supabase
          .from('subscriptions')
          .select('plan')
          .eq('user_id', userId)
          .single();
        plan = subData?.plan || 'free';
      } catch { plan = 'free'; }
    }

    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    // Free plan: count lifetime transcriptions
    if (plan === 'free') {
      let txCount = 0;
      let totalSeconds = 0;
      try {
        const { count } = await supabase
          .from('usage')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId);
        txCount = count || 0;

        const { data: minuteData } = await supabase
          .from('usage')
          .select('duration_seconds')
          .eq('user_id', userId);
        totalSeconds = (minuteData || []).reduce((s, r) => s + (r.duration_seconds || 0), 0);
      } catch { /* usage table may not exist yet */ }

      const usedMinutes = Math.ceil(totalSeconds / 60);
      return {
        plan, isAdmin: false,
        usedTranscriptions: txCount,
        limitTranscriptions: limits.transcriptions,
        usedMinutes,
        limitMinutes: limits.totalLifetimeMinutes || 45,
        maxMinutesPerFile: limits.maxMinutesPerFile,
        count: txCount, limit: limits.transcriptions,
        usageMinutes: usedMinutes,
      };
    }

    // Paid plan: monthly minutes
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    let totalSeconds = 0;
    try {
      const { data: usageData } = await supabase
        .from('usage')
        .select('duration_seconds')
        .eq('user_id', userId)
        .gte('created_at', startOfMonth.toISOString());
      totalSeconds = (usageData || []).reduce((s, r) => s + (r.duration_seconds || 0), 0);
    } catch { /* usage table may not exist */ }

    const usedMinutes = Math.ceil(totalSeconds / 60);
    const monthlyLimit = limits.monthlyMinutes || Infinity;

    return {
      plan, isAdmin: false,
      usedTranscriptions: Infinity, limitTranscriptions: Infinity,
      usedMinutes, limitMinutes: monthlyLimit,
      maxMinutesPerFile: limits.maxMinutesPerFile || Infinity,
      count: usedMinutes, limit: monthlyLimit,
      usageMinutes: usedMinutes,
    };

  } catch (err) {
    console.error('[getUserPlanAndUsage] error:', err.message);
    return {
      plan: 'free', isAdmin: false,
      usedTranscriptions: 0, limitTranscriptions: 3,
      usedMinutes: 0, limitMinutes: 45,
      maxMinutesPerFile: 15, count: 0, limit: 3,
      usageMinutes: 0,
    };
  }
}

// ── Middleware: check usage limits ────────────────────────────────
export async function checkUsageLimit(req, res, next) {
  if (!req.user) return next(); // guests handled on frontend

  try {
    const usage = await getUserPlanAndUsage(req.user.id);

    if (usage.isAdmin) {
      req.userPlan = 'admin';
      req.userUsage = usage;
      return next();
    }

    if (usage.plan === 'free' && usage.usedTranscriptions >= usage.limitTranscriptions) {
      return res.status(429).json({
        error: 'You have used all 3 transcriptions on the Free plan. Upgrade to Pro to continue.',
        code: 'USAGE_LIMIT',
        plan: 'free',
        upgradeUrl: '/pricing.html',
      });
    }

    if (usage.plan !== 'free' && isFinite(usage.limitMinutes) && usage.usedMinutes >= usage.limitMinutes) {
      return res.status(429).json({
        error: 'Your monthly usage limit has been reached. It resets at the start of next month.',
        code: 'MONTHLY_LIMIT',
        plan: usage.plan,
        upgradeUrl: '/pricing.html',
      });
    }

    req.userPlan = usage.plan;
    req.userUsage = usage;
    next();
  } catch {
    next(); // fail open — don't block transcription on usage check failure
  }
}

// ── Middleware: check engine access ───────────────────────────────
export async function checkEngineAccess(req, res, next) {
  const rawMode = req.body?.mode || 'auto';
  const engineKey = MODE_TO_ENGINE[rawMode] || 'groq';

  if (engineKey === 'auto' || engineKey === 'groq') return next();

  if (!req.user) {
    return res.status(403).json({
      error: 'Sign in to access additional AI engines.',
      code: 'AUTH_REQUIRED',
    });
  }

  try {
    const { plan, isAdmin } = await getUserPlanAndUsage(req.user.id);
    if (isAdmin) return next();

    const allowed = PLAN_ENGINES[plan] || PLAN_ENGINES.free;
    if (!allowed.includes(engineKey)) {
      const uiNames = { assemblyai: 'Precision AI', deepgram: 'Global AI' };
      return res.status(403).json({
        error: `${uiNames[engineKey] || 'This AI engine'} requires a Pro plan. Upgrade to access advanced processing.`,
        code: 'ENGINE_LOCKED',
        upgradeUrl: '/pricing.html',
      });
    }

    req.userPlan = plan;
    next();
  } catch {
    next(); // fail open
  }
}

// ── Record usage ──────────────────────────────────────────────────
export async function recordUsage(userId, engine, durationSeconds, filename) {
  if (!userId) return;
  try {
    const admin = await isAdminUser(userId);
    if (admin) return;
  } catch {}

  try {
    await getSupabaseAdmin().from('usage').insert({
      user_id: userId,
      engine: engine || 'groq',
      duration_seconds: Math.round(durationSeconds || 0),
      filename: filename || 'audio',
    });
  } catch (err) {
    console.error('[recordUsage] failed:', err.message);
  }
}

// ── Save transcript ───────────────────────────────────────────────
// FIX: Uses correct column names from the schema (transcriptions table)
// Old schema had 'title' — new schema uses 'filename'. Both are handled.
export async function saveTranscript(userId, data) {
  if (!userId) return null;
  const supabase = getSupabaseAdmin();

  const row = {
    user_id:          userId,
    filename:         data.title || data.filename || 'Untitled',
    transcript:       data.text || '',
    audio_url:        data.audioUrl || null,
    engine:           data.engine || 'groq',
    mode:             data.engine || 'groq',
    language:         data.language || 'en',
    duration_seconds: Math.round(data.durationSeconds || 0),
    file_size_mb:     parseFloat((data.fileSizeMb || 0).toFixed(2)),
  };

  try {
    // Try new schema (transcriptions table with 'filename' column)
    const { data: saved, error } = await supabase
      .from('transcriptions')
      .insert(row)
      .select()
      .single();

    if (error) {
      // Column 'filename' doesn't exist in old schema — try with 'title'
      if (error.code === '42703') {
        const oldRow = { ...row, title: row.filename };
        delete oldRow.filename;
        delete oldRow.mode;
        delete oldRow.file_size_mb;

        const { data: saved2, error: err2 } = await supabase
          .from('transcriptions')
          .insert(oldRow)
          .select()
          .single();

        if (err2) {
          // Try old table name as last resort
          if (err2.code === '42P01') {
            const { data: saved3, error: err3 } = await supabase
              .from('transcripts')
              .insert(oldRow)
              .select()
              .single();
            if (err3) throw new Error('saveTranscript all fallbacks failed: ' + err3.message);
            return saved3;
          }
          throw new Error('saveTranscript fallback failed: ' + err2.message);
        }
        return saved2;
      }
      throw new Error('saveTranscript failed: ' + error.message);
    }

    return saved;
  } catch (err) {
    console.error('[saveTranscript]', err.message);
    throw err;
  }
}
