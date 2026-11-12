// Before the first paint (0.18.0): light or dark from the stored choice, so a dark screen never flashes white.
// app/services/theme.js takes over once the app runs. Kept tiny and free of modules on purpose.
(function () {
  var a = 'system';
  try { var v = JSON.parse(localStorage.getItem('toollib.appearance')); if (v === 'light' || v === 'dark') a = v; } catch (e) { /* nothing stored */ }
  var dark = a === 'dark' || (a === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var theme = dark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  var bar = document.querySelector('meta[name="theme-color"]');
  if (bar) bar.setAttribute('content', dark ? '#0e131b' : '#f6f9fd');
  var scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute('content', theme);
})();
