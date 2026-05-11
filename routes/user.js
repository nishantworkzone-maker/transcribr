// routes/user.js — User plan, usage, and transcript management

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth.js';
import { getUserPlanAndUsage } from '../middleware/usage.js';

const router = express.Router();

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url) throw new Error('Missing SUPABASE_URL');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_KEY');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// GET /api/user/me — plan, usage, limits
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { plan, usedMinutes, limitMinutes, uploadLimitMb, count } = await getUserPlanAndUsage(req.user.id);
    res.json({
      id: req.user.id,
      email: req.user.email,
      name: req.user.user_metadata?.full_name || req.user.email,
      plan,
      usageMinutes: usedMinutes,
      usageLimitMinutes: limitMinutes,
      uploadLimitMb,
      usageCount: count,
      usageLimit: limitMinutes,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/user/transcripts
router.get('/transcripts', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('transcripts')
      .select('id, title, engine, language, created_at, pii_detected, speaker_count')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ transcripts: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/user/transcripts/:id
router.get('/transcripts/:id', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('transcripts')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Transcript not found' });
    res.json({ transcript: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/user/transcripts/:id
router.delete('/transcripts/:id', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('transcripts')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/user/plan — lightweight plan check
router.get('/plan', requireAuth, async (req, res) => {
  try {
    const { plan, usedMinutes, limitMinutes, uploadLimitMb } = await getUserPlanAndUsage(req.user.id);
    res.json({ plan, usedMinutes, limitMinutes, uploadLimitMb });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
