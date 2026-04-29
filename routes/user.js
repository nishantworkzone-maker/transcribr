// routes/user.js
// Returns the logged-in user's plan, usage count, and transcript history

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth.js';
import { getUserPlanAndUsage } from '../middleware/usage.js';

const router = express.Router();

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url) throw new Error('Missing environment variable: SUPABASE_URL');
  if (!key) throw new Error('Missing environment variable: SUPABASE_SERVICE_KEY');

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

// GET /api/user/me — returns user plan and usage stats
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { plan, count, limit } = await getUserPlanAndUsage(req.user.id);
    res.json({
      id: req.user.id,
      email: req.user.email,
      name: req.user.user_metadata?.full_name || req.user.email,
      plan,
      usageCount: count,
      usageLimit: limit
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/user/transcripts — returns user's transcript history
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

// GET /api/user/transcripts/:id — returns a single transcript
router.get('/transcripts/:id', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('transcripts')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id) // security: only own transcripts
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    res.json({ transcript: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/user/transcripts/:id — deletes a transcript
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

export default router;
