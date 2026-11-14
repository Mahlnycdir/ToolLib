// Widgets from building blocks (0.28.0). A building block is a small widget you put together yourself, without code:
//   link       tiles to a tool, a node or project, or a search
//   search     a list from a search that stays up to date
//   note       a few lines of text
//   check      a checklist
//   net        a piece of the network around a node (or the project in focus)
//   countdown  the days until a date
// It lives in the file of its board (start.md, or a project) in three places:
//   widgets: [..., "bk3x9q2a"]                       its place among the widgets
//   w_bk3x9q2a: {"kind": "note", "title": "Ideas"}    what it is: one line of JSON, which YAML reads as it is
//   ## Widget bk3x9q2a                               its content below (note, checklist), if it has some
// and `wide: [ids]` says which widgets take two columns. Every piece sits on a line or part of its own, so the sync
// joins two devices that change different widgets.
//
// For Python readers: cleanConfig is a validator (like a pydantic model): whatever comes from a file is checked
// field by field and anything odd is dropped, so a hand-edited or broken file never breaks the page.
import { setField, removeField } from './nodes.js';
import { keepInPart, partText, removePart, setPart } from './md-parts.js';

export const BLOCKS = ['link', 'search', 'note', 'check', 'net', 'countdown'];
export const isBlockId = (id) => /^b[a-z0-9]{4,12}$/.test(String(id));
export const newBlockId = () => `b${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
const cfgKey = (id) => `w_${id}`;
const partName = (id) => `Widget ${id}`;
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '');
const asList = (v) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

// A clean config, or null when it is not a building block.
export function cleanConfig(c) {
  if (!c || typeof c !== 'object' || !BLOCKS.includes(c.kind)) return null;
  const out = { kind: c.kind, title: str(c.title, 80) };
  if (c.kind === 'link') {
    out.items = (Array.isArray(c.items) ? c.items : []).slice(0, 12)
      .map((x) => ({ t: ['tool', 'node', 'search'].includes(x?.t) ? x.t : '', v: str(x?.v, 300), label: str(x?.label, 60) }))
      .filter((x) => x.t && x.v && (x.t !== 'tool' || /^[a-z]{2,20}$/.test(x.v)) && (x.t !== 'node' || /^[\w./-]+\.md$/.test(x.v)));
  } else if (c.kind === 'search') {
    out.q = str(c.q, 200);
    out.max = Math.min(12, Math.max(1, Math.round(Number(c.max)) || 6));
  } else if (c.kind === 'net') {
    out.center = /^[\w./-]+\.md$/.test(String(c.center || '')) ? String(c.center) : '';
    out.depth = Number(c.depth) === 2 ? 2 : 1;
  } else if (c.kind === 'countdown') {
    out.date = /^\d{4}-\d\d-\d\d$/.test(String(c.date || '')) ? String(c.date) : '';
    out.what = str(c.what, 80);
  }
  return out;
}

// The blocks among `ids`: Map id → { ...config, content }.
export function blocksOf(meta, text, ids) {
  const out = new Map();
  for (const id of ids) {
    if (!isBlockId(id)) continue;
    let raw = meta?.[cfgKey(id)];
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
    const cfg = cleanConfig(raw);
    if (cfg) out.set(id, { ...cfg, content: partText(text, partName(id)) });
  }
  return out;
}

// The list of widgets of a board: names it knows, and building blocks.
export const widgetList = (v, known) => [...new Set(asList(v).filter((w) => known.includes(w) || isBlockId(w)))];
export const wideList = (v) => [...new Set(asList(v).filter((w) => /^[a-z0-9]{2,16}$/.test(w)))];

// Changes on the text of a board file (each returns the new text).
export const withConfig = (text, id, cfg, after = ['widgets']) => setField(text, cfgKey(id), JSON.stringify(cleanConfig(cfg)), after);
export const withContent = (text, id, body) => setPart(text, partName(id), keepInPart(body));
export const withoutBlock = (text, id) => removePart(removeField(text, cfgKey(id)), partName(id));

// A checklist is kept as Markdown: "- [ ] …" and "- [x] …" lines.
export function checkItems(content) {
  return [...String(content).matchAll(/^- \[([ xX])\] (.*)$/gm)].map((m) => ({ done: m[1] !== ' ', text: m[2].trim() }));
}
export const checkText = (items) => items.map((x) => `- [${x.done ? 'x' : ' '}] ${String(x.text).replace(/\s+/g, ' ').trim()}`).join('\n');
