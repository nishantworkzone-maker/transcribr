/**
 * lib/logo.js — Transcribr theme-aware logo switcher
 * Include on every page: <script src="/lib/logo.js"></script>
 * Switches logo SVG between light/dark variants on theme change.
 */
(function () {
  function updateLogos() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const src = isDark ? '/logo-dark.svg' : '/logo.svg';
    document.querySelectorAll('.nav-logo, #navLogo').forEach(img => {
      if (img.src !== src) img.src = src;
    });
  }

  // Run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateLogos);
  } else {
    updateLogos();
  }

  // Watch for theme changes
  new MutationObserver(updateLogos).observe(
    document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] }
  );
})();
