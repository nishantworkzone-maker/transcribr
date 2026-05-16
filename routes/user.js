// routes/user.js — Security hardened
// FIXED: UUID validation on :id params; error messages sanitized; column selection tightened

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

// GET /api/user/me — plan, usage, limits
router.get('/me', requireAuth, async (req, res) => {
  try {
    const {
      plan, isAdmin,
      usedTranscriptions, limitTranscriptions,
      usedMinutes, limitMinutes,
      maxMinutesPerFile, count,
    } = await getUserPlanAndUsage(req.user.id);

    res.json({
      id:    req.user.id,
      email: req.user.email,
      name:  req.user.user_metadata?.full_name || req.user.email,
      // Never expose 'admin' role string — show as 'pro' on frontend
      plan:  isAdmin ? 'pro' : plan,
      isAdmin,
      usedTranscriptions:  isAdmin ? 0    : usedTranscriptions,
      limitTranscriptions: isAdmin ? null : limitTranscriptions,
      usedMinutes:         isAdmin ? 0    : usedMinutes,
      limitMinutes:        isAdmin ? null : limitMinutes,
      maxMinutesPerFile:   isAdmin ? null : maxMinutesPerFile,
      usageCount: isAdmin ? 0    : count,
      usageLimit: isAdmin ? null : limitTranscriptions,
    });
  } catch {
    res.status(500).json({ error: 'Failed to load user data.' });
  }
});

// GET /api/user/plan — lightweight plan check
router.get('/plan', requireAuth, async (req, res) => {
  try {
    const { plan, isAdmin, usedMinutes, limitMinutes, usedTranscriptions, limitTranscriptions, maxMinutesPerFile } =
      await getUserPlanAndUsage(req.user.id);
    res.json({
      plan: isAdmin ? 'pro' : plan,
      isAdmin,
      usedMinutes:         isAdmin ? 0    : usedMinutes,
      limitMinutes:        isAdmin ? null : limitMinutes,
      usedTranscriptions:  isAdmin ? 0    : usedTranscriptions,
      limitTranscriptions: isAdmin ? null : limitTranscriptions,
      maxMinutesPerFile:   isAdmin ? null : maxMinutesPerFile,
    });
  } catch {
    res.status(500).json({ error: 'Failed to load plan data.' });
  }
});

// GET /api/user/transcripts — list (no full transcript text in list view)
router.get('/transcripts', requireAuth, async (req, res) => {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('transcriptions')
      .select('id, filename, mode, language, created_at, pii_detected, speaker_count, duration_seconds')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json({ transcripts: data || [] });
  } catch {
    res.status(500).json({ error: 'Failed to load transcripts.' });
  }
});

// GET /api/user/transcripts/:id
router.get('/transcripts/:id', requireAuth, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'Invalid transcript ID.' });
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('transcriptions')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)  // row-level ownership enforced
      .single();
    if (error || !data) return res.status(404).json({ error: 'Transcript not found.' });
    res.json({ transcript: data });
  } catch {
    res.status(500).json({ error: 'Failed to load transcript.' });
  }
});

// DELETE /api/user/transcripts/:id
router.delete('/transcripts/:id', requireAuth, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'Invalid transcript ID.' });
  try {
    const { error } = await getSupabaseAdmin()
      .from('transcriptions')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Delete failed.' });
  }
});

export default router;
