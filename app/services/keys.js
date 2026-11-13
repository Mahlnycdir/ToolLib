// Keyboard shortcuts in one place (0.17.0): every action has default keys, you can change them in Settings › Keys,
// and every button of an action shows its keys when you point at it. On a phone without a keyboard the keys stay out
// of sight (tooltips, settings), unless you say you use a keyboard (setting device.keyboard).
// A combination is written "Mod+Shift+E": Mod is ⌘ on a Mac and iPhone/iPad, Ctrl elsewhere. Letters follow your
// keyboard layout (Z stays Z on a German keyboard); digits and keys with Alt held go by their place on the keyboard.
// Your changes are stored as { action: [combo, …] } in the setting "keys" and travel in the settings file.
import { loadPref, savePref } from './prefs.js';

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

// area: where the action works. global = everywhere (bare keys only when you are not typing), cmd = the command bar,
// editor = while you write a page or a node, research = the hit list. fixed: shown, not changeable.
export const ACTIONS = [
  { id: 'cmd.focus', area: 'global', keys: ['Mod+K', '/'] },
  { id: 'create', area: 'global', keys: ['N'] },
  { id: 'help', area: 'global', keys: ['?'] },
  { id: 'go.home', area: 'global', keys: ['Alt+H'] },
  { id: 'go.projects', area: 'global', keys: ['Alt+P'] },
  { id: 'go.write', area: 'global', keys: ['Alt+W'] },
  { id: 'go.research', area: 'global', keys: ['Alt+R'] },
  { id: 'go.net', area: 'global', keys: ['Alt+G'] },             // 0.26.0: the network (around the node on screen)
  { id: 'go.settings', area: 'global', keys: ['Mod+,'] },
  { id: 'sync', area: 'global', keys: ['Alt+S'] },
  { id: 'project.drawer', area: 'global', keys: ['Alt+B'] },
  { id: 'node.link', area: 'global', keys: ['Alt+L'] },          // 0.25.0: link the node on screen with another
  { id: 'theme.toggle', area: 'global', keys: ['Alt+D'] },       // 0.25.0: light ↔ dark
  { id: 'jump', area: 'global', keys: ['Alt+1…9'], fixed: true },
  { id: 'cmd.note', area: 'cmd', keys: ['Mod+Enter'] },
  { id: 'cmd.copy', area: 'cmd', keys: ['Shift+Enter'] },
  { id: 'editor.bold', area: 'editor', keys: ['Mod+B'] },
  { id: 'editor.italic', area: 'editor', keys: ['Mod+I'] },
  { id: 'editor.math', area: 'editor', keys: ['Mod+Shift+E'] },
  { id: 'editor.display', area: 'editor', keys: ['Mod+Alt+E'] },
  { id: 'editor.heading', area: 'editor', keys: ['Mod+Shift+H'] },
  { id: 'editor.list', area: 'editor', keys: ['Mod+Shift+8'] },
  { id: 'editor.numbered', area: 'editor', keys: ['Mod+Shift+7'] },
  { id: 'editor.task', area: 'editor', keys: ['Mod+Shift+9'] },
  { id: 'editor.quote', area: 'editor', keys: [] },
  { id: 'editor.code', area: 'editor', keys: ['Mod+Shift+X'] },
  { id: 'editor.link', area: 'editor', keys: ['Mod+Shift+K'] },
  { id: 'editor.cite', area: 'editor', keys: ['Mod+Alt+Q'] },
  { id: 'editor.image', area: 'editor', keys: [] },
  { id: 'editor.palette', area: 'editor', keys: ['Mod+Shift+L'] },
  { id: 'editor.complete', area: 'editor', keys: ['Ctrl+Space'] },
  { id: 'editor.mode', area: 'editor', keys: ['Mod+Alt+P'] },
  { id: 'editor.save', area: 'editor', keys: ['Mod+S'] },
  { id: 'research.down', area: 'research', keys: ['J', 'ArrowDown'] },
  { id: 'research.up', area: 'research', keys: ['K', 'ArrowUp'] },
  { id: 'research.read', area: 'research', keys: ['L'] },
  { id: 'research.keep', area: 'research', keys: ['M'] },
  { id: 'run.code', area: 'run', keys: ['Mod+Enter'] },
];
export const AREAS = ['global', 'cmd', 'editor', 'research', 'run'];
const byId = new Map(ACTIONS.map((a) => [a.id, a]));

