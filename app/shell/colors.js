// One colour system (0.25.0): the same colours everywhere: tools, kinds of nodes, areas of knowledge, sections
// of a board, and soon the dots and threads of the network. Each colour has a light and a dark shade; both live in
// app/shell/styles.css as CSS variables (--c-blue, --c-rose, …), so switching between light and dark repaints
// everything at once without drawing again.
//
// For Python readers: this file is a lookup table with a few helper functions, nothing more.
import { accentOf, moduleOfType } from './modules.js';

// name → [light, dark]; since 0.32.0 the shades of Morgennebel and Waldnacht (same values as --c-* in styles.css)
export const PALETTE = {
  blue: ['#3d6fb8', '#a8c4f0'],
  sky: ['#2f7fa8', '#8fc8e8'],
  teal: ['#2f7f72', '#8fd0c0'],
  green: ['#3a7d4c', '#8fd19e'],
  orange: ['#b5612a', '#e8b08a'],
  rose: ['#b04a68', '#eba2b4'],
  violet: ['#6e5bb5', '#bba8ec'],
  yellow: ['#a07c12', '#e8c86a'],
  slate: ['#66766c', '#8fa196'],
  indigo: ['#4f57a8', '#a6acf0'],   // 0.26.0: two more, so the kinds of nodes in the network are told apart
  lime: ['#5a7d1f', '#bcd98a'],
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
