// Where you were (0.15.0): the last things you worked on, on this device, so Start can offer to go on with them.
//   read   a work in the reader          { path (its clip), title }
//   write  a page of one of your libraries { path (the page), lib (its library), title }
//   node   a node you opened             { path, title }
// The newest comes first; one entry per kind and path.
import { loadPref, savePref } from './prefs.js';

const KEY = 'trail';
const MAX = 24;

export function mark(kind, entry) {
  if (!entry?.path) return;
  const list = loadPref(KEY, []).filter((e) => !(e.path === entry.path && (e.kind === kind || kind !== 'node')));
  // reading or writing something says more than having opened its node
  if (kind === 'node' && list.some((e) => e.path === entry.path)) return;
  savePref(KEY, [{ kind, at: Date.now(), ...entry }, ...list].slice(0, MAX));
}

export const trail = () => loadPref(KEY, []);
export function forget(path) { savePref(KEY, loadPref(KEY, []).filter((e) => e.path !== path)); }
