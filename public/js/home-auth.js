/* Homepage nav/CTA auth-awareness.
 *
 * The marketing homepage (clone/index.html) is a static file, so by itself it
 * cannot tell whether the visitor is logged in. The '/' route injects the
 * visitor's auth state as window.__APP__ (rendered server-side, so there is no
 * flash and no extra round-trip). This script consumes that state and updates
 * the primary call-to-action and the Log In button so a signed-in visitor sees
 * "Open your account" (-> dashboard) and "Log Out" (-> logout) — making it
 * obvious they are already logged in.
 *
 * Safe no-op when window.__APP__ is absent or the visitor is logged out. */
(function () {
  var app = (typeof window !== 'undefined' && window.__APP__) || null;
  if (!app || !app.loggedIn) return;

  function rewrite(node, href, text) {
    node.setAttribute('href', href);
    node.textContent = text;
  }

  // "Open an account" buttons (class .btn) -> "Open your account" -> /dashboard
  var openBtns = document.querySelectorAll('a.btn[href="/signup"]');
  for (var i = 0; i < openBtns.length; i++) {
    rewrite(openBtns[i], '/dashboard', 'Open your account');
  }
  // Hero panel CTA is a .panel-cta, not .btn — handle it separately.
  var panelCta = document.querySelector('a.panel-cta[href="/signup"]');
  if (panelCta) rewrite(panelCta, '/dashboard', 'Open your account \u2192');

  // "Log In" buttons (class .btn only; this intentionally excludes .hp-topic
  // links on the topics grid, which merely happen to point at /login) -> "Log Out" -> /logout
  var loginBtns = document.querySelectorAll('a.btn[href="/login"]');
  for (var j = 0; j < loginBtns.length; j++) {
    rewrite(loginBtns[j], '/logout', 'Log Out');
  }
})();
