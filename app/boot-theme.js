// Before the first paint (0.18.0): light or dark from the stored choice, so a dark screen never flashes white.
// app/services/theme.js takes over once the app runs. Kept tiny and free of modules on purpose.
(function () {
  var a = 'dark';   // 0.32.0 (Loom): Waldnacht unless you chose otherwise
  try { var v = JSON.parse(localStorage.getItem('toollib.appearance')); if (v === 'light' || v === 'dark' || v === 'system') a = v; } catch (e) { /* nothing stored */ }
  var dark = a === 'dark' || (a === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var theme = dark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  var bar = document.querySelector('meta[name="theme-color"]');
  if (bar) bar.setAttribute('content', dark ? '#070b09' : '#eef1ec');
  var scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute('content', theme);
  try { if (JSON.parse(localStorage.getItem('toollib.look.motion')) === false) document.documentElement.classList.add('calm'); } catch (e) { /* breathing */ }
  // iPhone and iPad (0.31.0): the stylesheet uses the system's own text cursor there (html.ios)
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) document.documentElement.classList.add('ios');
})();
