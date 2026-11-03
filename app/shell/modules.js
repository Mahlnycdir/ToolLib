// Modules of the shell and their accent colours. Each module brings its own icon and default accent;
// the user can change every accent in the settings.
import { loadPref, savePref } from '../services/prefs.js';

export const ACCENTS = [
  { id: 'blue', color: '#1f63e0', ink: '#ffffff' },
  { id: 'sky', color: '#0b7bbd', ink: '#ffffff' },
  { id: 'teal', color: '#0f8078', ink: '#ffffff' },
  { id: 'green', color: '#1e7e3a', ink: '#ffffff' },
  { id: 'orange', color: '#c2410c', ink: '#ffffff' },
  { id: 'violet', color: '#6d4aff', ink: '#ffffff' },
  { id: 'yellow', color: '#f2c94c', ink: '#0f1f3d' },
];

// step: the foundation step that brings the module; null = after the foundation
export const MODULES = [
  { id: 'cheatsheet', icon: 'book', accent: 'sky', step: 5 },
  { id: 'parts', icon: 'chip', accent: 'teal', step: null },
  { id: 'pins', icon: 'board', accent: 'green', step: null },
  { id: 'kobra', icon: 'code', accent: 'yellow', step: null },
  { id: 'kladde', icon: 'edit', accent: 'orange', step: null },
  { id: 'workmode', icon: 'chalkboard', accent: 'violet', step: null },
  { id: 'scraper', icon: 'globe', accent: 'blue', step: null },
];

export const SHELL = { id: 'shell', icon: 'home', accent: 'blue' };

export const moduleById = (id) => MODULES.find((m) => m.id === id) || null;

export function accentOf(id) {
  const fallback = (id === 'shell' ? SHELL : moduleById(id))?.accent ?? 'blue';
  const chosen = loadPref(`accent.${id}`, fallback);
  return ACCENTS.find((a) => a.id === chosen) || ACCENTS[0];
}

export function setAccent(id, accentId) {
  savePref(`accent.${id}`, accentId);
}

// Sets --accent and --accent-ink on an element; lighter and darker shades follow in CSS via color-mix.
export function paintAccent(el, id) {
  const a = accentOf(id);
  el.style.setProperty('--accent', a.color);
  el.style.setProperty('--accent-ink', a.ink);
}
