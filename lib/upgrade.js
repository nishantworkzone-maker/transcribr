/**
 * upgrade.js — Transcribr shared upgrade modal + Razorpay payment helper
 * Served as a STATIC file from /lib/upgrade.js
 * FIX: Was previously at /lib/upgrade.js but vercel.json didn't route /lib/*.js as static
 *      vercel.json now has the correct route. This file fixes the SyntaxError 500.
 *
 * Usage:  <script src="/lib/upgrade.js"></script>
 *         window.UpgradeModal.show(reason, suggestedPlan)
 *         window.UpgradeModal.setAuth(token, email, name)
 */
(function () {
  'use strict';

  // ── Plan config ──────────────────────────────────────────────────
  const PLANS = {
    starter:  { name: 'Starter',  inr: 249,  usd: '$3.99', color: '#6c5ce7', engines: '⚡ Turbo + 🎯 Precision', minutes: 300,  uploadMb: 100  },
    pro:      { name: 'Pro',      inr: 399,  usd: '$9',    color: '#a29bfe', engines: '⚡🎯🌍 All engines',       minutes: 1500, uploadMb: 500  },
    business: { name: 'Business', inr: 1799, usd: '$19',   color: '#00d4aa', engines: 'All engines',              minutes: 5000, uploadMb: 2048 },
  };

  const UPGRADE_REASONS = {
    engine_locked:  { title: '🔒 Premium Engine',        body: 'This AI engine requires a Pro plan. Upgrade to unlock Precision AI and faster processing.' },
    file_too_large: { title: '📦 File Too Large',         body: 'Your file exceeds the limit for your current plan. Upgrade for larger file support.' },
    usage_limit:    { title: '⏱ Monthly Limit Reached',  body: 'You\'ve used all your transcription minutes for this month. Upgrade for more capacity.' },
    export_locked:  { title: '📤 Premium Export',         body: 'PDF and DOCX exports require a Pro or Business plan.' },
    guest_limit:    { title: '🎯 Free Limit Reached',     body: 'You\'ve used all 3 free transcriptions. Sign in and upgrade to continue.' },
    history_locked: { title: '📁 Cloud History',          body: 'Cloud transcript history requires a Starter plan or above.' },
    speaker_locked: { title: '👥 Speaker Detection',      body: 'Advanced speaker detection is available on Pro and Business plans.' },
    default:        { title: '⭐ Unlock Premium',         body: 'Upgrade your plan to access this feature.' },
  };

  // ── CSS injection ─────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('upgrade-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'upgrade-modal-styles';
    style.textContent = `
      .upgrade-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.75);
        backdrop-filter: blur(10px);
        z-index: 9000;
        display: none; align-items: center; justify-content: center; padding: 1rem;
      }
      .upgrade-overlay.open { display: flex; }
      .upgrade-modal {
        background: var(--modal-bg, var(--surface, #13131a));
        border: 1px solid var(--border2, rgba(255,255,255,0.14));
        border-radius: 20px; width: 100%; max-width: 460px;
        animation: upgradeSlideIn 0.25s ease; overflow: hidden;
        transition: background-color 0.25s;
      }
      @keyframes upgradeSlideIn {
        from { opacity:0; transform: translateY(16px) scale(0.98); }
        to   { opacity:1; transform: translateY(0)   scale(1); }
      }
      .upgrade-modal-head {
        padding: 1.3rem 1.5rem;
        border-bottom: 1px solid var(--border, rgba(255,255,255,0.07));
        display: flex; align-items: center; justify-content: space-between;
      }
      .upgrade-modal-head h3 {
        font-family: 'Syne', sans-serif; font-size: 1rem; font-weight: 700;
        color: var(--text, #ededf5);
      }
      .upgrade-modal-close {
        background: var(--surface2, rgba(255,255,255,0.06));
        border: 1px solid var(--border2, rgba(255,255,255,0.1));
        color: var(--muted, #888899); width: 28px; height: 28px;
        border-radius: 7px; font-size: 0.82rem; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.15s;
      }
      .upgrade-modal-close:hover { background: var(--surface3, rgba(255,255,255,0.1)); color: var(--text, #fff); }
      .upgrade-modal-body { padding: 1.3rem 1.5rem; }
      .upgrade-reason-text {
        color: var(--muted, #888899); font-size: 0.88rem; line-height: 1.65;
        margin-bottom: 1.3rem;
      }
      .upgrade-cards { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.55rem; margin-bottom: 1.3rem; }
      .upgrade-plan-card {
        background: var(--surface2, #1c1c27);
        border: 1.5px solid var(--border, rgba(255,255,255,0.08));
        border-radius: 12px; padding: 0.85rem 0.7rem;
        cursor: pointer; transition: all 0.18s; text-align: center;
      }
      .upgrade-plan-card:hover {
        border-color: rgba(108,92,231,0.5);
        background: rgba(108,92,231,0.06);
      }
      .upgrade-plan-card.selected {
        border-color: var(--accent, #6c5ce7);
        background: rgba(108,92,231,0.1);
      }
      .upgrade-plan-card .upc-badge {
        font-size: 0.58rem; font-weight: 700; padding: 1px 7px; border-radius: 100px;
        background: rgba(162,155,254,0.15); color: var(--accent2, #a29bfe);
        display: inline-block; margin-bottom: 0.5rem; letter-spacing: 0.4px;
      }
      .upgrade-plan-card .upc-name {
        font-family: 'Syne', sans-serif; font-size: 0.85rem; font-weight: 700;
        color: var(--text, #ededf5); display: block; margin-bottom: 0.2rem;
      }
      .upgrade-plan-card .upc-price {
        font-family: 'Syne', sans-serif; font-size: 1.05rem; font-weight: 800;
        color: var(--accent2, #a29bfe); display: block;
      }
      .upgrade-plan-card .upc-sub { font-size: 0.62rem; color: var(--muted, #888899); display: block; margin-top: 1px; }
      .upgrade-plan-card .upc-mins { font-size: 0.65rem; color: var(--green, #00d4aa); margin-top: 0.35rem; display: block; }
      .upgrade-cta-btn {
        width: 100%; padding: 0.88rem;
        background: var(--accent, #6c5ce7); color: #fff; border: none;
        border-radius: 100px; font-size: 0.92rem; font-weight: 700;
        cursor: pointer; font-family: 'Syne', sans-serif; transition: opacity 0.2s;
        display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      }
      .upgrade-cta-btn:hover { opacity: 0.88; }
      .upgrade-cta-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .upgrade-footer-links {
        display: flex; align-items: center; justify-content: center;
        gap: 1.2rem; margin-top: 0.85rem; font-size: 0.75rem;
      }
      .upgrade-footer-links a { color: var(--muted, #888899); text-decoration: none; transition: color 0.15s; }
      .upgrade-footer-links a:hover { color: var(--accent2, #a29bfe); }
      .upgrade-security-note {
        text-align: center; font-size: 0.7rem; color: var(--muted2, #525270); margin-top: 0.7rem;
      }
      #upgrade-toast {
        position: fixed; bottom: 1.4rem; right: 1.4rem;
        background: var(--surface2, #1c1c27); border: 1px solid var(--border2, rgba(255,255,255,0.14));
        border-radius: 10px; padding: 0.65rem 1.1rem; font-size: 0.83rem;
        color: var(--text, #ededf5); transform: translateY(70px); opacity: 0;
        transition: all 0.3s; z-index: 9999; max-width: 300px;
        font-family: 'DM Sans', sans-serif;
      }
      #upgrade-toast.show { transform: translateY(0); opacity: 1; }
    `;
    document.head.appendChild(style);
  }

  // ── Build modal HTML ──────────────────────────────────────────────
  function buildModal() {
    if (document.getElementById('upgradeModalOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'upgradeModalOverlay';
    overlay.className = 'upgrade-overlay';
    overlay.innerHTML = `
      <div class="upgrade-modal" id="upgradeModalBox">
        <div class="upgrade-modal-head">
          <h3 id="upgradeModalTitle">⭐ Unlock Premium</h3>
          <button class="upgrade-modal-close" onclick="UpgradeModal.close()" aria-label="Close">✕</button>
        </div>
        <div class="upgrade-modal-body">
          <p class="upgrade-reason-text" id="upgradeReasonText"></p>
          <div class="upgrade-cards" id="upgradeCards">
            ${Object.entries(PLANS).map(([key, p]) => `
              <div class="upgrade-plan-card ${key === 'pro' ? 'selected' : ''}" id="upc-${key}"
                   onclick="UpgradeModal.selectPlan('${key}')">
                ${key === 'pro' ? '<span class="upc-badge">POPULAR</span>' : ''}
                <span class="upc-name">${p.name}</span>
                <span class="upc-price">₹${p.inr}</span>
                <span class="upc-sub">${p.usd}/mo</span>
                <span class="upc-mins">${p.minutes} min/mo</span>
              </div>`).join('')}
          </div>
          <button class="upgrade-cta-btn" id="upgradeProceedBtn" onclick="UpgradeModal.proceed()">
            🔒 Upgrade Now
          </button>
          <div class="upgrade-footer-links">
            <a href="/pricing.html">See full comparison</a>
            <a href="/pricing.html">Annual discount (20% off)</a>
          </div>
          <div class="upgrade-security-note">🔒 Secured by Razorpay · UPI, Cards, Net Banking · Cancel anytime</div>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) UpgradeModal.close(); });

    const toast = document.createElement('div');
    toast.id = 'upgrade-toast';
    document.body.appendChild(toast);
  }

  // ── State ─────────────────────────────────────────────────────────
  let _selectedPlan = 'pro';
  let _authToken = null;
  let _userEmail = '';
  let _userName = '';

  // ── Public API ────────────────────────────────────────────────────
  window.UpgradeModal = {

    show(reason, suggestedPlan) {
      injectStyles();
      buildModal();

      const info = UPGRADE_REASONS[reason] || UPGRADE_REASONS.default;
      const titleEl = document.getElementById('upgradeModalTitle');
      const textEl  = document.getElementById('upgradeReasonText');
      if (titleEl) titleEl.textContent = info.title;
      if (textEl)  textEl.textContent  = info.body;

      _selectedPlan = suggestedPlan || 'pro';
      this.selectPlan(_selectedPlan);

      const overlay = document.getElementById('upgradeModalOverlay');
      if (overlay) overlay.classList.add('open');
    },

    close() {
      const overlay = document.getElementById('upgradeModalOverlay');
      if (overlay) overlay.classList.remove('open');
    },

    selectPlan(plan) {
      _selectedPlan = plan;
      document.querySelectorAll('.upgrade-plan-card').forEach(c => c.classList.remove('selected'));
      const card = document.getElementById('upc-' + plan);
      if (card) card.classList.add('selected');
      const p = PLANS[plan];
      const btn = document.getElementById('upgradeProceedBtn');
      if (btn && p) btn.textContent = `🔒 Upgrade to ${p.name} — ₹${p.inr}/mo`;
    },

    setAuth(token, email, name) {
      _authToken = token;
      _userEmail = email || '';
      _userName  = name  || '';
    },

    async proceed() {
      if (!_authToken) {
        localStorage.setItem('upgrade_intent', _selectedPlan);
        location.href = '/login.html?redirect=/pricing.html';
        return;
      }

      const btn = document.getElementById('upgradeProceedBtn');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Opening payment…'; }

      try {
        await loadRazorpay();

        const plan = _selectedPlan;
        const p = PLANS[plan];

        const orderRes = await fetch('/api/payment/create-order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${_authToken}`,
          },
          body: JSON.stringify({ plan, amount: p.inr * 100, billing: 'monthly' }),
        });

        if (!orderRes.ok) {
          const err = await orderRes.json();
          throw new Error(err.error || 'Could not create order');
        }

        const order = await orderRes.json();
        this.close();

        const options = {
          key:         order.razorpay_key,
          amount:      order.amount,
          currency:    'INR',
          name:        'Transcribr',
          description: `${p.name} Plan — Monthly`,
          order_id:    order.id,
          prefill:     { email: _userEmail, name: _userName },
          theme:       { color: '#6c5ce7' },
          handler: async (response) => {
            UpgradeModal._toast('⏳ Verifying payment…');
            try {
              const vRes = await fetch('/api/payment/verify', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${_authToken}`,
                },
                body: JSON.stringify({
                  plan,
                  billing: 'monthly',
                  razorpay_order_id:  response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature:  response.razorpay_signature,
                }),
              });
              if (!vRes.ok) { const e = await vRes.json(); throw new Error(e.error || 'Verification failed'); }
              UpgradeModal._showSuccess(plan);
            } catch (err) {
              UpgradeModal._toast('❌ ' + err.message);
            }
          },
        };

        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', () => UpgradeModal._toast('❌ Payment failed. Please try again.'));
        rzp.open();

      } catch (err) {
        UpgradeModal._toast('❌ ' + err.message);
        if (btn) {
          btn.disabled = false;
          const p = PLANS[_selectedPlan];
          btn.textContent = `🔒 Upgrade to ${p ? p.name : 'Pro'}`;
        }
      }
    },

    _showSuccess(plan) {
      const p = PLANS[plan];
      injectStyles();
      const div = document.createElement('div');
      div.style.cssText = 'position:fixed;inset:0;background:var(--bg,#08080f);z-index:9100;display:flex;align-items:center;justify-content:center;padding:1rem;';
      div.innerHTML = `
        <div style="background:var(--surface,#101018);border:1px solid rgba(0,212,170,0.3);border-radius:20px;padding:2.5rem;max-width:380px;width:100%;text-align:center;">
          <div style="font-size:3rem;margin-bottom:1rem">🎉</div>
          <h3 style="font-family:Syne,sans-serif;font-size:1.3rem;color:var(--green,#00d4aa);margin-bottom:0.5rem">You're now on ${p ? p.name : 'Pro'}!</h3>
          <p style="color:var(--muted,#7878a0);font-size:0.88rem;line-height:1.65;margin-bottom:1.5rem">
            Your plan is now active. ${p ? p.minutes : 1500} minutes/month and all premium engines are unlocked.
          </p>
          <button onclick="location.reload()" style="background:var(--green,#00d4aa);color:#08080f;border:none;padding:0.8rem 2rem;border-radius:100px;font-size:0.92rem;font-weight:700;cursor:pointer;font-family:Syne,sans-serif;">
            ✓ Continue →
          </button>
        </div>`;
      document.body.appendChild(div);
    },

    _toast(msg) {
      let t = document.getElementById('upgrade-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'upgrade-toast';
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(t._timer);
      t._timer = setTimeout(() => t.classList.remove('show'), 3500);
    },
  };

  // ── Load Razorpay lazily ──────────────────────────────────────────
  function loadRazorpay() {
    return new Promise((resolve, reject) => {
      if (window.Razorpay) return resolve();
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload  = resolve;
      script.onerror = () => reject(new Error('Failed to load Razorpay. Please check your connection.'));
      document.head.appendChild(script);
    });
  }

})();
