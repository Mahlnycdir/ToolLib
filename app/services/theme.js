// Light or dark (0.18.0): "system" follows the device, "light" and "dark" stay put. The choice is stored as
// toollib.appearance and travels in the settings file. app/boot-theme.js sets it before the first paint, so a dark
// screen never flashes white; this module keeps it in step afterwards (a change in the settings, the device switching
// at sunset) and colours the browser bar to match.
import { loadPref, savePref } from './prefs.js';

export const APPEARANCES = ['system', 'light', 'dark'];
const BAR = { light: '#f6f9fd', dark: '#0e131b' };
const media = () => (window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);
const listeners = new Set();

export function appearance() {
  const v = loadPref('appearance', 'system');
  return APPEARANCES.includes(v) ? v : 'system';
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
  window.addEventListener('storage', (e) => { if (e.key === 'toollib.appearance') applyTheme(); });
}
