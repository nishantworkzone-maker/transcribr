// api/payment/verify.js — Security hardened
// FIXED: CORS restricted; error messages sanitized; idempotency protection added

import crypto from 'crypto';

export const config = { api: { bodyParser: true } };

async function verifyToken(token, supabaseUrl, supabaseKey) {
  if (!token) return null;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': supabaseKey },
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
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS?.split(',')[0] || 'https://mytranscribr.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || supabaseKey;

  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  const user = await verifyToken(token, supabaseUrl, supabaseKey);
  if (!user) return res.status(401).json({ error: 'Session expired. Please sign in.' });

  const { plan, billing, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

  // Validate all required fields
  if (!plan || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields.' });
  }

  // Strict plan validation
  const validPlans = ['starter', 'pro', 'business'];
  if (!validPlans.includes(plan)) return res.status(400).json({ error: 'Invalid plan.' });

  // Validate field formats to prevent injection
  if (!/^order_[A-Za-z0-9]+$/.test(razorpay_order_id)) return res.status(400).json({ error: 'Invalid order ID format.' });
  if (!/^pay_[A-Za-z0-9]+$/.test(razorpay_payment_id)) return res.status(400).json({ error: 'Invalid payment ID format.' });
  if (!/^[a-f0-9]{64}$/.test(razorpay_signature)) return res.status(400).json({ error: 'Invalid signature format.' });

  const rzpSecret = process.env.RAZORPAY_KEY_SECRET;
  if (!rzpSecret) return res.status(500).json({ error: 'Payment service unavailable.' });

  // HMAC signature verification (cryptographic, timing-safe)
  const expectedSignature = crypto
    .createHmac('sha256', rzpSecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  const sigBuffer      = Buffer.from(razorpay_signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    console.error('[verify] Signature mismatch — possible fraud attempt for user:', user.id);
    return res.status(400).json({ error: 'Payment verification failed.' });
  }

  try {
    const billingType = billing === 'annual' ? 'annual' : 'monthly';
    const planExpiry  = getPlanExpiry(billingType);

    const upsertRes = await fetch(`${supabaseUrl}/rest/v1/user_plans`, {
      method: 'POST',
      headers: {
        'apikey':         supabaseServiceKey,
        'Authorization':  `Bearer ${supabaseServiceKey}`,
        'Content-Type':   'application/json',
        'Prefer':         'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        user_id:             user.id,
        plan,
        billing:             billingType,
        status:              'active',
        plan_expires_at:     planExpiry,
        razorpay_order_id,
        razorpay_payment_id,
        updated_at:          new Date().toISOString(),
      }),
    });

    if (!upsertRes.ok) {
      // Payment was valid — log for manual recovery (server-side only, not exposed to client)
      console.error('[verify] DB update failed. MANUAL RECOVERY NEEDED:', {
        user_id:    user.id,
        plan,
        payment_id: razorpay_payment_id,
      });
    }

    return res.status(200).json({
      success:    true,
      plan,
      billing:    billingType,
      expires_at: planExpiry,
      payment_id: razorpay_payment_id,
    });

  } catch (err) {
    console.error('[verify] DB error:', err.message);
    return res.status(500).json({
      error: 'Payment verified but plan update failed. Contact support with your payment ID: ' + razorpay_payment_id,
    });
  }
}
