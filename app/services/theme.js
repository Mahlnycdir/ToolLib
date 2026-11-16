// Light or dark (0.18.0): "system" follows the device, "light" and "dark" stay put. Since 0.32.0 (Loom) dark is
// "Waldnacht" and the default, light is "Morgennebel"; and the light may breathe or stay still (calm()). The choice is stored as
// toollib.appearance and travels in the settings file. app/boot-theme.js sets it before the first paint, so a dark
// screen never flashes white; this module keeps it in step afterwards (a change in the settings, the device switching
// at sunset) and colours the browser bar to match.
import { loadPref, savePref } from './prefs.js';

export const APPEARANCES = ['system', 'light', 'dark'];
const BAR = { light: '#eef1ec', dark: '#070b09' };
const media = () => (window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);
const listeners = new Set();

export function appearance() {
  const v = loadPref('appearance', 'dark');
  return APPEARANCES.includes(v) ? v : 'dark';
}

// what is shown right now: 'light' or 'dark'
export function shownTheme() {
  const a = appearance();
  if (a !== 'system') return a;
  return media()?.matches ? 'dark' : 'light';
}

export function applyTheme() {
  const theme = shownTheme();
  const root = document.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  root.classList.toggle('calm', calm());
  const bar = document.querySelector('meta[name="theme-color"]');
  if (bar) bar.setAttribute('content', BAR[theme]);
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute('content', theme);
  for (const fn of listeners) { try { fn(theme); } catch { /* a listener's own trouble */ } }
  return theme;
}

export function setAppearance(v) {
  if (!APPEARANCES.includes(v)) return;
  savePref('appearance', v);
  applyTheme();
}

// 0.32.0: "Light breathes" (look.motion). Off = html.calm: the warm light, the mist and the focus card stand still.
export const calm = () => loadPref('look.motion', true) === false;
export function setMotion(on) {
  savePref('look.motion', !!on);
  applyTheme();
}

export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let started = false;
export function startTheme() {
  if (started) return;
  started = true;
  applyTheme();
  const m = media();
  const follow = () => { if (appearance() === 'system') applyTheme(); };
  if (m?.addEventListener) m.addEventListener('change', follow);
  else if (m?.addListener) m.addListener(follow);   // Safari before 14
  // another tab changed it
  window.addEventListener('storage', (e) => { if (e.key === 'toollib.appearance' || e.key === 'toollib.look.motion') applyTheme(); });
}
