// api/payment/create-order.js — Security hardened
// FIXED: Removed verbose console.log leaking user emails and env status in production

export const config = { api: { bodyParser: true } };

async function verifyToken(token, supabaseUrl, supabaseKey) {
  if (!token) return null;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': supabaseKey },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const PLAN_AMOUNTS = {
  starter:  { monthly: 24900,  annual: 239000  },
  pro:      { monthly: 69900,  annual: 671040  },
  business: { monthly: 179900, annual: 1727040 },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS?.split(',')[0] || 'https://mytranscribr.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const rzpKeyId    = process.env.RAZORPAY_KEY_ID;
  const rzpSecret   = process.env.RAZORPAY_KEY_SECRET;

  if (!rzpKeyId || !rzpSecret) {
    return res.status(500).json({ error: 'Payment is not available right now. Please try again later.' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Not signed in. Please log in first.' });

  const user = await verifyToken(token, supabaseUrl, supabaseKey);
  if (!user?.id) return res.status(401).json({ error: 'Session expired. Please sign in again.' });

  // Validate plan input strictly
  const { plan, billing } = req.body || {};
  if (!plan || !PLAN_AMOUNTS[plan]) {
    return res.status(400).json({ error: 'Invalid plan selected.' });
  }

  const billingType = billing === 'annual' ? 'annual' : 'monthly';
  const amount = PLAN_AMOUNTS[plan][billingType];

  try {
    const receipt = `txn_${user.id.slice(0, 8)}_${Date.now()}`;
    const orderPayload = {
      amount,
      currency: 'INR',
      receipt,
      notes: { user_id: user.id, plan, billing: billingType },
    };

    const credentials = Buffer.from(`${rzpKeyId}:${rzpSecret}`).toString('base64');
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload),
    });

    const rzpData = await rzpRes.json();
    if (!rzpRes.ok) {
      // Log internally (server logs) but don't expose to client
      console.error('[create-order] Razorpay error:', rzpData?.error?.code);
      throw new Error('Payment gateway error');
    }

    return res.status(200).json({
      id:          rzpData.id,
      amount:      rzpData.amount,
      currency:    rzpData.currency,
      razorpay_key: rzpKeyId,
      plan,
      billing:     billingType,
    });

  } catch (err) {
    return res.status(500).json({ error: 'Failed to create payment order. Please try again.' });
  }
}
