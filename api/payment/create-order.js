// api/payment/create-order.js
// Routed through server.js Express — env vars available via process.env

export const config = { api: { bodyParser: true } };

async function verifyToken(token, supabaseUrl, supabaseKey) {
  if (!token) return null;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': supabaseKey }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('[create-order] verifyToken failed:', e.message);
    return null;
  }
}

const PLAN_AMOUNTS = {
  starter:  { monthly: 24900,  annual: 239000  },
  pro:      { monthly: 69900,  annual: 671040  },
  business: { monthly: 179900, annual: 1727040 },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Step 1: Check env vars ──────────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const rzpKeyId    = process.env.RAZORPAY_KEY_ID;
  const rzpSecret   = process.env.RAZORPAY_KEY_SECRET;

  console.log('[create-order] env check:', {
    hasSupabaseUrl: !!supabaseUrl,
    hasSupabaseKey: !!supabaseKey,
    hasRzpKeyId:    !!rzpKeyId,
    hasRzpSecret:   !!rzpSecret,
  });

  if (!rzpKeyId || !rzpSecret) {
    console.error('[create-order] Missing Razorpay keys');
    return res.status(500).json({
      error: 'Payment not configured. RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET missing.'
    });
  }

  // ── Step 2: Verify user auth ────────────────────────────────────
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return res.status(401).json({ error: 'Not signed in. Please log in first.' });
  }

  const user = await verifyToken(token, supabaseUrl, supabaseKey);
  if (!user || !user.id) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  console.log('[create-order] user verified:', user.email);

  // ── Step 3: Validate plan ───────────────────────────────────────
  const { plan, billing } = req.body || {};

  if (!plan || !PLAN_AMOUNTS[plan]) {
    return res.status(400).json({ error: 'Invalid plan. Must be: starter, pro, or business' });
  }

  const billingType = billing === 'annual' ? 'annual' : 'monthly';
  const amount = PLAN_AMOUNTS[plan][billingType];

  console.log('[create-order] creating order:', { plan, billingType, amount });

  // ── Step 4: Create Razorpay order ──────────────────────────────
  try {
    const receipt = `txn_${user.id.slice(0, 8)}_${Date.now()}`;
    const orderPayload = {
      amount,
      currency: 'INR',
      receipt,
      notes: { user_id: user.id, user_email: user.email, plan, billing: billingType }
    };

    const credentials = Buffer.from(`${rzpKeyId}:${rzpSecret}`).toString('base64');

    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(orderPayload)
    });

    const rzpData = await rzpRes.json();
    console.log('[create-order] Razorpay response status:', rzpRes.status);

    if (!rzpRes.ok) {
      console.error('[create-order] Razorpay error:', JSON.stringify(rzpData));
      throw new Error(rzpData?.error?.description || rzpData?.error?.reason || 'Razorpay order creation failed');
    }

    console.log('[create-order] Order created:', rzpData.id);

    return res.status(200).json({
      id: rzpData.id,
      amount: rzpData.amount,
      currency: rzpData.currency,
      razorpay_key: rzpKeyId,
      plan,
      billing: billingType
    });

  } catch (err) {
    console.error('[create-order] FATAL:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to create payment order' });
  }
}
