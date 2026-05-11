// api/payment/create-order.js
// Works both as standalone Vercel function (JSON body auto-parsed)
// and via server.js Express router

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

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  const user = await verifyToken(token, supabaseUrl, supabaseKey);
  if (!user) return res.status(401).json({ error: 'Unauthorised. Please sign in.' });

  // Body already parsed by Express/Vercel bodyParser
  const { plan, billing } = req.body || {};

  if (!plan || !PLAN_AMOUNTS[plan]) {
    return res.status(400).json({ error: 'Invalid plan. Must be: starter, pro, or business' });
  }

  const billingType = billing === 'annual' ? 'annual' : 'monthly';
  const amount = PLAN_AMOUNTS[plan][billingType];

  const rzpKeyId  = process.env.RAZORPAY_KEY_ID;
  const rzpSecret = process.env.RAZORPAY_KEY_SECRET;

  if (!rzpKeyId || !rzpSecret) {
    return res.status(500).json({
      error: 'Payment not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to Vercel environment variables.'
    });
  }

  try {
    const receipt = `txn_${user.id.slice(0, 8)}_${Date.now()}`;
    const orderPayload = {
      amount, currency: 'INR', receipt,
      notes: { user_id: user.id, user_email: user.email, plan, billing: billingType }
    };

    const credentials = Buffer.from(`${rzpKeyId}:${rzpSecret}`).toString('base64');
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    });

    if (!rzpRes.ok) {
      const errData = await rzpRes.json();
      throw new Error(errData?.error?.description || 'Razorpay order creation failed');
    }

    const order = await rzpRes.json();
    return res.status(200).json({
      id: order.id, amount: order.amount, currency: order.currency,
      razorpay_key: rzpKeyId, plan, billing: billingType
    });

  } catch (err) {
    console.error('[payment/create-order]', err.message);
    return res.status(500).json({ error: err.message || 'Failed to create payment order' });
  }
}