// ------------------------------------------------------------------ which keys an action has now
let custom = loadPref('keys', {}) || {};
const listeners = new Set();
export function onKeysChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed() { for (const fn of listeners) fn(); }

export function keysOf(id) {
  const a = byId.get(id);
  if (!a) return [];
  const own = custom[id];
  return Array.isArray(own) && !a.fixed ? own : a.keys;
}
export const isDefault = (id) => !Array.isArray(custom[id]);

export function setKeys(id, combos) {
  const a = byId.get(id);
  if (!a || a.fixed) return;
  const list = [...new Set(combos.map(normalizeCombo).filter(Boolean))];
  if (sameList(list, a.keys)) delete custom[id];
  else custom[id] = list;
  savePref('keys', custom);
  changed();
}
export function resetKeys(id) {
  if (id) delete custom[id]; else custom = {};
  savePref('keys', custom);
  changed();
}
// After loading a settings file.
export function reloadKeys() { custom = loadPref('keys', {}) || {}; changed(); }
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Areas that are active together: a key may be used once among them.
const TOGETHER = { global: ['global', 'cmd', 'editor', 'research', 'run'], cmd: ['global', 'cmd'], editor: ['global', 'editor'], research: ['global', 'research'], run: ['global', 'run'] };
// The action that already has this combination where the given action works, or null.
export function conflictOf(id, combo) {
  const a = byId.get(id);
  const c = normalizeCombo(combo);
  if (!a || !c) return null;
  for (const other of ACTIONS) {
    if (other.id === id || !TOGETHER[a.area].includes(other.area) || !TOGETHER[other.area].includes(a.area)) continue;
    if (keysOf(other.id).some((k) => normalizeCombo(k) === c)) return other.id;
  }
  return null;
}

// ------------------------------------------------------------------ combinations
const MODS = ['Mod', 'Ctrl', 'Alt', 'Shift'];
const NAMED = { ' ': 'Space', Esc: 'Escape', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight' };

// "mod+shift+e" → "Mod+Shift+E"; unknown parts give null.
export function normalizeCombo(combo) {
  const parts = String(combo || '').split('+');
  const key = parts.pop();
  if (!key && !parts.length) return null;
  const mods = new Set();
  for (const p of parts) {
    const m = MODS.find((x) => x.toLowerCase() === p.trim().toLowerCase()) || (/^(cmd|meta|⌘)$/i.test(p.trim()) ? 'Mod' : null);
    if (!m) return null;
    mods.add(m);
  }
  let k = key === '' ? '+' : NAMED[key] || key;
  if (k.length === 1) k = k.toUpperCase();
  return [...MODS.filter((m) => mods.has(m)), k].join('+');
}

// The combination of a key event, as above; null for a modifier alone.
export function comboOf(e) {
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead'].includes(e.key)) return null;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const ctrl = isMac ? e.ctrlKey : false;
  let k;
  if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (e.altKey && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (/^[a-z]$/i.test(e.key)) k = e.key.toUpperCase();
  else if (e.key === ' ' || e.code === 'Space') k = 'Space';
  else if (e.key.length === 1) k = e.key;
  else k = e.key;
  // a sign that needs Shift on one keyboard and not on another ("/" and "?" on a German one): Shift does not count
  const sign = k.length === 1 && !/[A-Z0-9]/.test(k);
  const mods = [];
  if (mod) mods.push('Mod');
  if (ctrl) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey && !sign) mods.push('Shift');
  return [...mods, k].join('+');
}

export function matches(e, id) {
  const c = comboOf(e);
  return !!c && keysOf(id).some((k) => normalizeCombo(k) === c);
}

// "Mod+Shift+E" → "⇧⌘E" on a Mac, "Ctrl+Shift+E" elsewhere.
const MAC_SIGN = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' };
const KEY_SIGN = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: isMac ? '↩' : 'Enter', Escape: 'Esc', Space: isMac ? '␣' : 'Space', Backspace: '⌫' };
export function formatCombo(combo) {
  const parts = String(combo).split('+');
  let key = parts.pop();
  if (key === '' ) key = '+';
  const k = KEY_SIGN[key] || key;
  if (isMac) {
    const order = ['Ctrl', 'Alt', 'Shift', 'Mod'];
    return order.filter((m) => parts.includes(m)).map((m) => MAC_SIGN[m]).join('') + k;
  }
  return [...parts.map((m) => (m === 'Mod' ? 'Ctrl' : m)), k].join('+');
}
export const formatKeys = (id) => keysOf(id).map(formatCombo);

