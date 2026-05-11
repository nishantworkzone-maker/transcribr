// api/payment/verify.js
// Verifies Razorpay payment signature and upgrades user plan in Supabase

import crypto from 'crypto';

export const config = { api: { bodyParser: true } };

async function verifyToken(token, supabaseUrl, supabaseKey) {
  if (!token) return null;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': supabaseKey }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function getPlanExpiry(billing) {
  const now = new Date();
  billing === 'annual' ? now.setFullYear(now.getFullYear() + 1) : now.setMonth(now.getMonth() + 1);
  return now.toISOString();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || supabaseKey;

  const user = await verifyToken(token, supabaseUrl, supabaseKey);
  if (!user) return res.status(401).json({ error: 'Unauthorised. Please sign in.' });

  const { plan, billing, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

  if (!plan || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields' });
  }

  const validPlans = ['starter', 'pro', 'business'];
  if (!validPlans.includes(plan)) return res.status(400).json({ error: 'Invalid plan' });

  const rzpSecret = process.env.RAZORPAY_KEY_SECRET;
  if (!rzpSecret) return res.status(500).json({ error: 'Payment service not configured' });

  // ── Verify HMAC signature ─────────────────────────────────────
  const expectedSignature = crypto
    .createHmac('sha256', rzpSecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    console.error('[verify] Signature mismatch for user:', user.id);
    return res.status(400).json({ error: 'Payment signature verification failed.' });
  }

  // ── Update plan via Supabase REST (no SDK import needed) ──────
  try {
    const billingType = billing === 'annual' ? 'annual' : 'monthly';
    const planExpiry = getPlanExpiry(billingType);

    const upsertRes = await fetch(`${supabaseUrl}/rest/v1/user_plans`, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        user_id: user.id, plan, billing: billingType, status: 'active',
        plan_expires_at: planExpiry, razorpay_order_id, razorpay_payment_id,
        updated_at: new Date().toISOString()
      })
    });

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      console.error('[verify] Supabase upsert failed:', errText);
      // Payment was valid — log for manual recovery
      console.log('[verify] MANUAL RECOVERY:', { user_id: user.id, email: user.email, plan, payment_id: razorpay_payment_id });
    }

    return res.status(200).json({
      success: true, plan, billing: billingType,
      expires_at: planExpiry, payment_id: razorpay_payment_id
    });

  } catch (err) {
    console.error('[verify] Error:', err.message);
    return res.status(500).json({
      error: 'Payment verified but plan update failed. Contact support with payment ID: ' + razorpay_payment_id
    });
  }
}
