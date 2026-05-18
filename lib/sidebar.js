/**
 * Transcribr Global Sidebar Navigation
 * Self-executing — include this script on any page for consistent navigation.
 * Usage: <script src="/lib/sidebar.js"></script>
 */
(function () {
  'use strict';

  // ── CSS ──────────────────────────────────────────────────────────
  const CSS = `
    :root {
      --sb-width: 240px;
      --sb-collapsed: 64px;
    }
    #sb-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.55);
      z-index: 998;
      backdrop-filter: blur(2px);
    }
    #sb-overlay.open { display: block; }

    #sb-drawer {
      position: fixed;
      top: 0;
      left: 0;
      height: 100vh;
      width: var(--sb-width);
      background: var(--surface, #101018);
      border-right: 1px solid var(--border, rgba(255,255,255,0.07));
      z-index: 999;
      transform: translateX(-100%);
      transition: transform 0.28s cubic-bezier(0.4,0,0.2,1), box-shadow 0.28s;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #sb-drawer.open {
      transform: translateX(0);
      box-shadow: 4px 0 40px rgba(0,0,0,0.4);
    }

    /* Desktop: persistent sidebar at ≥1024px */
    @media (min-width: 1024px) {
      #sb-overlay { display: none !important; }
      #sb-drawer {
        transform: translateX(0);
        box-shadow: none;
        top: 0;
      }
      body.sb-active {
        padding-left: var(--sb-width);
        transition: padding-left 0.28s cubic-bezier(0.4,0,0.2,1);
      }
      body.sb-collapsed {
        padding-left: var(--sb-collapsed);
      }
      body.sb-collapsed #sb-drawer {
        width: var(--sb-collapsed);
      }
      body.sb-collapsed .sb-label,
      body.sb-collapsed .sb-section-title,
      body.sb-collapsed .sb-plan-info,
      body.sb-collapsed .sb-user-email {
        opacity: 0;
        pointer-events: none;
      }
      body.sb-collapsed .sb-nav-item {
        justify-content: center;
        padding: 0.6rem;
      }
      body.sb-collapsed .sb-icon { margin-right: 0; }
    }

    /* ── Header ── */
    #sb-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.1rem 1rem;
      border-bottom: 1px solid var(--border, rgba(255,255,255,0.07));
      flex-shrink: 0;
    }
    #sb-logo {
      font-family: 'Syne', sans-serif;
      font-weight: 800;
      font-size: 1.15rem;
      color: var(--text, #ededf5);
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      white-space: nowrap;
      overflow: hidden;
    }
    #sb-logo span { color: var(--accent2, #a29bfe); }
    #sb-collapse-btn {
      background: transparent;
      border: 1px solid var(--border, rgba(255,255,255,0.07));
      color: var(--muted, #7878a0);
      width: 26px;
      height: 26px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      flex-shrink: 0;
      transition: all 0.2s;
    }
    #sb-collapse-btn:hover { border-color: var(--accent, #6c5ce7); color: var(--accent2, #a29bfe); }

    /* ── User section ── */
    #sb-user {
      padding: 0.85rem 1rem;
      border-bottom: 1px solid var(--border, rgba(255,255,255,0.07));
      flex-shrink: 0;
    }
    #sb-user-inner {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      text-decoration: none;
      border-radius: 9px;
      padding: 0.5rem;
      transition: background 0.15s;
    }
    #sb-user-inner:hover { background: var(--surface2, #16161f); }
    .sb-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--accent, #6c5ce7), var(--accent2, #a29bfe));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.72rem;
      font-weight: 700;
      color: #fff;
      flex-shrink: 0;
      font-family: 'Syne', sans-serif;
    }
    .sb-user-info { min-width: 0; }
    .sb-user-name {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text, #ededf5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sb-user-email {
      font-size: 0.68rem;
      color: var(--muted, #7878a0);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: opacity 0.2s;
    }
    .sb-plan-badge {
      display: inline-flex;
      align-items: center;
      font-size: 0.55rem;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      padding: 1px 6px;
      border-radius: 100px;
      background: rgba(108,92,231,0.15);
      color: var(--accent2, #a29bfe);
      border: 1px solid rgba(108,92,231,0.3);
      margin-top: 2px;
    }
    .sb-plan-badge.pro { background: rgba(0,212,170,0.12); color: var(--green, #00d4aa); border-color: rgba(0,212,170,0.25); }

    /* ── Nav ── */
    #sb-nav {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem 0.65rem;
    }
    #sb-nav::-webkit-scrollbar { width: 2px; }
    #sb-nav::-webkit-scrollbar-thumb { background: var(--border2, rgba(255,255,255,0.13)); border-radius: 1px; }

    .sb-section-title {
      font-size: 0.58rem;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--muted2, #525270);
      padding: 0.7rem 0.55rem 0.3rem;
      transition: opacity 0.2s;
    }
    .sb-nav-item {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      padding: 0.55rem 0.75rem;
      border-radius: 8px;
      color: var(--muted, #7878a0);
      font-size: 0.82rem;
      text-decoration: none;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.18s;
      margin-bottom: 1px;
      white-space: nowrap;
      background: transparent;
      width: 100%;
      font-family: 'DM Sans', sans-serif;
    }
    .sb-nav-item:hover {
      background: var(--surface2, #16161f);
      color: var(--text, #ededf5);
      border-color: var(--border, rgba(255,255,255,0.07));
    }
    .sb-nav-item.active {
      background: rgba(108,92,231,0.12);
      color: var(--text, #ededf5);
      border-color: rgba(108,92,231,0.22);
    }
    .sb-nav-item.active .sb-icon { color: var(--accent2, #a29bfe); }
    .sb-nav-item.upgrade-item {
      background: linear-gradient(135deg, rgba(108,92,231,0.15), rgba(162,155,254,0.08));
      color: var(--accent2, #a29bfe);
      border-color: rgba(108,92,231,0.3);
      margin-top: 0.25rem;
    }
    .sb-nav-item.upgrade-item:hover { opacity: 0.88; }
    .sb-icon {
      font-size: 1rem;
      flex-shrink: 0;
      width: 18px;
      text-align: center;
      transition: color 0.18s;
    }
    .sb-label { transition: opacity 0.2s; }
    .sb-badge {
      margin-left: auto;
      font-size: 0.6rem;
      background: var(--accent, #6c5ce7);
      color: #fff;
      padding: 1px 6px;
      border-radius: 100px;
      font-weight: 700;
    }
    .sb-divider {
      height: 1px;
      background: var(--border, rgba(255,255,255,0.07));
      margin: 0.45rem 0;
    }

    /* ── Footer ── */
    #sb-footer {
      padding: 0.65rem;
      border-top: 1px solid var(--border, rgba(255,255,255,0.07));
      flex-shrink: 0;
    }
    .sb-plan-info {
      background: var(--surface2, #16161f);
      border: 1px solid var(--border2, rgba(255,255,255,0.13));
      border-radius: 9px;
      padding: 0.6rem 0.75rem;
      margin-bottom: 0.45rem;
      transition: opacity 0.2s;
    }
    .sb-plan-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.35rem;
    }
    .sb-plan-name { font-size: 0.72rem; font-weight: 600; color: var(--text, #ededf5); }
    .sb-plan-mins { font-size: 0.65rem; color: var(--muted, #7878a0); }
    .sb-usage-bar {
      height: 3px;
      background: var(--border2, rgba(255,255,255,0.13));
      border-radius: 100px;
      overflow: hidden;
    }
    .sb-usage-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--accent, #6c5ce7), var(--accent2, #a29bfe));
      border-radius: 100px;
      transition: width 0.5s ease;
    }
    .sb-usage-text {
      font-size: 0.62rem;
      color: var(--muted, #7878a0);
      margin-top: 0.25rem;
      display: flex;
      justify-content: space-between;
    }

    /* ── Hamburger button (added to existing nav) ── */
    #sb-hamburger {
      background: transparent;
      border: 1px solid var(--border2, rgba(255,255,255,0.13));
      color: var(--muted, #7878a0);
      width: 34px;
      height: 34px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      flex-shrink: 0;
      transition: all 0.2s;
    }
    #sb-hamburger:hover { border-color: var(--accent, #6c5ce7); color: var(--text, #ededf5); }
    #sb-hamburger span {
      display: block;
      width: 16px;
      height: 1.5px;
      background: currentColor;
      border-radius: 1px;
      transition: all 0.2s;
    }
    @media (min-width: 1024px) {
      #sb-hamburger { display: none; }
    }
  `;

  // ── Nav items config ─────────────────────────────────────────────
  const NAV_ITEMS = [
    { section: 'Main' },
    { label: 'Dashboard',        href: '/dashboard.html',  icon: '⊞',  id: 'dashboard' },
    { label: 'New Transcription',href: '/dashboard.html?new=1', icon: '+', id: 'new', class: '' },
    { label: 'My Transcripts',   href: '/dashboard.html',  icon: '📁', id: 'transcripts' },
    { divider: true },
    { section: 'Account' },
    { label: 'Profile & Account',href: '/profile.html',    icon: '👤', id: 'profile' },
    { label: 'Billing & Plans',  href: '/pricing.html',    icon: '💳', id: 'billing' },
    { label: 'Settings',         href: '/profile.html#settings', icon: '⚙️', id: 'settings' },
    { divider: true },
    { section: 'Help' },
    { label: 'Contact Support',  href: '/contact.html',    icon: '💬', id: 'contact' },
    { label: 'Report a Bug',     href: '/bug.html',        icon: '🐛', id: 'bug' },
  ];

  // ── State ────────────────────────────────────────────────────────
  let isOpen = false;
  let userInfo = null;
  let usageInfo = null;

  // ── Inject styles ─────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('sb-styles')) return;
    const style = document.createElement('style');
    style.id = 'sb-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ── Get current page ──────────────────────────────────────────────
  function getCurrentPage() {
    const path = window.location.pathname.split('/').pop().replace('.html', '') || 'index';
    return path;
  }

  // ── Build sidebar HTML ────────────────────────────────────────────
  function buildSidebar() {
    const drawer = document.createElement('div');
    drawer.id = 'sb-drawer';
    drawer.setAttribute('role', 'navigation');
    drawer.setAttribute('aria-label', 'Main navigation');

    const currentPage = getCurrentPage();

    // Header
    const header = document.createElement('div');
    header.id = 'sb-header';
    header.innerHTML = `
      <a href="/" id="sb-logo">Transcribr<span>.</span></a>
      <button id="sb-collapse-btn" title="Collapse sidebar" aria-label="Collapse sidebar">⟨</button>
    `;

    // User section
    const userSection = document.createElement('div');
    userSection.id = 'sb-user';
    userSection.innerHTML = `
      <a href="/profile.html" id="sb-user-inner">
        <div class="sb-avatar" id="sb-avatar">?</div>
        <div class="sb-user-info">
          <div class="sb-user-name" id="sb-user-name">Loading…</div>
          <div class="sb-user-email" id="sb-user-email">—</div>
          <div class="sb-plan-badge" id="sb-plan-badge">Free</div>
        </div>
      </a>
    `;

    // Nav
    const nav = document.createElement('nav');
    nav.id = 'sb-nav';

    const currentPath = window.location.pathname;

    NAV_ITEMS.forEach(item => {
      if (item.section) {
        const t = document.createElement('div');
        t.className = 'sb-section-title';
        t.textContent = item.section;
        nav.appendChild(t);
        return;
      }
      if (item.divider) {
        const d = document.createElement('div');
        d.className = 'sb-divider';
        nav.appendChild(d);
        return;
      }

      const a = document.createElement('a');
      a.href = item.href;
      a.className = 'sb-nav-item' + (item.class ? ' ' + item.class : '');

      // Detect active
      const itemPath = item.href.split('?')[0];
      const isActive = currentPath.endsWith(itemPath) ||
        (itemPath === '/dashboard.html' && item.id !== 'new' && (currentPath.endsWith('/dashboard.html') || currentPath === '/'));
      if (isActive && item.id !== 'new') a.classList.add('active');

      a.setAttribute('aria-current', isActive ? 'page' : 'false');
      a.innerHTML = `<span class="sb-icon">${item.icon}</span><span class="sb-label">${item.label}</span>`;
      if (item.badge) {
        a.innerHTML += `<span class="sb-badge">${item.badge}</span>`;
      }
      nav.appendChild(a);
    });

    // Upgrade CTA
    const upgradeBtn = document.createElement('a');
    upgradeBtn.href = '/pricing.html';
    upgradeBtn.className = 'sb-nav-item upgrade-item';
    upgradeBtn.id = 'sb-upgrade-btn';
    upgradeBtn.style.display = 'none';
    upgradeBtn.innerHTML = `<span class="sb-icon">⭐</span><span class="sb-label">Upgrade to Pro</span>`;
    nav.appendChild(upgradeBtn);

    // Logout
    const dividerEl = document.createElement('div');
    dividerEl.className = 'sb-divider';
    nav.appendChild(dividerEl);

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'sb-nav-item';
    logoutBtn.id = 'sb-logout';
    logoutBtn.style.color = 'var(--red, #f87171)';
    logoutBtn.innerHTML = `<span class="sb-icon">🚪</span><span class="sb-label">Sign Out</span>`;
    logoutBtn.onclick = signOut;
    nav.appendChild(logoutBtn);

    // Footer with usage
    const footer = document.createElement('div');
    footer.id = 'sb-footer';
    footer.innerHTML = `
      <div class="sb-plan-info" id="sb-plan-info" style="display:none">
        <div class="sb-plan-top">
          <span class="sb-plan-name" id="sb-footer-plan">Free Plan</span>
          <a href="/pricing.html" style="font-size:0.62rem;color:var(--accent2);text-decoration:none;">Upgrade</a>
        </div>
        <div class="sb-usage-bar">
          <div class="sb-usage-fill" id="sb-usage-fill" style="width:0%"></div>
        </div>
        <div class="sb-usage-text">
          <span id="sb-usage-used">0 min used</span>
          <span id="sb-usage-left">30 min left</span>
        </div>
      </div>
    `;

    drawer.appendChild(header);
    drawer.appendChild(userSection);
    drawer.appendChild(nav);
    drawer.appendChild(footer);
    return drawer;
  }

  // ── Insert hamburger into existing nav ────────────────────────────
  function insertHamburger() {
    const nav = document.querySelector('nav');
    if (!nav || document.getElementById('sb-hamburger')) return;
    const btn = document.createElement('button');
    btn.id = 'sb-hamburger';
    btn.setAttribute('aria-label', 'Open navigation menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span></span><span></span><span></span>';
    btn.onclick = toggleSidebar;
    nav.insertBefore(btn, nav.firstChild);
  }

  // ── Toggle ────────────────────────────────────────────────────────
  function toggleSidebar() {
    isOpen = !isOpen;
    const drawer = document.getElementById('sb-drawer');
    const overlay = document.getElementById('sb-overlay');
    const hamburger = document.getElementById('sb-hamburger');
    if (!drawer) return;
    drawer.classList.toggle('open', isOpen);
    if (overlay) overlay.classList.toggle('open', isOpen);
    if (hamburger) hamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    document.body.style.overflow = (isOpen && window.innerWidth < 1024) ? 'hidden' : '';
  }

  function closeSidebar() {
    isOpen = false;
    const drawer = document.getElementById('sb-drawer');
    const overlay = document.getElementById('sb-overlay');
    const hamburger = document.getElementById('sb-hamburger');
    if (drawer) drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  // ── Collapse (desktop) ────────────────────────────────────────────
  function toggleCollapse() {
    document.body.classList.toggle('sb-collapsed');
    const btn = document.getElementById('sb-collapse-btn');
    if (btn) btn.textContent = document.body.classList.contains('sb-collapsed') ? '⟩' : '⟨';
    localStorage.setItem('sb_collapsed', document.body.classList.contains('sb-collapsed') ? '1' : '0');
  }

  // ── Auth + user data ──────────────────────────────────────────────
  async function loadUserData() {
    try {
      const cfg = await fetch('/api/config').then(r => r.json());
      const sb = window.supabase?.createClient(cfg.supabaseUrl, cfg.supabaseKey);
      if (!sb) return;

      const { data: { session } } = await sb.auth.getSession();
      if (!session) {
        // Guest mode
        document.getElementById('sb-user-name').textContent = 'Guest User';
        document.getElementById('sb-user-email').textContent = '3 free transcriptions';
        document.getElementById('sb-avatar').textContent = 'G';
        document.getElementById('sb-logout').style.display = 'none';
        return;
      }

      const user = session.user;
      const email = user.email || '';
      const name = user.user_metadata?.full_name || email.split('@')[0] || 'User';
      const initial = name.charAt(0).toUpperCase();

      document.getElementById('sb-avatar').textContent = initial;
      document.getElementById('sb-user-name').textContent = name;
      document.getElementById('sb-user-email').textContent = email;

      // Load plan
      try {
        const r = await fetch('/api/user/me', {
          headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        if (r.ok) {
          const d = await r.json();
          const plan = d.plan || 'free';
          const badge = document.getElementById('sb-plan-badge');
          badge.textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
          const isPaid = !['free', 'guest'].includes(plan);
          badge.className = 'sb-plan-badge' + (isPaid ? ' pro' : '');

          // Show upgrade CTA for free users
          const upgradeBtn = document.getElementById('sb-upgrade-btn');
          if (!isPaid && upgradeBtn) upgradeBtn.style.display = 'flex';

          // Usage bar
          const planInfo = document.getElementById('sb-plan-info');
          if (planInfo) {
            planInfo.style.display = 'block';
            const LIMITS = { free: 30, starter: 300, pro: 1500, business: 5000 };
            const limit = LIMITS[plan] || 30;
            const used = d.usageMinutes || d.usedMinutes || 0;
            const pct = Math.min(100, (used / limit) * 100);
            const fill = document.getElementById('sb-usage-fill');
            if (fill) {
              fill.style.width = pct + '%';
              fill.style.background = pct > 85 ? '#f87171' : pct > 60 ? '#fbbf24' :
                'linear-gradient(90deg, var(--accent), var(--accent2))';
            }
            const planNameEl = document.getElementById('sb-footer-plan');
            if (planNameEl) planNameEl.textContent = badge.textContent + ' Plan';
            const usedEl = document.getElementById('sb-usage-used');
            const leftEl = document.getElementById('sb-usage-left');
            if (usedEl) usedEl.textContent = used + ' min used';
            if (leftEl) leftEl.textContent = Math.max(0, limit - used) + ' min left';
          }
        }
      } catch (e) { /* plan load failed silently */ }

    } catch (e) { /* auth failed silently */ }
  }

  async function signOut() {
    try {
      const cfg = await fetch('/api/config').then(r => r.json());
      const sb = window.supabase?.createClient(cfg.supabaseUrl, cfg.supabaseKey);
      if (sb) await sb.auth.signOut();
    } catch (e) {}
    window.location.href = '/';
  }

  // ── Keyboard nav ──────────────────────────────────────────────────
  function handleKeydown(e) {
    if (e.key === 'Escape' && isOpen) closeSidebar();
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    injectStyles();

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'sb-overlay';
    overlay.onclick = closeSidebar;
    document.body.appendChild(overlay);

    // Sidebar drawer
    const drawer = buildSidebar();
    document.body.appendChild(drawer);

    // Desktop persistent sidebar
    if (window.innerWidth >= 1024) {
      document.body.classList.add('sb-active');
      if (localStorage.getItem('sb_collapsed') === '1') {
        document.body.classList.add('sb-collapsed');
        const btn = document.getElementById('sb-collapse-btn');
        if (btn) btn.textContent = '⟩';
      }
    }

    // Hamburger button in existing nav
    insertHamburger();

    // Event listeners
    document.getElementById('sb-collapse-btn')?.addEventListener('click', toggleCollapse);
    document.addEventListener('keydown', handleKeydown);

    // Close on resize if mobile
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1024) {
        document.body.classList.add('sb-active');
        closeSidebar();
      } else {
        document.body.classList.remove('sb-active');
      }
    });

    // Load user data
    if (window.supabase) {
      loadUserData();
    } else {
      // Wait for supabase to load
      let tries = 0;
      const checkSb = setInterval(() => {
        tries++;
        if (window.supabase || tries > 20) {
          clearInterval(checkSb);
          if (window.supabase) loadUserData();
        }
      }, 200);
    }
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
