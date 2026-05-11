/**
 * upgrade.js — Shared upgrade modal + Razorpay payment helper
 * Include this script on any page that needs upgrade/payment UI.
 * Usage: window.UpgradeModal.show(reason, suggestedPlan)
 */

(function() {
  'use strict';

  // ── Plan config ──────────────────────────────────────────────────
  const PLANS = {
    starter:  { name: 'Starter',  inr: 249,  usd: '$3.99', color: '#7c6aff', engines: '⚡ Turbo + 🎯 Precision', minutes: 300,  uploadMb: 100  },
    pro:      { name: 'Pro',      inr: 699,  usd: '$8.99', color: '#a78bfa', engines: '⚡🎯🌍 3 engines',        minutes: 1500, uploadMb: 500  },
    business: { name: 'Business', inr: 1799, usd: '$19',   color: '#34d399', engines: 'All 4 engines',           minutes: 5000, uploadMb: 2048 },
  };

  const UPGRADE_REASONS = {
    engine_locked:    { title: '🔒 Premium Engine',         body: 'This AI engine requires a higher plan. Upgrade to unlock faster and more accurate transcription.' },
    file_too_large:   { title: '📦 File Too Large',         body: 'Your file exceeds the upload limit for your current plan. Upgrade to support larger files.' },
    usage_limit:      { title: '⏱ Monthly Limit Reached',  body: 'You\'ve used all your transcription minutes for this month. Upgrade for more capacity.' },
    export_locked:    { title: '📤 Premium Export',         body: 'This export format (PDF, DOCX) requires a Pro or Business plan.' },
    guest_limit:      { title: '🎯 Free Limit Reached',    body: 'You\'ve used all 3 free transcriptions. Sign in and upgrade to continue.' },
    history_locked:   { title: '📁 Cloud History',          body: 'Cloud transcript history requires a Starter plan or above.' },
    speaker_locked:   { title: '👥 Speaker Detection',      body: 'Speaker detection is available on Pro and Business plans.' },
    default:          { title: '⭐ Unlock Premium',         body: 'Upgrade your plan to access this feature.' },
  };

  // ── Inject styles ────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('upgrade-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'upgrade-modal-styles';
    style.textContent = `
      .upgrade-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.82);
        backdrop-filter: blur(10px); z-index: 9000;
        display: none; align-items: center; justify-content: center; padding: 1rem;
      }
      .upgrade-overlay.open { display: flex; }
      .upgrade-modal {
        background: #13131a; border: 1px solid rgba(255,255,255,0.14);
        border-radius: 20px; width: 100%; max-width: 460px;
        animation: upgradeSlideIn 0.25s ease; overflow: hidden;
      }
      @keyframes upgradeSlideIn {
        from { opacity:0; transform: translateY(16px) scale(0.98); }
        to   { opacity:1; transform: translateY(0)   scale(1);    }
      }
      .upgrade-modal-head {
        padding: 1.3rem 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.08);
        display: flex; align-items: center; justify-content: space-between;
      }
      .upgrade-modal-head h3 { font-family: 'Syne',sans-serif; font-size: 1rem; font-weight: 700; color: #f0f0f8; }
      .upgrade-modal-close {
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
        color: #888899; width: 28px; height: 28px; border-radius: 7px;
        font-size: 0.82rem; cursor: pointer; display: flex; align-items: center; justify-content: center;
        transition: background 0.15s;
      }
      .upgrade-modal-close:hover { background: rgba(255,255,255,0.1); color: #f0f0f8; }
      .upgrade-modal-body { padding: 1.3rem 1.5rem; }
      .upgrade-reason-text {
        color: #888899; font-size: 0.88rem; line-height: 1.65;
        margin-bottom: 1.3rem;
      }
      .upgrade-cards { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.55rem; margin-bottom: 1.3rem; }
      .upgrade-plan-card {
        background: #1c1c27; border: 1.5px solid rgba(255,255,255,0.08);
        border-radius: 12px; padding: 0.85rem 0.7rem; cursor: pointer;
        transition: all 0.18s; text-align: center;
      }
      .upgrade-plan-card:hover { border-color: rgba(124,106,255,0.5); background: rgba(124,106,255,0.06); }
      .upgrade-plan-card.selected { border-color: #7c6aff; background: rgba(124,106,255,0.1); }
      .upgrade-plan-card.recommended { border-color: #a78bfa; }
      .upgrade-plan-card .upc-badge {
        font-size: 0.58rem; font-weight: 700; padding: 1px 7px; border-radius: 100px;
        background: rgba(167,139,250,0.15); color: #a78bfa;
        display: inline-block; margin-bottom: 0.5rem; letter-spacing: 0.4px;
      }
      .upgrade-plan-card .upc-name { font-family: 'Syne',sans-serif; font-size: 0.85rem; font-weight: 700; color: #f0f0f8; display: block; margin-bottom: 0.2rem; }
      .upgrade-plan-card .upc-price { font-family: 'Syne',sans-serif; font-size: 1.05rem; font-weight: 800; color: #a78bfa; display: block; }
      .upgrade-plan-card .upc-sub { font-size: 0.62rem; color: #888899; display: block; margin-top: 1px; }
      .upgrade-plan-card .upc-mins { font-size: 0.65rem; color: #34d399; margin-top: 0.35rem; display: block; }
      .upgrade-cta-btn {
        width: 100%; padding: 0.88rem; background: #7c6aff; color: #fff;
        border: none; border-radius: 100px; font-size: 0.92rem; font-weight: 700;
        cursor: pointer; font-family: 'Syne',sans-serif; transition: opacity 0.2s;
        display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      }
      .upgrade-cta-btn:hover { opacity: 0.88; }
      .upgrade-cta-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .upgrade-footer-links {
        display: flex; align-items: center; justify-content: center;
        gap: 1.2rem; margin-top: 0.85rem; font-size: 0.75rem;
      }
      .upgrade-footer-links a { color: #888899; text-decoration: none; transition: color 0.15s; }
      .upgrade-footer-links a:hover { color: #a78bfa; }
      .upgrade-security-note {
        text-align: center; font-size: 0.7rem; color: #888899; margin-top: 0.7rem;
      }
      /* Toast */
      #upgrade-toast {
        position: fixed; bottom: 1.4rem; right: 1.4rem;
        background: #1c1c27; border: 1px solid rgba(255,255,255,0.14);
        border-radius: 10px; padding: 0.65rem 1.1rem; font-size: 0.83rem;
        color: #f0f0f8; transform: translateY(70px); opacity: 0;
        transition: all 0.3s; z-index: 9999; max-width: 300px;
        font-family: 'DM Sans',sans-serif;
      }
      #upgrade-toast.show { transform: translateY(0); opacity: 1; }
    `;
    document.head.appendChild(style);
  }

  // ── Build modal HTML ─────────────────────────────────────────────
  function buildModal() {
    if (document.getElementById('upgradeModalOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'upgradeModalOverlay';
    overlay.className = 'upgrade-overlay';
    overlay.innerHTML = `
      <div class="upgrade-modal" id="upgradeModalBox">
        <div class="upgrade-modal-head">
          <h3 id="upgradeModalTitle">⭐ Unlock Premium</h3>
          <button class="upgrade-modal-close" onclick="UpgradeModal.close()">✕</button>
        </div>
        <div class="upgrade-modal-body">
          <p class="upgrade-reason-text" id="upgradeReasonText"></p>
          <div class="upgrade-cards" id="upgradeCards">
            ${Object.entries(PLANS).map(([key, p]) => `
              <div class="upgrade-plan-card ${key === 'pro' ? 'recommended' : ''}" id="upc-${key}" onclick="UpgradeModal.selectPlan('${key}')">
                ${key === 'pro' ? '<span class="upc-badge">POPULAR</span>' : ''}
                <span class="upc-name">${p.name}</span>
                <span class="upc-price">₹${p.inr}</span>
                <span class="upc-sub">${p.usd}/mo</span>
                <span class="upc-mins">${p.minutes} min/mo</span>
              </div>
            `).join('')}
          </div>
          <button class="upgrade-cta-btn" id="upgradeProceedBtn" onclick="UpgradeModal.proceed()">
            🔒 Upgrade Now
          </button>
          <div class="upgrade-footer-links">
            <a href="/pricing.html">See full comparison</a>
            <a href="/pricing.html">Annual discount</a>
          </div>
          <div class="upgrade-security-note">🔒 Secured by Razorpay · UPI, Cards, Net Banking</div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Close on overlay click
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) UpgradeModal.close();
    });

    // Toast
    const toast = document.createElement('div');
    toast.id = 'upgrade-toast';
    document.body.appendChild(toast);
  }

  // ── State ────────────────────────────────────────────────────────
  let _selectedPlan = 'pro';
  let _authToken = null;
  let _userEmail = '';
  let _userName = '';

  // ── Public API ───────────────────────────────────────────────────
  window.UpgradeModal = {

    // Show the modal with a reason key and optional suggested plan
    show(reason, suggestedPlan) {
      injectStyles();
      buildModal();

      const info = UPGRADE_REASONS[reason] || UPGRADE_REASONS.default;
      document.getElementById('upgradeModalTitle').textContent = info.title;
      document.getElementById('upgradeReasonText').textContent = info.body;

      // Pre-select suggested plan or default to 'pro'
      _selectedPlan = suggestedPlan || 'pro';
      this.selectPlan(_selectedPlan, false);

      document.getElementById('upgradeModalOverlay').classList.add('open');
    },

    close() {
      const overlay = document.getElementById('upgradeModalOverlay');
      if (overlay) overlay.classList.remove('open');
    },

    selectPlan(plan, scroll) {
      _selectedPlan = plan;
      document.querySelectorAll('.upgrade-plan-card').forEach(c => c.classList.remove('selected'));
      const card = document.getElementById('upc-' + plan);
      if (card) {
        card.classList.add('selected');
        const p = PLANS[plan];
        const btn = document.getElementById('upgradeProceedBtn');
        if (btn) btn.textContent = `🔒 Upgrade to ${p.name} — ₹${p.inr}/mo`;
      }
    },

    setAuth(token, email, name) {
      _authToken = token;
      _userEmail = email || '';
      _userName = name || '';
    },

    async proceed() {
      if (!_authToken) {
        // Not logged in — go to login
        localStorage.setItem('upgrade_intent', _selectedPlan);
        location.href = '/login.html?redirect=/pricing.html';
        return;
      }

      const btn = document.getElementById('upgradeProceedBtn');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Opening payment…'; }

      try {
        // Load Razorpay script if needed
        await loadRazorpay();

        const plan = _selectedPlan;
        const p = PLANS[plan];

        // Create order
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
          key: order.razorpay_key,
          amount: order.amount,
          currency: 'INR',
          name: 'Transcribr',
          description: `${p.name} Plan — Monthly`,
          order_id: order.id,
          prefill: { email: _userEmail, name: _userName },
          theme: { color: '#7c6aff' },
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
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                }),
              });

              if (!vRes.ok) {
                const err = await vRes.json();
                throw new Error(err.error || 'Verification failed');
              }

              // Success — reload or show celebration
              UpgradeModal._showSuccess(plan);
            } catch (err) {
              UpgradeModal._toast('❌ ' + err.message);
            }
          },
        };

        const rzp = new Razorpay(options);
        rzp.on('payment.failed', function(r) {
          UpgradeModal._toast('❌ Payment failed: ' + (r.error?.description || 'Unknown'));
        });
        rzp.open();

      } catch (err) {
        UpgradeModal._toast('❌ ' + err.message);
        if (btn) { btn.disabled = false; btn.textContent = `🔒 Upgrade to ${PLANS[_selectedPlan].name}`; }
      }
    },

    _showSuccess(plan) {
      const p = PLANS[plan];
      injectStyles();
      const div = document.createElement('div');
      div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(10px);z-index:9100;display:flex;align-items:center;justify-content:center;padding:1rem;';
      div.innerHTML = `
        <div style="background:#13131a;border:1px solid rgba(52,211,153,0.3);border-radius:20px;padding:2.5rem;max-width:380px;width:100%;text-align:center;">
          <div style="font-size:3rem;margin-bottom:1rem">🎉</div>
          <h3 style="font-family:Syne,sans-serif;font-size:1.3rem;color:#34d399;margin-bottom:0.5rem">You're now on ${p.name}!</h3>
          <p style="color:#888899;font-size:0.88rem;line-height:1.65;margin-bottom:1.5rem">
            Your plan is now active. ${p.minutes} minutes/month and ${p.engines} are now unlocked.
          </p>
          <button onclick="location.reload()" style="background:#34d399;color:#0a0a0f;border:none;padding:0.8rem 2rem;border-radius:100px;font-size:0.92rem;font-weight:700;cursor:pointer;font-family:Syne,sans-serif;">
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

  // ── Load Razorpay script lazily ──────────────────────────────────
  function loadRazorpay() {
    return new Promise((resolve, reject) => {
      if (window.Razorpay) return resolve();
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Razorpay'));
      document.head.appendChild(script);
    });
  }

})();
