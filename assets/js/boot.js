// Runs synchronously in <head>: enables entrance animations before first
// paint, with a fail-safe that shows everything if the main JS never loads.
(function () {
  var root = document.documentElement;
  if (window.top !== window.self) { root.style.display = 'none'; }

  // Opened by double-clicking the .html file? Browsers block the site's
  // scripts on file:// pages, so nothing would work. Say so clearly.
  if (location.protocol === 'file:') {
    document.addEventListener('DOMContentLoaded', function () {
      var box = document.createElement('div');
      box.setAttribute('role', 'alert');
      box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;color:#201E1D;' +
        'display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto;' +
        'font:16px/1.6 Inter,system-ui,-apple-system,Segoe UI,sans-serif';
      box.innerHTML =
        '<div style="max-width:560px">' +
        '<div style="width:44px;height:44px;margin-bottom:24px;position:relative">' +
        '<span style="position:absolute;right:0;top:0;width:70%;height:70%;border-top:10px solid #EC3013;border-right:10px solid #EC3013"></span>' +
        '<span style="position:absolute;left:0;bottom:0;width:70%;height:70%;border-bottom:10px solid #201E1D;border-left:10px solid #201E1D"></span></div>' +
        '<h1 style="font:800 34px/1.05 Inter Tight,Inter,sans-serif;letter-spacing:-.03em;margin:0 0 14px">This page was opened as a file.</h1>' +
        '<p style="margin:0 0 14px;color:#6B6764">Browsers block Likewise’s sign-in and database code when a page is opened straight from your computer, so accounts can’t be created this way.</p>' +
        '<p style="margin:0 0 8px"><b>To use it, do one of these:</b></p>' +
        '<ol style="margin:0 0 14px;padding-left:22px;list-style:decimal">' +
        '<li>Upload this folder to GitHub Pages (Setup guide, Step 3) and open <code>https://USERNAME.github.io/likewise/</code></li>' +
        '<li>Or run a tiny local server: open a terminal in this folder, type <code>npx serve</code>, then open <code>http://localhost:3000</code></li>' +
        '</ol></div>';
      document.body.appendChild(box);
    });
    return;
  }

  if (window.matchMedia && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('motion');
    setTimeout(function () { if (!window.__lwReady) root.classList.remove('motion'); }, 2500);
  }
})();
