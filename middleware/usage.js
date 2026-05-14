// middleware/usage.js — Transcribr v3
// Admin bypass · IP-aware pricing · Smart Auto routing · Professional error messages

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
  free:     { transcriptions: 3, maxMinutesPerFile: 15, totalLifetimeMinutes: 45, label: 'Free' },
  pro:      { transcriptions: Infinity, maxMinutesPerFile: Infinity, totalLifetimeMinutes: Infinity, monthlyMinutes: 1500, label: 'Pro' },
  business: { transcriptions: Infinity, maxMinutesPerFile: Infinity, totalLifetimeMinutes: Infinity, monthlyMinutes: 5000, label: 'Business' },
  admin:    { transcriptions: Infinity, maxMinutesPerFile: Infinity, totalLifetimeMinutes: Infinity, monthlyMinutes: Infinity, label: 'Admin' },
};

// ── Engine access by plan ─────────────────────────────────────────
// Internal engine keys — never exposed to frontend
const PLAN_ENGINES = {
  free:     ['groq', 'deepgram'],          // Smart Auto uses groq + deepgram only
  pro:      ['groq', 'deepgram', 'assemblyai'],
  business: ['groq', 'deepgram', 'assemblyai'],
  admin:    ['groq', 'deepgram', 'assemblyai'],
};

// Frontend mode → internal engine mapping
// These names are NEVER shown to users — frontend shows: Smart Auto, Turbo AI, Global AI, Precision AI
export const MODE_TO_ENGINE = {
  auto:      'auto',        // Smart Auto — resolved dynamically
  fast:      'groq',        // Turbo AI
  balanced:  'deepgram',    // Global AI
  accurate:  'assemblyai',  // Precision AI — Pro+ only
  // Legacy aliases
  quick:     'groq',
  smart:     'auto',
  precision: 'assemblyai',
};

// ── Smart Auto routing logic ──────────────────────────────────────
// NEVER expose this logic to frontend — internal only
export function resolveSmartAutoEngine(req, plan) {
  const audioUrl   = req.body?.audioUrl;
  const diarize    = req.body?.diarize === 'true' || req.body?.speakers === 'true';
  const lang       = req.body?.language || 'en';
  const fileSize   = req.file?.size || 0;
  const isNonEn    = lang !== 'en' && lang !== 'auto';

  const canUseAssemblyAI = ['pro', 'business', 'admin'].includes(plan);

  // URL input → always Deepgram (more reliable for remote URLs)
  if (audioUrl) return 'deepgram';

  // Diarization needed → Deepgram or AssemblyAI
  if (diarize) return canUseAssemblyAI ? 'assemblyai' : 'deepgram';

  // Large file or non-English → Deepgram
  if (fileSize > 20 * 1024 * 1024 || isNonEn) return 'deepgram';

  // Default: Groq (fastest, cheapest for simple files)
  return 'groq';
}

// ── Admin detection — backend only, never expose to frontend ──────
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
  } catch {
    return false;
  }
}

