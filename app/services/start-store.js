// Start as a board of your own (0.28.0), kept in your knowledge as start.md (at the top of the repository, so the
// index leaves it out: it is not a node), the same on the Mac and the iPhone:
//   ---
//   type: start
//   widgets: ["focus", "loom", "problem", …]            which widgets, in this order
//   size: {"focus": "2x1", "pult": "2x1"}               their sizes (0.33.0; 1×1 left out); the older
//                                                       `wide: ["pult"]` is read as 2×1 and replaced on the next save
//   col: {"loom": 2, "step": 0}                         their columns on a board of four (0.33.2; without one a
//                                                       widget takes the lowest free place)
//   loom: 1                                             the widgets of 0.33.0 were laid on once (see migrate)
//   pult: ["projects/master-thesis.md", …]              the projects in the control panel, at most four
//   themes: ["electronics", "physics", …]              your themes for ideas and paths (0.30.0, paths.js THEMES)
//   w_<id>: {"kind": "note", …}                         building blocks (widget-store.js)
//   ---
//   ## Widget <id>                                      their content
// Without the file Start shows the defaults; the first change writes it.
//
// For Python readers: loadStart() reads and parses the file (like yaml.safe_load plus a few checks); every change
// goes through changeStart(fn), which reads the text, lets fn return a new text, and writes it only if it differs.
import { KNOWLEDGE, exists, readText, writeFile } from './storage.js';
import { parseNode, removeField, setField, yamlValue } from './nodes.js';
import { noteChange } from './sync.js';
import { post, onAnnounce } from './channel.js';
import { onNodesChange } from './search.js';
import { blocksOf, cleanConfig, widgetList, wideList, withConfig, withContent, withoutBlock } from './widget-store.js';
import { THEMES, isTheme } from './paths.js';

export const START_FILE = 'start.md';
// 0.33.0: everything on Heute below the head is a widget: the focus card, Loom, "What do you want to solve?", one
// small step, ideas by theme and the workbench joined the five of 0.28.0.
export const START_WIDGETS = ['focus', 'loom', 'problem', 'step', 'themes', 'bench', 'pult', 'resume', 'inbox', 'projects', 'tools'];
const NEW_033 = ['focus', 'loom', 'problem', 'step', 'themes'];
export const DEFAULT_START = { widgets: ['focus', 'loom', 'problem', 'step', 'themes', 'pult', 'resume', 'inbox', 'bench'], wide: [], size: { focus: '2x1', loom: '2x1', problem: '2x1', pult: '2x1' } };
export const PULT_MAX = 4;
export const DEFAULT_THEMES = THEMES.map((x) => x.id);   // ENTE's interests, all of them at first
const FILE = `${KNOWLEDGE}/${START_FILE}`;
const asList = (v) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
const BLANK = '---\ntype: start\ntitle: "Start"\nsource: you\n---\n';

let cache = null;   // the last start read, so Start draws at once and then catches up
export const cachedStart = () => cache;

const SIZE_NAMES = ['1x1', '2x1', '1x2', '2x2'];
function sizeMap(meta) {
  const out = {};
  if (meta.size == null && meta.wide == null) return { ...DEFAULT_START.size };
  for (const id of wideList(meta.wide)) out[id] = '2x1';
  let raw = meta.size;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [id, v] of Object.entries(raw)) if (/^[a-z0-9]{2,16}$/.test(id) && SIZE_NAMES.includes(v)) out[id] = v;
  for (const id of Object.keys(out)) if (out[id] === '1x1') delete out[id];
  return out;
}
// { id: column 0…3 } (0.33.2)
function colMap(meta) {
  let raw = meta.col;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
  return cleanCol(raw);
}
function cleanCol(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [id, x] of Object.entries(raw)) if (/^[a-z0-9]{2,16}$/.test(id) && Number.isInteger(x) && x >= 0 && x <= 3) out[id] = x;
  return out;
}
// A start.md from before 0.33.0 gets the new widgets once, in front, with their sizes (marker `loom: 1`, so a widget
// you take away later does not come back).
function migrated(meta) {
  const widgets = meta.widgets == null ? DEFAULT_START.widgets : widgetList(meta.widgets, START_WIDGETS);
  if (meta.loom != null || meta.widgets == null) return { widgets, size: sizeMap(meta) };
  const size = sizeMap(meta);
  for (const [id, v] of Object.entries(DEFAULT_START.size)) if (NEW_033.includes(id) && !widgets.includes(id)) size[id] = v;
  return { widgets: [...NEW_033.filter((w) => !widgets.includes(w)), ...widgets], size };
}

function parse(text) {
  const meta = parseNode(text, START_FILE).meta || {};
  const { widgets, size } = migrated(meta);
  return {
    found: true,
    widgets,
    size,
    col: colMap(meta),
    wide: Object.keys(size).filter((id) => size[id][0] === '2'),
    pult: meta.pult == null ? null : asList(meta.pult).filter((p) => /^projects\/[\w.-]+\.md$/.test(p)).slice(0, PULT_MAX),
    themes: meta.themes == null ? DEFAULT_THEMES : [...new Set(asList(meta.themes).filter(isTheme))],
    blocks: blocksOf(meta, text, widgets),
  };
}

export async function loadStart() {
  let s = { found: false, ...DEFAULT_START, size: { ...DEFAULT_START.size }, col: {}, wide: Object.keys(DEFAULT_START.size), pult: null, themes: DEFAULT_THEMES, blocks: new Map() };
  try { if (await exists(FILE)) s = parse(await readText(FILE)); } catch (e) { console.warn('start.md', e); }
  cache = s;
  return s;
}

