// One colour system (0.25.0): the same colours everywhere: tools, kinds of nodes, areas of knowledge, sections
// of a board, and soon the dots and threads of the network. Each colour has a light and a dark shade; both live in
// app/shell/styles.css as CSS variables (--c-blue, --c-rose, …), so switching between light and dark repaints
// everything at once without drawing again.
//
// For Python readers: this file is a lookup table with a few helper functions, nothing more.
import { accentOf, moduleOfType } from './modules.js';

// name → [light, dark]; the light shades are the ones the board has used since 0.18.0
export const PALETTE = {
  blue: ['#1f63e0', '#6b9bff'],
  sky: ['#0b7bbd', '#38bdf8'],
  teal: ['#0f8078', '#2dd4bf'],
  green: ['#1e7e3a', '#4ade80'],
  orange: ['#c2410c', '#fb923c'],
  rose: ['#c0265e', '#fb7185'],
  violet: ['#6d4aff', '#a78bfa'],
  yellow: ['#c99a06', '#facc15'],
  slate: ['#64748b', '#94a3b8'],
  indigo: ['#4338ca', '#818cf8'],   // 0.26.0: two more, so the kinds of nodes in the network are told apart
  lime: ['#4d7c0f', '#a3e635'],
};
export const COLOURS = Object.keys(PALETTE);
const known = (name) => (COLOURS.includes(name) ? name : 'slate');

// For CSS: el.style.setProperty('--sec', colourVar('rose')) follows light and dark by itself.
export const colourVar = (name) => `var(--c-${known(name)})`;

// The colour as a value, for drawing on a canvas: the shade of the theme shown right now.
export function colourValue(name) {
  const dark = document.documentElement.dataset.theme === 'dark';
  return PALETTE[known(name)][dark ? 1 : 0];
}

// The colour of a kind of node in the network (0.26.0): one colour per kind, so formulas, theorems and definitions
// are told apart although one tool shows them all. Sources stay grey, so they recede behind your own knowledge.
// Kinds not listed take the colour of the tool that shows them (Settings › Look).
const TYPE = {
  formula: 'rose', theorem: 'orange', definition: 'yellow', term: 'yellow', convention: 'teal', topic: 'indigo',
  snippet: 'sky', recipe: 'sky', clip: 'slate', research: 'slate', project: 'violet', note: 'green',
  page: 'lime', library: 'lime', part: 'orange', device: 'orange',
};
export const typeColour = (type) => TYPE[type] || known(accentOf(moduleOfType(type)).id);

// The areas of your knowledge. New areas (Rust, crafts, nursing …) get a colour from their name, always the same one.
const AREA = { physics: 'violet', math: 'teal', numerics: 'sky', electronics: 'orange', nursing: 'rose', programming: 'blue', rust: 'orange' };
export function areaColour(area) {
  const a = String(area || '').toLowerCase();
  if (AREA[a]) return AREA[a];
  let n = 0;
  for (const ch of a) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  const usable = COLOURS.filter((c) => c !== 'slate');   // never slate: that is "no colour"
  return usable[n % usable.length];
}
