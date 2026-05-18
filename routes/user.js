// routes/user.js — v3.1
// FIX: /api/user/me now returns usageMinutes field used by dashboard usage tracker
// FIX: UUID validation on all :id params
// FIX: graceful handling when tables don't exist yet

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth.js';
import { getUserPlanAndUsage } from '../middleware/usage.js';

const router = express.Router();

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// ── GET /api/user/me ──────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const {
      plan, isAdmin,
      usedTranscriptions, limitTranscriptions,
      usedMinutes, limitMinutes,
      maxMinutesPerFile, count, usageMinutes,
    } = await getUserPlanAndUsage(req.user.id);

    res.json({
      id:    req.user.id,
      email: req.user.email,
      name:  req.user.user_metadata?.full_name || req.user.email,
      // Never expose 'admin' plan string to frontend — show as 'pro'
      plan:  isAdmin ? 'pro' : plan,
      isAdmin,
      usedTranscriptions:  isAdmin ? 0    : (usedTranscriptions || 0),
      limitTranscriptions: isAdmin ? null : (limitTranscriptions || 3),
      usedMinutes:         isAdmin ? 0    : (usedMinutes || 0),
      limitMinutes:        isAdmin ? null : (limitMinutes || 30),
      maxMinutesPerFile:   isAdmin ? null : (maxMinutesPerFile || 15),
      usageCount:          isAdmin ? 0    : (count || 0),
      usageLimit:          isAdmin ? null : (limitTranscriptions || 3),
      // FIX: dashboard usage tracker needs this field
      usageMinutes:        isAdmin ? 0    : (usageMinutes || usedMinutes || 0),
    });
  } catch (err) {
    console.error('[/api/user/me]', err.message);
    res.status(500).json({ error: 'Failed to load user data.' });
  }
});

// ── GET /api/user/plan ────────────────────────────────────────────
router.get('/plan', requireAuth, async (req, res) => {
  try {
    const { plan, isAdmin, usedMinutes, limitMinutes, usedTranscriptions, limitTranscriptions, maxMinutesPerFile, usageMinutes } =
      await getUserPlanAndUsage(req.user.id);
    res.json({
      plan:                isAdmin ? 'pro' : plan,
      isAdmin,
      usedMinutes:         isAdmin ? 0    : (usedMinutes || 0),
      limitMinutes:        isAdmin ? null : (limitMinutes || 30),
      usedTranscriptions:  isAdmin ? 0    : (usedTranscriptions || 0),
      limitTranscriptions: isAdmin ? null : (limitTranscriptions || 3),
      maxMinutesPerFile:   isAdmin ? null : (maxMinutesPerFile || 15),
      usageMinutes:        isAdmin ? 0    : (usageMinutes || usedMinutes || 0),
    });
  } catch (err) {
    console.error('[/api/user/plan]', err.message);
    res.status(500).json({ error: 'Failed to load plan data.' });
  }
});

// ── GET /api/user/transcripts ─────────────────────────────────────
router.get('/transcripts', requireAuth, async (req, res) => {
  const supabase = getSupabaseAdmin();
  try {
    const { data, error } = await supabase
      .from('transcriptions')
      .select('id, filename, mode, language, created_at, pii_detected, speaker_count, duration_seconds')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      if (error.code === '42P01') return res.json({ transcripts: [] }); // table not exist
      if (error.code === '42703') {
        // Column missing — try old schema
        const { data: d2 } = await supabase
          .from('transcriptions')
          .select('id, title, mode, language, created_at')
          .eq('user_id', req.user.id)
          .order('created_at', { ascending: false })
          .limit(100);
        return res.json({ transcripts: (d2 || []).map(t => ({ ...t, filename: t.title || 'Untitled' })) });
      }
      throw error;
    }
    res.json({ transcripts: (data || []).map(t => ({ ...t, filename: t.filename || 'Untitled' })) });
  } catch (err) {
    console.error('[/api/user/transcripts]', err.message);
    res.status(500).json({ error: 'Failed to load transcripts.' });
  }
});

// ── GET /api/user/transcripts/:id ─────────────────────────────────
router.get('/transcripts/:id', requireAuth, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'Invalid transcript ID.' });
  const supabase = getSupabaseAdmin();
  try {
    const { data, error } = await supabase
      .from('transcriptions')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Transcript not found.' });
    res.json({ transcript: { ...data, filename: data.filename || data.title || 'Untitled' } });
  } catch (err) {
    console.error('[/api/user/transcripts/:id]', err.message);
    res.status(500).json({ error: 'Failed to load transcript.' });
  }
});

// ── DELETE /api/user/transcripts/:id ─────────────────────────────
router.delete('/transcripts/:id', requireAuth, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'Invalid transcript ID.' });
  const supabase = getSupabaseAdmin();
  try {
    const { error } = await supabase
      .from('transcriptions')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) {
      if (error.code === '42P01') return res.json({ success: true }); // table not exist, nothing to delete
      throw error;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/user/transcripts/:id]', err.message);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

export default router;