// fn(text, start) → new text or null (nothing to do). Tells the sync, other windows and this window.
async function changeStart(fn) {
  const had = await exists(FILE);
  const text = had ? await readText(FILE) : BLANK;
  const next = fn(withMarker(text), parse(text));
  if (next == null || next === text) return false;
  await writeFile(FILE, next);
  cache = parse(next);
  await noteChange(START_FILE, had ? 'edited' : 'added');
  post({ kind: 'start' });
  for (const f of listeners) f();
  return true;
}

const AFTER = ['title', 'type'];
// Before the first change of 0.33.0 the file takes over what Heute shows (the new widgets in front, the sizes) and the
// marker; from then on the file says it all.
function withMarker(text) {
  const meta = parseNode(text, START_FILE).meta || {};
  if (meta.loom != null) return text;
  const { widgets, size } = migrated(meta);
  let next = setField(text, 'widgets', yamlValue(widgets), AFTER);
  next = setField(next, 'size', JSON.stringify(size), ['widgets', ...AFTER]);
  next = removeField(next, 'wide');
  return setField(next, 'loom', '1', ['size', 'widgets', ...AFTER]);
}
const cleanSizes = (sizes) => Object.fromEntries(Object.entries(sizes || {}).filter(([id, v]) => /^[a-z0-9]{2,16}$/.test(id) && SIZE_NAMES.includes(v) && v !== '1x1'));
export const setStartWidgets = (list) => changeStart((text) => setField(text, 'widgets', yamlValue(widgetList(list, START_WIDGETS)), AFTER));
export const setStartSizes = (sizes) => changeStart((text) => removeField(setField(text, 'size', JSON.stringify(cleanSizes(sizes)), ['widgets', ...AFTER]), 'wide'));
// order, sizes and columns at once (0.33.2: what the board saves after you laid a widget somewhere)
export const setStartLayout = ({ list, sizes, col }) => changeStart((text) => {
  let next = setField(text, 'widgets', yamlValue(widgetList(list, START_WIDGETS)), AFTER);
  next = removeField(setField(next, 'size', JSON.stringify(cleanSizes(sizes)), ['widgets', ...AFTER]), 'wide');
  const cols = cleanCol(col);
  return Object.keys(cols).length ? setField(next, 'col', JSON.stringify(cols), ['size', 'widgets', ...AFTER]) : removeField(next, 'col');
});
// 0.32 and before: a list of wide widgets (kept for older callers; written as sizes)
export const setStartWide = (wide) => setStartSizes(Object.fromEntries(wideList(wide).map((id) => [id, '2x1'])));
export const setStartThemes = (list) => changeStart((text) => setField(text, 'themes', yamlValue([...new Set(list)].filter(isTheme)), ['pult', 'wide', 'widgets', ...AFTER]));
export const setPult = (paths) => changeStart((text) => setField(text, 'pult', yamlValue([...new Set(paths)].slice(0, PULT_MAX)), ['wide', 'widgets', ...AFTER]));
// a new building block: its config, then its place at the end of the widgets
export const addStartBlock = (id, cfg) => changeStart((text, s) => setField(withConfig(text, id, cfg, ['pult', 'wide', 'widgets', ...AFTER]), 'widgets', yamlValue([...s.widgets, id]), AFTER));
export const saveStartBlock = (id, cfg) => changeStart((text) => withConfig(text, id, cfg, ['pult', 'wide', 'widgets', ...AFTER]));
export const saveStartContent = (id, body) => changeStart((text) => withContent(text, id, body));
export const removeStartWidget = (id) => changeStart((text, s) => {
  let next = setField(text, 'widgets', yamlValue(s.widgets.filter((x) => x !== id)), AFTER);
  if (s.size[id]) { const size = { ...s.size }; delete size[id]; next = setField(next, 'size', JSON.stringify(size), ['widgets', ...AFTER]); }
  if (s.col[id] != null) { const col = { ...s.col }; delete col[id]; next = Object.keys(col).length ? setField(next, 'col', JSON.stringify(col), ['size', 'widgets', ...AFTER]) : removeField(next, 'col'); }
  return withoutBlock(next, id);
});
// What brings a widget back after "Undo": its place, its size and, for a building block, its config and content.
export function startSnapshot(s, id) {
  const b = s.blocks.get(id);
  return { id, index: s.widgets.indexOf(id), size: s.size[id] || '', col: s.col[id] ?? null, cfg: b ? cleanConfig(b) : null, content: b?.content || '' };
}
export const restoreStartWidget = (snap) => changeStart((text, s) => {
  if (s.widgets.includes(snap.id)) return null;
  const list = [...s.widgets];
  list.splice(snap.index < 0 ? list.length : Math.min(snap.index, list.length), 0, snap.id);
  let next = setField(text, 'widgets', yamlValue(list), AFTER);
  if (snap.size) next = setField(next, 'size', JSON.stringify({ ...s.size, [snap.id]: snap.size }), ['widgets', ...AFTER]);
  if (snap.col != null) next = setField(next, 'col', JSON.stringify(cleanCol({ ...s.col, [snap.id]: snap.col })), ['size', 'widgets', ...AFTER]);
  if (snap.cfg) next = withConfig(next, snap.id, snap.cfg, ['pult', 'size', 'widgets', ...AFTER]);
  if (snap.content) next = withContent(next, snap.id, snap.content);
  return next;
});

// Something changed the start: here, in another window, or a sync brought it from another device.
const listeners = new Set();
export function onStartChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
onAnnounce((msg) => { if (msg?.kind === 'start') loadStart().then(() => { for (const f of listeners) f(); }); });
onNodesChange((paths) => { if (paths === null) loadStart().then(() => { for (const f of listeners) f(); }); });
