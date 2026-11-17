// The rabbit hole of a project (0.33.0, ENTE: "wie in ein Wissensloch fallen"): from the project you go one level
// deeper into a card, from there into what it rests on, and so on; the way back stays visible as a trail and
// "Auftauchen" (Esc) brings you up again. What you made down there (notes, cards) are the finds; with the setting
// "Funde ans Kapitel" (loom.attach) they join the section you dived in from when you surface.
//
// Kept per device and project in pref `dive` (where you are is not knowledge):
//   { "<project slug>": { trail: ["nodes/formulas/gamma-matrices-2d.md", …], from: "<section id>", finds: [paths], at, since } }
//
// For Python readers: a stack per project (list.append / list.pop), saved as JSON after every step.
import { loadPref, savePref } from './prefs.js';
import { nodeByPath } from './search.js';
import { addToProject, placeItem } from './projects.js';

const KEY = 'dive';
const all = () => { const v = loadPref(KEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
const slugOf = (path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
const listeners = new Set();
export function onDiveChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function keep(projectPath, d) {
  const v = all();
  const k = slugOf(projectPath);
  if (d && d.trail.length) v[k] = { ...d, at: Date.now() }; else delete v[k];
  savePref(KEY, Object.fromEntries(Object.entries(v).slice(-30)));
  for (const fn of listeners) { try { fn(projectPath); } catch (e) { console.warn(e); } }
}

// { trail: [paths of nodes that still exist], from, finds, at }
export function diveOf(projectPath) {
  const d = all()[slugOf(projectPath)];
  if (!d || !Array.isArray(d.trail)) return { trail: [], from: '', finds: [], at: 0, since: 0 };
  return { trail: d.trail.filter((p) => typeof p === 'string' && nodeByPath(p)), from: String(d.from || ''), finds: Array.isArray(d.finds) ? d.finds.filter((p) => typeof p === 'string') : [], at: Number(d.at) || 0, since: Number(d.since) || 0 };
}
export const depthOf = (projectPath) => diveOf(projectPath).trail.length;
export const hereOf = (projectPath) => { const t = diveOf(projectPath).trail; return t[t.length - 1] || ''; };

// One level deeper into `path` (a node). From the project level `from` names the section you came from.
export function diveInto(projectPath, path, { from = '' } = {}) {
  const d = diveOf(projectPath);
  const at = d.trail.indexOf(path);
  const trail = at >= 0 ? d.trail.slice(0, at + 1) : [...d.trail, path].slice(-12);
  keep(projectPath, { ...d, trail, from: d.trail.length ? d.from : from, since: d.trail.length ? d.since : Date.now() });
}
// Back to level n (0 = the project itself).
export function upTo(projectPath, n) {
  const d = diveOf(projectPath);
  if (n <= 0) return surface(projectPath);
  keep(projectPath, { ...d, trail: d.trail.slice(0, n) });
  return [];
}
export const upOne = (projectPath) => upTo(projectPath, depthOf(projectPath) - 1);

// Something made down there: a find to take along.
export function addFind(projectPath, path) {
  const d = diveOf(projectPath);
  if (!d.trail.length || d.finds.includes(path)) return;
  keep(projectPath, { ...d, finds: [...d.finds, path].slice(-20) });
}
export function setFrom(projectPath, section) {
  const d = diveOf(projectPath);
  if (d.trail.length) keep(projectPath, { ...d, from: section });
}

// Up to the project. With attach the finds join the project and the section you dived in from. Returns the finds.
export async function surfaceWith(projectPath, { attach = true } = {}) {
  const d = diveOf(projectPath);
  keep(projectPath, null);
  if (!attach || !d.finds.length) return d.finds;
  const slugs = d.finds.map(slugOf);
  try {
    await addToProject(projectPath, slugs);
    if (d.from) for (const s of slugs) await placeItem(projectPath, s, d.from, -1);
  } catch (e) { console.warn('finds', e); }
  return d.finds;
}
export function surface(projectPath) { keep(projectPath, null); return []; }