// ── Get user plan with admin bypass ──────────────────────────────
export async function getUserPlanAndUsage(userId) {
  const supabase = getSupabaseAdmin();
  try {
    // Check admin first
    const admin = await isAdminUser(userId);
    if (admin) {
      return {
        plan: 'admin',
        isAdmin: true,
        usedTranscriptions: 0,
        limitTranscriptions: Infinity,
        usedMinutes: 0,
        limitMinutes: Infinity,
        maxMinutesPerFile: Infinity,
        count: 0,
        limit: Infinity,
      };
    }

    // Check user_plans (Razorpay), fall back to subscriptions
    let plan = 'free';
    const { data: planData } = await supabase
      .from('user_plans')
      .select('plan, status, plan_expires_at')
      .eq('user_id', userId)
      .single();

    if (planData) {
      if (planData.plan !== 'free' && planData.plan_expires_at) {
        plan = new Date(planData.plan_expires_at) > new Date() ? planData.plan : 'free';
      } else {
        plan = planData.plan || 'free';
      }
    } else {
      const { data: subData } = await supabase
        .from('subscriptions')
        .select('plan')
        .eq('user_id', userId)
        .single();
      plan = subData?.plan || 'free';
    }

    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    // For free users: count lifetime transcriptions
    if (plan === 'free') {
      const { count: txCount } = await supabase
        .from('usage')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      const { data: minuteData } = await supabase
        .from('usage')
        .select('duration_seconds')
        .eq('user_id', userId);

      const totalSeconds = (minuteData || []).reduce((s, r) => s + (r.duration_seconds || 0), 0);
      const usedMinutes = Math.ceil(totalSeconds / 60);

      return {
        plan,
        isAdmin: false,
        usedTranscriptions: txCount || 0,
        limitTranscriptions: limits.transcriptions,
        usedMinutes,
        limitMinutes: limits.totalLifetimeMinutes,
        maxMinutesPerFile: limits.maxMinutesPerFile,
        count: txCount || 0,
        limit: limits.transcriptions,
      };
    }

    // For paid users: monthly minutes
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: usageData } = await supabase
      .from('usage')
      .select('duration_seconds')
      .eq('user_id', userId)
      .gte('created_at', startOfMonth.toISOString());

    const totalSeconds = (usageData || []).reduce((s, r) => s + (r.duration_seconds || 0), 0);
    const usedMinutes = Math.ceil(totalSeconds / 60);
    const monthlyLimit = limits.monthlyMinutes || Infinity;

    return {
      plan,
      isAdmin: false,
      usedTranscriptions: Infinity,
      limitTranscriptions: Infinity,
      usedMinutes,
      limitMinutes: monthlyLimit,
      maxMinutesPerFile: Infinity,
      count: usedMinutes,
      limit: monthlyLimit,
    };

  } catch (err) {
    console.error('getUserPlanAndUsage error:', err.message);
    return {
      plan: 'free', isAdmin: false,
      usedTranscriptions: 0, limitTranscriptions: 3,
      usedMinutes: 0, limitMinutes: 45,
      maxMinutesPerFile: 15, count: 0, limit: 3,
    };
  }
}

// ── Middleware: check usage limits ────────────────────────────────
export async function checkUsageLimit(req, res, next) {
  if (!req.user) return next(); // guests handled on frontend

  try {
    const usage = await getUserPlanAndUsage(req.user.id);

    // Admin bypass — no limits at all
    if (usage.isAdmin) {
      req.userPlan = 'admin';
      req.userUsage = usage;
      return next();
    }

    // Free plan: check lifetime transcription count
    if (usage.plan === 'free') {
      if (usage.usedTranscriptions >= usage.limitTranscriptions) {
        return res.status(429).json({
          error: 'You have used all 3 transcriptions included in the Free plan. Upgrade to Pro to continue with unlimited transcriptions.',
          code: 'USAGE_LIMIT',
          plan: 'free',
          upgradeUrl: '/pricing.html',
        });
      }
    }

    // Paid plan: check monthly minutes
    if (usage.plan !== 'free' && usage.usedMinutes >= usage.limitMinutes) {
      return res.status(429).json({
        error: 'Your monthly usage limit has been reached. Your limit resets at the start of next month.',
        code: 'MONTHLY_LIMIT',
        plan: usage.plan,
        upgradeUrl: '/pricing.html',
      });
    }

    req.userPlan = usage.plan;
    req.userUsage = usage;
    next();
  } catch {
    next();
  }
}

// ── Middleware: check engine access ───────────────────────────────
export async function checkEngineAccess(req, res, next) {
  const rawMode = req.body?.mode || 'auto';
  const engineKey = MODE_TO_ENGINE[rawMode] || 'groq';

  // Smart Auto and Turbo AI are always allowed
  if (engineKey === 'auto' || engineKey === 'groq') return next();

  if (!req.user) {
    // Guests can only use auto/groq
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
      // Professional user-facing error — no internal engine names
      const uiNames = { assemblyai: 'Precision AI' };
      return res.status(403).json({
        error: `${uiNames[engineKey] || 'This AI engine'} is available on the Pro plan. Upgrade to access advanced AI processing.`,
        code: 'ENGINE_LOCKED',
        upgradeUrl: '/pricing.html',
      });
    }

    req.userPlan = plan;
    next();
  } catch {
    next();
  }
}

// ── Record usage ──────────────────────────────────────────────────
export async function recordUsage(userId, engine, durationSeconds, filename) {
  if (!userId) return;
  // Never record usage for admin
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
    console.error('recordUsage failed:', err.message);
  }
}

// ── Save transcript ───────────────────────────────────────────────
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
      file_size_mb: data.fileSizeMb || 0,
    })
    .select().single();
  if (error) throw new Error('saveTranscript failed: ' + error.message);
  return saved;
}