// CodeMirror's spelling: "Mod+Shift+E" → "Mod-Shift-e".
export function cmKey(combo) {
  const parts = normalizeCombo(combo)?.split('+');
  if (!parts) return null;
  let key = parts.pop();
  if (key.length === 1) key = key.toLowerCase();
  if (key === 'Space') key = 'Space';
  return [...parts, key].join('-');
}

// ------------------------------------------------------------------ is there a keyboard?
export function hasKeyboard() {
  if (loadPref('device.keyboard', false)) return true;
  try { return window.matchMedia('(any-hover: hover)').matches || window.matchMedia('(any-pointer: fine)').matches; } catch { return true; }
}

// "Bold (⌘B)" for the title of a button; without a keyboard just "Bold".
export function withKeys(label, id) {
  const k = hasKeyboard() ? formatKeys(id) : [];
  return k.length ? `${label} (${k[0]})` : label;
}
// Sets title and aria-keyshortcuts of an element for an action; updates when you change the keys.
export function keyTitle(el, label, id) {
  const set = () => {
    el.title = withKeys(label, id);
    const k = keysOf(id).filter((x) => !x.includes('…'));
    if (k.length && hasKeyboard()) el.setAttribute('aria-keyshortcuts', k.map((x) => x.replace(/^Mod\b/, isMac ? 'Meta' : 'Control')).join(' '));
    else el.removeAttribute('aria-keyshortcuts');
  };
  set();
  const off = onKeysChange(() => { if (el.isConnected) set(); else off(); });
  return el;
}

// ------------------------------------------------------------------ handlers
// bind({ 'go.home': fn, … }, { area, root }) → unbind. A handler gets the event and may return false to let it pass.
// Bare keys (no Mod, Ctrl or Alt) of the global area work only when you are not typing; editor keys are bound by the
// editor itself (cmKeymap), so here they only count outside it.
const bindings = [];
export function bind(handlers, { area = 'global', root = null, typing = [] } = {}) {
  const b = { handlers, area, root, typing };
  bindings.unshift(b);
  return () => { const i = bindings.indexOf(b); if (i >= 0) bindings.splice(i, 1); };
}
const typingIn = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
function dispatch(e) {
  if (e.defaultPrevented || e.isComposing) return;
  const c = comboOf(e);
  if (!c) return;
  const bare = !/^(Mod|Ctrl|Alt)\+/.test(c);
  // Alt (Option) with a key types a sign on a Mac (Option+P = π on a German keyboard): while you type in a field,
  // shortcuts with Alt alone stay off, the sign wins (0.24.1, ENTE 13.11.). Mod+Alt combinations still work.
  const altOnly = /^Alt\+/.test(c);
  const typing = typingIn(e.target) || typingIn(document.activeElement);
  const inEditor = !!e.target?.closest?.('.cm-editor');
  for (const b of bindings) {
    if (b.root && !b.root.isConnected) continue;
    if (b.root && !b.root.contains(e.target) && b.area !== 'global') continue;
    for (const [id, fn] of Object.entries(b.handlers)) {
      const a = byId.get(id);
      if (!a || !keysOf(id).some((k) => normalizeCombo(k) === c)) continue;
      if (a.area === 'editor' && inEditor) continue;
      if (typing && !b.typing.includes(id) && (altOnly || (bare && a.area !== 'cmd' && a.area !== 'run'))) continue;
      if (fn(e) === false) continue;
      e.preventDefault();
      return;
    }
  }
}
document.addEventListener('keydown', dispatch);

// For the help window: [keys, label key] of the global and command bar actions.
export const helpRows = () => ACTIONS.filter((a) => ['global', 'cmd'].includes(a.area)).map((a) => ({ id: a.id, keys: keysOf(a.id).map(formatCombo) }));
