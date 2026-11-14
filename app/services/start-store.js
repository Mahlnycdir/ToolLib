// Start as a board of your own (0.28.0), kept in your knowledge as start.md (at the top of the repository, so the
// index leaves it out: it is not a node), the same on the Mac and the iPhone:
//   ---
//   type: start
//   widgets: ["pult", "resume", "inbox", "tools"]       which widgets, in this order
//   wide: ["pult"]                                      the ones two columns wide
//   pult: ["projects/master-thesis.md", …]              the projects in the control panel, at most four
//   w_<id>: {"kind": "note", …}                         building blocks (widget-store.js)
//   ---
//   ## Widget <id>                                      their content
// Without the file Start shows the defaults; the first change writes it.
//
// For Python readers: loadStart() reads and parses the file (like yaml.safe_load plus a few checks); every change
// goes through changeStart(fn), which reads the text, lets fn return a new text, and writes it only if it differs.
import { KNOWLEDGE, exists, readText, writeFile } from './storage.js';
import { parseNode, setField, yamlValue } from './nodes.js';
import { noteChange } from './sync.js';
import { post, onAnnounce } from './channel.js';
import { onNodesChange } from './search.js';
import { blocksOf, widgetList, wideList, withConfig, withContent, withoutBlock } from './widget-store.js';

export const START_FILE = 'start.md';
export const START_WIDGETS = ['pult', 'resume', 'inbox', 'projects', 'tools'];
export const DEFAULT_START = { widgets: ['pult', 'resume', 'inbox', 'tools'], wide: ['pult'] };
export const PULT_MAX = 4;
const FILE = `${KNOWLEDGE}/${START_FILE}`;
const asList = (v) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
const BLANK = '---\ntype: start\ntitle: "Start"\nsource: you\n---\n';

let cache = null;   // the last start read, so Start draws at once and then catches up
export const cachedStart = () => cache;

function parse(text) {
  const meta = parseNode(text, START_FILE).meta || {};
  const widgets = meta.widgets == null ? DEFAULT_START.widgets : widgetList(meta.widgets, START_WIDGETS);
  return {
    found: true,
    widgets,
    wide: meta.wide == null ? DEFAULT_START.wide : wideList(meta.wide),
    pult: meta.pult == null ? null : asList(meta.pult).filter((p) => /^projects\/[\w.-]+\.md$/.test(p)).slice(0, PULT_MAX),
    blocks: blocksOf(meta, text, widgets),
  };
}

export async function loadStart() {
  let s = { found: false, ...DEFAULT_START, pult: null, blocks: new Map() };
  try { if (await exists(FILE)) s = parse(await readText(FILE)); } catch (e) { console.warn('start.md', e); }
  cache = s;
  return s;
}

// fn(text, start) → new text or null (nothing to do). Tells the sync, other windows and this window.
async function changeStart(fn) {
  const had = await exists(FILE);
  const text = had ? await readText(FILE) : BLANK;
  const next = fn(text, parse(text));
  if (next == null || next === text) return false;
  await writeFile(FILE, next);
  cache = parse(next);
  await noteChange(START_FILE, had ? 'edited' : 'added');
  post({ kind: 'start' });
  for (const f of listeners) f();
  return true;
}

const AFTER = ['title', 'type'];
export const setStartWidgets = (list) => changeStart((text) => setField(text, 'widgets', yamlValue(widgetList(list, START_WIDGETS)), AFTER));
export const setStartWide = (wide) => changeStart((text) => setField(text, 'wide', yamlValue(wideList(wide)), ['widgets', ...AFTER]));
export const setPult = (paths) => changeStart((text) => setField(text, 'pult', yamlValue([...new Set(paths)].slice(0, PULT_MAX)), ['wide', 'widgets', ...AFTER]));
// a new building block: its config, then its place at the end of the widgets
export const addStartBlock = (id, cfg) => changeStart((text, s) => setField(withConfig(text, id, cfg, ['pult', 'wide', 'widgets', ...AFTER]), 'widgets', yamlValue([...s.widgets, id]), AFTER));
export const saveStartBlock = (id, cfg) => changeStart((text) => withConfig(text, id, cfg, ['pult', 'wide', 'widgets', ...AFTER]));
export const saveStartContent = (id, body) => changeStart((text) => withContent(text, id, body));
export const removeStartWidget = (id) => changeStart((text, s) => {
  let next = setField(text, 'widgets', yamlValue(s.widgets.filter((x) => x !== id)), AFTER);
  if (s.wide.includes(id)) next = setField(next, 'wide', yamlValue(s.wide.filter((x) => x !== id)), ['widgets', ...AFTER]);
  return withoutBlock(next, id);
});

// Something changed the start: here, in another window, or a sync brought it from another device.
const listeners = new Set();
export function onStartChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
onAnnounce((msg) => { if (msg?.kind === 'start') loadStart().then(() => { for (const f of listeners) f(); }); });
onNodesChange((paths) => { if (paths === null) loadStart().then(() => { for (const f of listeners) f(); }); });
