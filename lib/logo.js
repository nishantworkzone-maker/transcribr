(function () {
  function getLogoSrc() {
    return document.documentElement.getAttribute('data-theme') === 'light'
      ? '/logo.svg'
      : '/logo-dark.svg';
  }

  function updateLogos() {
    var src = getLogoSrc();
    document.querySelectorAll('img.nav-logo').forEach(function (img) {
      if (img.src.split('/').pop() !== src.split('/').pop()) img.src = src;
    });
  }

  function init() {
    updateLogos();
    if (window.MutationObserver) {
      new MutationObserver(updateLogos)
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
