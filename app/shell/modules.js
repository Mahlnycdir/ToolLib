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
  { id: 'rose', color: '#c0265e', ink: '#ffffff' },
  { id: 'yellow', color: '#f2c94c', ink: '#0f1f3d' },
];

// The tools of the shell, in the order of the module bar: projects hold everything together, research collects,
// formulary and cheatsheet keep, Kobra applies. planned: true = not built yet; such a tool is named on Start under
// "Planned" and stays out of the module bar. A new tool is one line here, its texts in strings.json
// (module.<id>.name, module.<id>.desc), its view in VIEWS of shell.js and, if it creates something, an entry in
// CREATORS of create.js; types: the kinds of nodes it shows, which take its colour.
export const MODULES = [
  { id: 'projects', icon: 'target', accent: 'violet', types: ['project', 'note'] },                 // 0.15.0
  { id: 'scraper', icon: 'globe', accent: 'blue', types: ['clip', 'research'] },                    // research window (0.14.0)
  { id: 'library', icon: 'file', accent: 'teal', types: ['library', 'page'] },                       // its own tool since 0.15.1
  { id: 'formulary', icon: 'vars', accent: 'rose', types: ['formula', 'convention', 'definition', 'theorem', 'term', 'topic'] },   // stage 3 (0.12.0)
  { id: 'cheatsheet', icon: 'book', accent: 'sky', types: ['snippet', 'recipe'] },
  { id: 'kobra', icon: 'code', accent: 'yellow', href: 'kobra/', types: [] },   // Kobra as its own page (0.11.0)
  { id: 'parts', icon: 'chip', accent: 'green', planned: true, types: ['part', 'device'] },
  { id: 'pins', icon: 'board', accent: 'sky', planned: true, types: ['rule', 'pin_map'] },
  { id: 'kladde', icon: 'edit', accent: 'orange', planned: true, types: [] },
  { id: 'workmode', icon: 'chalkboard', accent: 'violet', planned: true, types: ['card'] },
];
export const READY = MODULES.filter((m) => !m.planned);
export const PLANNED = MODULES.filter((m) => m.planned);
// the module whose colour a kind of node takes
export const moduleOfType = (type) => MODULES.find((m) => m.types.includes(type))?.id || 'shell';

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
