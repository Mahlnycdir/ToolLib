// Projects (0.15.0): the bracket around everything you do for one aim. A project is a node in your knowledge:
//   projects/<name>.md   type: project; title, goal, state (active, paused, done), links: [every node that belongs to it];
//                        below: "## Next" with your steps as "- [ ] …" lines, and "## Notes" with free text
//                        A step has a light (0.28.0): "- [ ]" open, "- [!]" next (red), "- [>]" handed in / waiting
//                        (yellow), "- [x]" done (green). Obsidian reads these as tasks too.
// Since 0.18.0 a project is a board: sections ("id|title|colour" in `sections`, the three stations when there are
// none) with the order of their cards in one line each (`board_<id>: [slugs]`), and widgets (`widgets: [...]`) with
// their own data: `read`, `pins`, `due`, `due_what`, and the parts "## Links", "## Calc", "## Time" below.
// Every list sits on a line of its own, so two devices that change the same project at once are joined by the sync
// (lists are united, lines below the head both kept), never a conflict copy.
// One project can be in focus on this device: whatever you create while it is in focus (a note, a card, a snippet,
// a page, a research folder, a work you keep) joins it by itself. What sits in something that already belongs to the
// project does not join one by one: pages of a run through a website (their folder does), works kept into a folder of
// the project, pages of a library of the project.
import { KNOWLEDGE, exists } from './storage.js';
import { deleteNode, parseNode, readNodeText, removeField, setField, slugify, writeNode, yamlValue } from './nodes.js';
import { allNodes, forgetNode, nodeByPath, nodeBySlug, refreshNode } from './search.js';
import { noteChange, onNoteChange } from './sync.js';
import { announce } from './channel.js';
import { loadPref, savePref } from './prefs.js';
import { removeCanvas } from './canvas-store.js';
import { keepInPart, partText, setPart } from './md-parts.js';
import { blocksOf, cleanConfig, widgetList, wideList, withConfig, withContent, withoutBlock } from './widget-store.js';

const q = (v) => JSON.stringify(String(v));
// the steps under "## Next" and their lights (0.28.0)
export const STEP_STATUS = ['open', 'next', 'wait', 'done'];
const STEP_LINE = /^- \[([ xX!>])\] (.*)$/;
const STATUS_OF = { ' ': 'open', '!': 'next', '>': 'wait', x: 'done', X: 'done' };
const MARK_OF = { open: ' ', next: '!', wait: '>', done: 'x' };
const today = () => new Date().toISOString().slice(0, 10);
const asList = (v) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
const slugOf = (path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
export const STATES = ['active', 'paused', 'done'];

// Active ones first, then the one you used last.
export function projects() {
  const used = loadPref('projects.used', []);
  const rank = (d) => { const i = used.indexOf(d.path); return i < 0 ? 999 : i; };
  return allNodes().filter((d) => d.type === 'project' && !d.conflict)
    .sort((a, b) => STATES.indexOf(a.state) - STATES.indexOf(b.state) || rank(a) - rank(b) || a.title.localeCompare(b.title));
}
export const projectsWith = (slug) => projects().filter((p) => p.links.includes(slug));
export function touchProject(path) {
  savePref('projects.used', [path, ...loadPref('projects.used', []).filter((p) => p !== path)].slice(0, 30));
}

// ------------------------------------------------------------------ focus
// 0.33.7 (ENTE: "Mache halt Prios im Fokus … keine darf dieselbe haben … nicht eingeschränkt"): any number of projects
// can be in focus, each with its own priority (1, 2, 3 … in this order, none twice). The list sits in start.md as
// `focus: [paths]` (start-store.js), so the Mac and the iPhone share it; this module keeps a copy (pref
// `focus.order`, device) so everything draws at once. The tabs on top show exactly this list, in this order.
// Besides the list there is the project you work on right now on this device (pref `focus`, as before): whatever you
// create joins it. It is always one of the list (setFocus puts a project in, at the end); without one, priority 1.
const focusListeners = new Set();
let order = loadPref('focus.order', null);   // null: never set (seeded from the old focus and the control panel)
let saveOrder = null;                        // start-store.js writes the list into start.md
export function onFocusOrderSave(fn) { saveOrder = fn; }
const NONE = '-';                            // "nothing in focus right now" (research: keep into the inbox)
const isOpen = (d) => d && d.type === 'project' && !d.conflict && d.state !== 'done';
function tellFocus() { const f = focusPath(); for (const fn of focusListeners) { try { fn(f); } catch (e) { console.warn(e); } } }
// the projects in focus, priority 1 first (done, deleted or unknown ones left out)
export function focusList() {
  const seen = new Set();
  const out = [];
  for (const p of order || []) { const d = nodeByPath(p); if (isOpen(d) && !seen.has(p)) { seen.add(p); out.push(d); } }
  return out;
}
export const focusRank = (path) => focusList().findIndex((d) => d.path === path) + 1;   // 0 = not in focus
function storeOrder(list, { write = true } = {}) {
  const next = [...new Set(list.filter((p) => /^projects\/[\w.-]+\.md$/.test(p)))];
  if (order && next.join('|') === order.join('|')) return;
  order = next;
  savePref('focus.order', order);
  if (write && saveOrder) saveOrder(order).catch?.((e) => console.warn('focus order', e));
  tellFocus();
}
// start.md was read (here, from another window or a sync): its list wins. Without one the list is made once on this
// device from the old focus and the projects of the control panel; nothing is written then (reading never writes,
// so a fresh device can still clone), the file gets the list with your first change.
export function adoptFocusOrder(list, seed = []) {
  if (Array.isArray(list)) { storeOrder(list, { write: false }); return; }
  if (order) return;
  const old = loadPref('focus', '');
  storeOrder([...(old && old !== NONE ? [old] : []), ...seed], { write: false });
}
export function setFocusOrder(paths) { storeOrder(paths); }
export function addToFocus(path, at = -1) {
  const list = (order || []).filter((p) => p !== path);
  list.splice(at < 0 ? list.length : Math.min(at, list.length), 0, path);
  storeOrder(list);
}
export function removeFromFocus(path) {
  if (loadPref('focus', '') === path) savePref('focus', '');
  storeOrder((order || []).filter((p) => p !== path));
}
// a new priority (1 = first); the others move up or down, none shares a number
export function moveFocus(path, rank) {
  const list = focusList().map((d) => d.path).filter((p) => p !== path);
  list.splice(Math.max(0, Math.min(rank - 1, list.length)), 0, path);
  storeOrder([...list, ...(order || []).filter((p) => !list.includes(p))]);
}
export function focusPath() {
  const mine = loadPref('focus', '');
  if (mine === NONE) return '';
  const list = focusList();
  if (mine && list.some((d) => d.path === mine)) return mine;
  return list[0]?.path || '';
}
export function focusProject() {
  const d = nodeByPath(focusPath());
  return d && d.type === 'project' && !d.conflict ? d : null;
}
// The project you work on now (on this device). It joins the list at the end when it is not in yet; the priorities
// of the others stay as they are. setFocus('') = nothing in focus right now (what you keep goes to the inbox).
export function setFocus(path) {
  savePref('focus', path || NONE);
  if (path) { touchProject(path); if (!(order || []).includes(path)) { addToFocus(path); return; } }
  tellFocus();
}
export function onFocusChange(fn) { focusListeners.add(fn); return () => focusListeners.delete(fn); }

// ------------------------------------------------------------------ files
async function freePath(base) {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const path = `projects/${slug}.md`;
    if (!nodeBySlug(slug) && !(await exists(`${KNOWLEDGE}/${path}`))) return path;
  }
}

async function written(path, what) {
  await refreshNode(path);
  await noteChange(path, what);
  announce([path]);
}

// steps: [{ text, status }] as "- [ ] …" lines under "## Next"; fromPath: the slug of the path it was begun from.
export function projectText({ title, goal = '', date = today(), steps = [], links = [], fromPath = '' }) {
  const slugs = [...new Set(asList(links).filter((x) => /^[\w.-]{1,120}$/.test(x)))];
  const from = /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(fromPath)) ? String(fromPath) : '';
  const head = ['---', 'type: project', `title: ${q(title)}`, goal ? `goal: ${q(goal)}` : null, 'state: active', `links: ${yamlValue(slugs)}`,
    from ? `from_path: ${q(from)}` : null, `created: ${q(date)}`, 'source: you', '---'].filter(Boolean);
  const lines = steps.map((x) => ({ text: String(x?.text || '').replace(/\s+/g, ' ').trim(), mark: MARK_OF[x?.status] ?? ' ' })).filter((x) => x.text)
    .map((x) => `- [${x.mark}] ${x.text}`);
  return `${head.join('\n')}\n\n## Next\n\n${lines.length ? `${lines.join('\n')}\n\n` : ''}## Notes\n`;
}

// 0.30.0: a project begun from a path brings its steps (with their lights), its members and the path it walks.
export async function createProject({ title, goal = '', steps = [], links = [], fromPath = '' }) {
  const name = String(title).trim();
  if (!name) throw new Error('A project needs a title');
  const path = await freePath(slugify(name).slice(0, 40) || 'project');
  await writeNode(path, projectText({ title: name, goal: String(goal).trim(), steps, links, fromPath }));
  await written(path, 'added');
  touchProject(path);
  return path;
}

export async function deleteProject(path) {
  await deleteNode(path);
  forgetNode(path);
  await noteChange(path, 'removed');
  await removeCanvas(path).catch(() => {});   // its canvas (0.27.0)
  announce([path]);
  if ((order || []).includes(path)) removeFromFocus(path);
}

// Parts "## <name>" of the file ("## Calc", "## Time", "## Links", widget contents): md-parts.js.

// The parts of a project file: where "## Next" and "## Notes" sit, as line numbers.
function sections(text) {
  const lines = text.split('\n');
  let fmEnd = 0;
  if (lines[0]?.replace(/^﻿/, '') === '---') { fmEnd = lines.indexOf('---', 1) + 1; }
  const find = (name) => lines.findIndex((l, i) => i >= fmEnd && new RegExp(`^## ${name}\\s*$`).test(l));
  const end = (from) => { for (let i = from + 1; i < lines.length; i++) if (/^## /.test(lines[i])) return i; return lines.length; };
  const next = find('Next');
  const notes = find('Notes');
  return { lines, fmEnd, next, nextEnd: next < 0 ? -1 : end(next), notes, notesEnd: notes < 0 ? -1 : end(notes) };
}

// What the project view shows: { path, slug, title, goal, state, links, steps: [{ text, done }], notes }
export async function loadProject(path) {
  const text = await readNodeText(path);
  const node = parseNode(text, path);
  const s = sections(text);
  const steps = [];
  if (s.next >= 0) {
    for (let i = s.next + 1; i < s.nextEnd; i++) {
      const m = s.lines[i].match(STEP_LINE);
      if (m) { const status = STATUS_OF[m[1]]; steps.push({ text: m[2].trim(), done: status === 'done', status }); }
    }
  }
  const notes = s.notes >= 0 ? s.lines.slice(s.notes + 1, s.notesEnd).join('\n').trim() : '';
  return {
    path, slug: node.slug, title: String(node.meta.title || node.slug), goal: String(node.meta.goal || ''),
    state: STATES.includes(node.meta.state) ? node.meta.state : 'active', links: asList(node.meta.links), steps, notes,
    repo: repoUrl(node.meta.repo),
    ...boardParts(node.meta, text),
  };
}

// The code repository of a project (0.24.0): an https address of a Git repository, as Kobra clones it. Anything else
// is left out, so the project view never links to something odd.
export function repoUrl(v) {
  const s = String(v ?? '').trim();
  if (!/^https:\/\/[^\s"'<>]{3,300}$/.test(s)) return '';
  try { return new URL(s).protocol === 'https:' ? s : ''; } catch { return ''; }
}
// "owner/name" for the eye; the address stays as it is
export function repoLabel(url) {
  try { return new URL(url).pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '') || url; } catch { return url; }
}

// ------------------------------------------------------------------ the board (0.18.0)
// Where a node goes on its own: the station of its kind, as before 0.18.0.
const STATION = {
  clip: 'collect', research: 'collect',
  formula: 'keep', definition: 'keep', theorem: 'keep', term: 'keep', convention: 'keep', topic: 'keep', note: 'keep', rule: 'keep', part: 'keep', device: 'keep',
  page: 'keep', library: 'keep',
  snippet: 'apply', recipe: 'apply', path: 'apply', pin_map: 'apply', tool: 'apply',
};
export const stationOf = (type) => STATION[type] || 'keep';
export const DEFAULT_SECTIONS = [{ id: 'collect', title: '', color: 'sky' }, { id: 'keep', title: '', color: 'violet' }, { id: 'apply', title: '', color: 'green' }];
export const SECTION_COLOURS = ['blue', 'sky', 'teal', 'green', 'orange', 'rose', 'violet', 'yellow', 'slate'];
export const WIDGETS = ['steps', 'ahead', 'reading', 'pins', 'calc', 'timer', 'due', 'links', 'pages', 'notes'];   // ahead: "Weiterkommen" (0.30.0)
export const DEFAULT_WIDGETS = ['steps', 'ahead', 'pages', 'reading', 'notes'];

// "id|title|colour" → { id, title, colour }; when the sync joined two versions of one section, the later one wins.
// 0.33.0: a section can sit inside another ("id|title|colour|parent"): a subgroup, on the board and on the canvas
// (board and canvas share one structure of groups since 0.33.0). A parent that is missing, or a ring, is dropped.
export function parseSections(list) {
  const out = [];
  for (const raw of asList(list)) {
    const [id, title = '', color = '', parent = ''] = String(raw).split('|');
    if (!/^[a-z0-9-]{1,40}$/.test(id || '')) continue;
    const s = { id, title: title.trim(), color: SECTION_COLOURS.includes(color) ? color : 'slate', parent: /^[a-z0-9-]{1,40}$/.test(parent) && parent !== id ? parent : '' };
    const i = out.findIndex((x) => x.id === id);
    if (i >= 0) out[i] = s; else out.push(s);
  }
  const ids = new Set(out.map((x) => x.id));
  for (const x of out) {
    if (!ids.has(x.parent)) { x.parent = ''; continue; }
    // no rings and at most three levels
    const seen = new Set([x.id]);
    let up = x.parent; let depth = 1;
    while (up) { if (seen.has(up) || depth > 2) { x.parent = ''; break; } seen.add(up); up = out.find((y) => y.id === up)?.parent || ''; depth += 1; }
  }
  return out;
}
const sectionLine = (s) => `${s.id}|${String(s.title || '').replace(/\|/g, '/')}|${s.color || ''}${s.parent ? `|${s.parent}` : ''}`;
// The sections inside `id`, all levels down (for moving a group with everything in it).
export function sectionTree(secs, id) {
  const out = [];
  const walk = (pid) => { for (const s of secs) if (s.parent === pid && !out.includes(s.id)) { out.push(s.id); walk(s.id); } };
  walk(id);
  return out;
}
export const depthOfSection = (secs, id) => { let d = 0; let s = secs.find((x) => x.id === id); while (s?.parent && d < 4) { d += 1; s = secs.find((x) => x.id === s.parent); } return d; };
const isDate = (v) => /^\d{4}-\d\d-\d\d$/.test(String(v || ''));

function boardParts(meta, text) {
  const board = {};
  for (const [k, v] of Object.entries(meta)) if (/^board_[a-z0-9-]{1,40}$/.test(k)) board[k.slice(6)] = asList(v);
  const links = [];
  for (const l of partText(text, 'Links').split('\n')) {
    const m = l.match(/^-\s+\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)\s*$/);
    if (m) links.push({ title: m[1].trim() || m[2], url: m[2] });
  }
  const time = [];
  for (const l of partText(text, 'Time').split('\n')) {
    const m = l.match(/^-\s+(\d{4}-\d\d-\d\d)(?:\s+(\d\d:\d\d))?\s*·\s*(\d+)\s*min/);
    if (m) time.push({ day: m[1], at: m[2] || '', minutes: Number(m[3]) });
  }
  return {
    sections: parseSections(meta.sections),
    board,
    widgets: meta.widgets == null ? null : widgetList(meta.widgets, WIDGETS),
    wide: wideList(meta.wide),   // 0.28.0: widgets two columns wide
    size: sizeMapOf(meta),       // 0.33.0: sizes of the widgets (1×1 left out; `wide` read as 2×1)
    col: colMapOf(meta),         // 0.33.2: their columns on a board of four, `col: {"steps": 2}`
    blocks: blocksOf(meta, text, meta.widgets == null ? [] : widgetList(meta.widgets, WIDGETS)),   // building blocks (widget-store.js)
    read: asList(meta.read),
    pins: asList(meta.pins),
    thread: asList(meta.thread),   // 0.27.0: the red thread, cards in your own order
    due: isDate(meta.due) ? String(meta.due) : '',
    dueWhat: meta.due_what ? String(meta.due_what) : '',
    links2: links,
    calc: partText(text, 'Calc'),
    time,
  };
}
const SIZE_NAMES = ['1x1', '2x1', '1x2', '2x2'];
function sizeMapOf(meta) {
  const out = {};
  for (const id of wideList(meta.wide)) out[id] = '2x1';
  let raw = meta.size;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [id, v] of Object.entries(raw)) if (/^[a-z0-9]{2,16}$/.test(id) && SIZE_NAMES.includes(v)) out[id] = v;
  for (const id of Object.keys(out)) if (out[id] === '1x1') delete out[id];
  return out;
}
function colMapOf(meta) {
  let raw = meta.col;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
  return cleanCol(raw);
}
function cleanCol(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [id, x] of Object.entries(raw)) if (/^[a-z0-9]{2,16}$/.test(id) && Number.isInteger(x) && x >= 0 && x <= 3) out[id] = x;
  return out;
}
export const sectionsOf = (p) => (p.sections?.length ? p.sections : DEFAULT_SECTIONS.map((s) => ({ ...s })));
export const widgetsOf = (p) => (p.widgets == null ? DEFAULT_WIDGETS : p.widgets);

// The board as it shows: [{ id, title, color, items: [summary] }]. Cards you placed keep their place; the others go
// to the section of their kind (or the first one); the library of the project is no card (its pages are a widget).
export function boardOf(p, members = projectNodes(p.links)) {
  const secs = sectionsOf(p).map((s) => ({ ...s, items: [] }));
  const cards = members.filter((n) => n.type !== 'library');
  const bySlug = new Map(cards.map((n) => [n.slug, n]));
  const placed = new Set();
  for (const s of secs) {
    for (const slug of p.board?.[s.id] || []) {
      const n = bySlug.get(slug);
      if (n && !placed.has(slug)) { s.items.push(n); placed.add(slug); }
    }
  }
  for (const n of cards) {
    if (placed.has(n.slug)) continue;
    (secs.find((s) => s.id === stationOf(n.type)) || secs[0]).items.push(n);
    placed.add(n.slug);
  }
  return secs;
}

async function projectFromText(path) {
  const text = await readNodeText(path);
  const node = parseNode(text, path);
  return { text, p: { links: asList(node.meta.links), ...boardParts(node.meta, text) } };
}
async function changeProject(path, fn) {
  const { text, p } = await projectFromText(path);
  const next = fn(text, p);
  if (next == null || next === text) return false;
  await writeNode(path, next);
  await written(path, 'edited');
  return true;
}
const AFTER_LINKS = ['links', 'state', 'goal', 'title'];
const setBoard = (text, id, list) => setField(text, `board_${id}`, yamlValue(list), AFTER_LINKS);
const writeSections = (text, secs) => setField(text, 'sections', yamlValue(secs.map(sectionLine)), AFTER_LINKS);

// A card to section `to`, in front of the card at `index` (as the section shows, the moved card included; -1: last).
export const placeItem = (path, slug, to, index = -1) => changeProject(path, (text, p) => {
  const board = boardOf(p);
  const from = board.find((s) => s.items.some((n) => n.slug === slug));
  const target = board.find((s) => s.id === to);
  if (!target || !from) return null;
  const list = target.items.map((n) => n.slug);
  let at = index < 0 || index > list.length ? list.length : index;
  if (from === target) {
    const old = list.indexOf(slug);
    if (old === at || old + 1 === at) return null;
    list.splice(old, 1);
    if (old < at) at -= 1;
  }
  list.splice(at, 0, slug);
  let next = setBoard(text, target.id, list);
  // the old section only needs a line if it named the card (a card it holds by its kind leaves on its own)
  if (from !== target && (p.board?.[from.id] || []).includes(slug)) next = setBoard(next, from.id, from.items.map((n) => n.slug).filter((s) => s !== slug));
  return next;
});

const freeId = (title, taken) => {
  const base = slugify(String(title)).slice(0, 30) || 'section';
  for (let n = 1; ; n++) { const id = n === 1 ? base : `${base}-${n}`; if (!taken.includes(id)) return id; }
};
export async function addSection(path, title, color = 'slate', parent = '') {
  let id = '';
  await changeProject(path, (text, p) => {
    const secs = sectionsOf(p);
    id = freeId(title, secs.map((s) => s.id));
    const s = { id, title: String(title).trim(), color, parent: secs.some((x) => x.id === parent) ? parent : '' };
    // a subgroup comes right after the last section inside its parent
    if (s.parent) {
      const inside = [s.parent, ...sectionTree(secs, s.parent)];
      const at = Math.max(...inside.map((x) => secs.findIndex((y) => y.id === x))) + 1;
      return writeSections(text, [...secs.slice(0, at), s, ...secs.slice(at)]);
    }
    return writeSections(text, [...secs, s]);
  });
  return id;
}
// A section into another (a subgroup) or out to the top (parent ''); never into itself or one of its own.
export const setSectionParent = (path, id, parent) => changeProject(path, (text, p) => {
  const secs = sectionsOf(p);
  const s = secs.find((x) => x.id === id);
  if (!s || (parent && (parent === id || sectionTree(secs, id).includes(parent) || !secs.some((x) => x.id === parent)))) return null;
  if ((s.parent || '') === (parent || '')) return null;
  s.parent = parent || '';
  return writeSections(text, secs);
});
export const updateSection = (path, id, change) => changeProject(path, (text, p) => {
  const secs = sectionsOf(p);
  const s = secs.find((x) => x.id === id);
  if (!s) return null;
  if (change.title != null) s.title = String(change.title).trim();
  if (change.color && SECTION_COLOURS.includes(change.color)) s.color = change.color;
  return writeSections(text, secs);
});
// A section goes; its cards go back to the section of their kind. The last section stays. Its subgroups move up
// to its parent (0.33.0).
export const removeSection = (path, id) => changeProject(path, (text, p) => {
  const secs = sectionsOf(p);
  const gone = secs.find((s) => s.id === id);
  if (secs.length < 2 || !gone) return null;
  const rest = secs.filter((s) => s.id !== id).map((s) => (s.parent === id ? { ...s, parent: gone.parent || '' } : s));
  return removeField(writeSections(text, rest), `board_${id}`);
});
// 0.33.7: one write that tidies the sections (canvas repair): `drop` = ids of empty twins to take away, `parents` =
// { id: parent } for groups that lie inside another frame. A parent that would make a ring is left out.
export const repairSections = (path, { drop = [], parents = {} }) => changeProject(path, (text, p) => {
  let secs = sectionsOf(p).filter((s) => !drop.includes(s.id) || (p.board?.[s.id] || []).length);
  if (secs.length < 1) return null;
  const ids = new Set(secs.map((s) => s.id));
  for (const s of secs) if (s.parent && !ids.has(s.parent)) s.parent = '';
  for (const [id, parent] of Object.entries(parents)) {
    const s = secs.find((x) => x.id === id);
    if (!s || !ids.has(parent) || parent === id || sectionTree(secs, id).includes(parent)) continue;
    s.parent = parent;
  }
  // subgroups right after their parent, so the board shows them in order
  const top = secs.filter((s) => !s.parent);
  const ordered = [];
  const walk = (s) => { ordered.push(s); for (const c of secs.filter((x) => x.parent === s.id)) walk(c); };
  top.forEach(walk);
  for (const s of secs) if (!ordered.includes(s)) ordered.push(s);
  let next = writeSections(text, ordered);
  for (const id of drop) if (!ids.has(id)) next = removeField(next, `board_${id}`);
  return next === text ? null : next;
});
// A section to the place before index `before` (as the sections stand); its subgroups go along (0.33.0).
export const moveSectionTo = (path, id, before) => changeProject(path, (text, p) => {
  const secs = sectionsOf(p);
  const from = secs.findIndex((s) => s.id === id);
  if (from < 0) return null;
  const block = new Set([id, ...sectionTree(secs, id)]);
  const anchor = before < 0 || before >= secs.length ? null : secs[before];
  if (anchor && block.has(anchor.id)) return null;
  const moving = secs.filter((s) => block.has(s.id));
  const rest = secs.filter((s) => !block.has(s.id));
  const at = anchor ? rest.indexOf(anchor) : rest.length;
  const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  if (next.every((s, i) => s === secs[i])) return null;
  return writeSections(text, next);
});

// ------------------------------------------------------------------ widgets and their data
export const setWidgets = (path, list) => changeProject(path, (text) => setField(text, 'widgets', yamlValue(widgetList(list, WIDGETS)), AFTER_LINKS));
// 0.28.0: wide widgets and building blocks (widget-store.js) in a project, like on Start
export const setProjectWide = (path, wide) => setProjectSizes(path, Object.fromEntries(wideList(wide).map((id) => [id, '2x1'])));
// 0.33.0: sizes like on Heute, one line `size: {"steps": "2x1"}`; the older `wide` goes on the first save
export const setProjectSizes = (path, sizes) => changeProject(path, (text) => removeField(setField(text, 'size',
  JSON.stringify(Object.fromEntries(Object.entries(sizes || {}).filter(([id, v]) => /^[a-z0-9]{2,16}$/.test(id) && SIZE_NAMES.includes(v) && v !== '1x1'))), ['widgets', ...AFTER_LINKS]), 'wide'));
// 0.33.2: order, sizes and columns in one change (after you laid a widget somewhere)
export const setProjectLayout = (path, { list, sizes, col }) => changeProject(path, (text) => {
  let next = setField(text, 'widgets', yamlValue(widgetList(list, WIDGETS)), AFTER_LINKS);
  next = removeField(setField(next, 'size', JSON.stringify(Object.fromEntries(Object.entries(sizes || {}).filter(([id, v]) => /^[a-z0-9]{2,16}$/.test(id) && SIZE_NAMES.includes(v) && v !== '1x1'))), ['widgets', ...AFTER_LINKS]), 'wide');
  const cols = cleanCol(col);
  return Object.keys(cols).length ? setField(next, 'col', JSON.stringify(cols), ['size', 'widgets', ...AFTER_LINKS]) : removeField(next, 'col');
});
export const addProjectBlock = (path, id, cfg) => changeProject(path, (text, p) => setField(withConfig(text, id, cfg, ['widgets', ...AFTER_LINKS]), 'widgets', yamlValue([...widgetsOf(p), id]), AFTER_LINKS));
export const saveProjectBlock = (path, id, cfg) => changeProject(path, (text) => withConfig(text, id, cfg, ['widgets', ...AFTER_LINKS]));
export const saveProjectBlockContent = (path, id, body) => changeProject(path, (text) => withContent(text, id, body));
export const removeProjectWidget = (path, id) => changeProject(path, (text, p) => {
  let next = setField(text, 'widgets', yamlValue(widgetsOf(p).filter((x) => x !== id)), AFTER_LINKS);
  if (p.size[id]) { const size = { ...p.size }; delete size[id]; next = removeField(setField(next, 'size', JSON.stringify(size), ['widgets', ...AFTER_LINKS]), 'wide'); }
  if (p.col?.[id] != null) { const col = { ...p.col }; delete col[id]; next = Object.keys(col).length ? setField(next, 'col', JSON.stringify(col), ['size', 'widgets', ...AFTER_LINKS]) : removeField(next, 'col'); }
  return withoutBlock(next, id);
});
// "Undo" after taking a widget away (0.33.0): place, size and a building block's config and content come back
export function projectSnapshot(p, id) {
  const b = p.blocks?.get(id);
  return { id, index: widgetsOf(p).indexOf(id), size: p.size?.[id] || '', col: p.col?.[id] ?? null, cfg: b ? cleanConfig(b) : null, content: b?.content || '' };
}
export const restoreProjectWidget = (path, snap) => changeProject(path, (text, p) => {
  const list = [...widgetsOf(p)];
  if (list.includes(snap.id)) return null;
  list.splice(snap.index < 0 ? list.length : Math.min(snap.index, list.length), 0, snap.id);
  let next = setField(text, 'widgets', yamlValue(list), AFTER_LINKS);
  if (snap.size) next = removeField(setField(next, 'size', JSON.stringify({ ...p.size, [snap.id]: snap.size }), ['widgets', ...AFTER_LINKS]), 'wide');
  if (snap.col != null) next = setField(next, 'col', JSON.stringify(cleanCol({ ...p.col, [snap.id]: snap.col })), ['size', 'widgets', ...AFTER_LINKS]);
  if (snap.cfg) next = withConfig(next, snap.id, snap.cfg, ['size', 'widgets', ...AFTER_LINKS]);
  if (snap.content) next = withContent(next, snap.id, snap.content);
  return next;
});
const toggleIn = (key) => (path, slug, on) => changeProject(path, (text, p) => {
  const list = p[key];
  const has = list.includes(slug);
  const want = on ?? !has;
  if (want === has) return null;
  return setField(text, key, yamlValue(want ? [...list, slug] : list.filter((s) => s !== slug)), AFTER_LINKS);
});
// The red thread of a project (0.27.0, ENTE: "wie ein roter Faden"): the cards in the order you tapped them, one line
// `thread: [slugs]` in the project. An empty thread removes the line.
export const setThread = (path, list) => changeProject(path, (text, p) => {
  const next = [...new Set(asList(list).filter((x) => p.links.includes(x)))];
  if (next.length === p.thread.length && next.every((x, i) => x === p.thread[i])) return null;
  return next.length ? setField(text, 'thread', yamlValue(next), AFTER_LINKS) : removeField(text, 'thread');
});
// Where a card stands in the red thread: { index, prev, next, list } or null
export function threadPlace(p, slug) {
  const i = (p.thread || []).indexOf(slug);
  return i < 0 ? null : { index: i, prev: p.thread[i - 1] || null, next: p.thread[i + 1] || null, list: p.thread };
}
// A red thread along the derivations (0.27.1, "Roten Faden vorschlagen"): what a card follows from, and the
// conventions it uses, come before it. Among the cards free to come next, one that builds on the card placed last
// goes first (so a chain stays together), then definitions before formulas before snippets, then the board's order.
// Notes, sources and folders stay out, unless fewer than two cards would remain. Returns the slugs in order.
// For Python readers: a topological sort like graphlib.TopologicalSorter, picking the next node by a sort key.
const STEP_RANK = { definition: 0, term: 0, convention: 1, topic: 2, theorem: 3, formula: 3, page: 4, snippet: 5, recipe: 5 };
export const suggestThread = (p, members = projectNodes(p.links)) => suggestThreadWhy(p, members).map((x) => x.slug);
// The same with the reason for every place (0.34.0, P5: "Vorschlag nachvollziehbar"):
//   { slug, why: 'chain' (builds on the card before) | 'after' (follows from / uses cards placed earlier: refs)
//               | 'kind' (definitions before formulas before snippets) | 'board' (the board's order) | 'circle', refs }
export function suggestThreadWhy(p, members = projectNodes(p.links)) {
  const usable = members.filter((d) => d && !d.conflict && d.type !== 'library' && d.type !== 'project');
  let list = usable.filter((d) => d.type in STEP_RANK);
  if (list.length < 2) list = usable;
  const slugs = new Set(list.map((d) => d.slug));
  const boardPos = new Map(boardOf(p, members).flatMap((sec) => sec.items).map((d, i) => [d.slug, i]));
  // before.get(x): the cards of this project that have to come before x
  const before = new Map(list.map((d) => [d.slug, new Set([...(d.derived || []), ...(d.conventions || [])].filter((x) => x !== d.slug && slugs.has(x)))]));
  const out = [];
  const placed = new Set();
  while (out.length < list.length) {
    const left = list.filter((d) => !placed.has(d.slug));
    const free = left.filter((d) => [...before.get(d.slug)].every((x) => placed.has(x)));
    const pool = free.length ? free : left;   // a circle in the derivations: take the best one and go on
    const last = out[out.length - 1]?.slug;
    const key = (d) => [last && before.get(d.slug).has(last) ? 0 : 1, STEP_RANK[d.type] ?? 9, boardPos.get(d.slug) ?? 999];
    pool.sort((a, b) => { const ka = key(a); const kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2]; });
    const d = pool[0];
    const refs = [...before.get(d.slug)];
    const rivals = pool.slice(1);
    let why = 'board';
    if (!free.length) why = 'circle';
    else if (last && before.get(d.slug).has(last)) why = 'chain';
    else if (refs.length) why = 'after';
    else if (rivals.some((r) => (STEP_RANK[r.type] ?? 9) > (STEP_RANK[d.type] ?? 9))) why = 'kind';
    out.push({ slug: d.slug, why, refs: why === 'chain' ? [last] : refs });
    placed.add(d.slug);
  }
  return out;
}
// Where a card stands against what it follows from: the cards of the thread it builds on that come after it
// (0.34.0, the overview marks them: "kommt vor seiner Herleitung")
export function threadClashes(p, members = projectNodes(p.links)) {
  const at = new Map((p.thread || []).map((s, i) => [s, i]));
  const out = new Map();
  for (const d of members) {
    if (!d || !at.has(d.slug)) continue;
    const late = [...new Set([...(d.derived || []), ...(d.conventions || [])])].filter((x) => at.has(x) && at.get(x) > at.get(d.slug));
    if (late.length) out.set(d.slug, late);
  }
  return out;
}
// The cards of sections in the order of the red thread (0.34.0, "Ausrichten" on the board): cards of the thread first,
// in its order, the others after them as they stood. ids: the sections (all when empty). True when something changed.
export const orderByThread = (path, ids = []) => changeProject(path, (text, p) => {
  const at = new Map((p.thread || []).map((s, i) => [s, i]));
  if (!at.size) return null;
  let next = text;
  for (const sec of boardOf(p)) {
    if (ids.length && !ids.includes(sec.id)) continue;
    const list = sec.items.map((n) => n.slug);
    const sorted = list.map((s, i) => [s, i]).sort((a, b) => (at.get(a[0]) ?? Infinity) - (at.get(b[0]) ?? Infinity) || a[1] - b[1]).map((x) => x[0]);
    if (sorted.every((s, i) => s === list[i])) continue;
    next = setBoard(next, sec.id, sorted);
  }
  return next;
});
export const setRead = toggleIn('read');
export const setPinned = toggleIn('pins');
export const setDue = (path, date, what = '') => changeProject(path, (text) => {
  if (!date) return removeField(removeField(text, 'due'), 'due_what');
  if (!isDate(date)) return null;
  const next = setField(text, 'due', q(date), AFTER_LINKS);
  return String(what).trim() ? setField(next, 'due_what', q(String(what).trim()), ['due']) : removeField(next, 'due_what');
});
const linkLine = (l) => `- [${String(l.title).replace(/[[\]]/g, '')}](${l.url})`;
export const addLink = (path, title, url) => changeProject(path, (text, p) => {
  const u = String(url).trim().replace(/\(/g, '%28').replace(/\)/g, '%29');   // a bracket would end the Markdown link
  if (!/^https?:\/\/\S+$/.test(u)) return null;
  return setPart(text, 'Links', [...p.links2, { title: String(title || '').trim().replace(/\s+/g, ' ') || u, url: u }].map(linkLine).join('\n'));
});
export const removeLink = (path, index) => changeProject(path, (text, p) => {
  if (!p.links2[index]) return null;
  return setPart(text, 'Links', p.links2.filter((_, i) => i !== index).map(linkLine).join('\n'));
});
// a line "## …" would start a new part of the file, so it gets a space in front (still a comment for the pad)
export const saveCalc = (path, body) => changeProject(path, (text) => setPart(text, 'Calc', keepInPart(body)));
// A focus session of `minutes`, written as "- 2026-11-12 14:30 · 25 min" under "## Time".
export const addTime = (path, minutes, when = new Date()) => changeProject(path, (text, p) => {
  const pad = (n) => String(n).padStart(2, '0');
  const line = { day: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`, at: `${pad(when.getHours())}:${pad(when.getMinutes())}`, minutes: Math.round(minutes) };
  return setPart(text, 'Time', [...p.time, line].map((x) => `- ${x.day}${x.at ? ` ${x.at}` : ''} · ${x.minutes} min`).join('\n'));
});

async function change(path, fn, what = 'edited') {
  const text = await readNodeText(path);
  const next = fn(text);
  if (next == null || next === text) return false;
  await writeNode(path, next);
  await written(path, what);
  return true;
}

// ------------------------------------------------------------------ what belongs to a project
const setLinks = (text, list) => setField(text, 'links', yamlValue(list), ['state', 'goal', 'title']);
export const addToProject = (path, slugs) => change(path, (text) => {
  const before = asList(parseNode(text, path).meta.links);
  const own = slugOf(path);
  const after = [...new Set([...before, ...asList(slugs).filter((s) => s && s !== own)])];
  return after.length === before.length ? null : setLinks(text, after);
});
export const removeFromProject = (path, slug) => change(path, (text) => {
  const meta = parseNode(text, path).meta;
  const before = asList(meta.links);
  if (!before.includes(slug)) return null;
  let next = setLinks(text, before.filter((s) => s !== slug));
  // its place on the board, read and pinned go with it (0.18.0)
  for (const k of Object.keys(meta)) {
    if ((/^board_/.test(k) || k === 'read' || k === 'pins' || k === 'thread') && asList(meta[k]).includes(slug)) next = setField(next, k, yamlValue(asList(meta[k]).filter((s) => s !== slug)), AFTER_LINKS);
  }
  return next;
});

export const setProjectField = (path, key, value) => change(path, (text) => {
  const v = String(value ?? '').trim();
  if (key === 'title') return v ? setField(text, 'title', q(v)) : null;
  if (key === 'goal') return v ? setField(text, 'goal', q(v), ['title']) : removeField(text, 'goal');
  if (key === 'state') return STATES.includes(v) ? setField(text, 'state', v, ['goal', 'title']) : null;
  if (key === 'repo') {
    if (!v) return removeField(text, 'repo');
    return repoUrl(v) ? setField(text, 'repo', q(repoUrl(v)), ['state', 'goal', 'title']) : null;
  }
  return null;
});

// ------------------------------------------------------------------ steps and notes: only their lines change
function withNext(text) {
  const s = sections(text);
  if (s.next >= 0) return { s, text };
  // an older or hand-written file without the section: it goes in front of the notes
  const at = s.notes >= 0 ? s.notes : s.lines.length;
  const lines = [...s.lines.slice(0, at), '## Next', '', ...s.lines.slice(at)];
  const next = lines.join('\n');
  return { s: sections(next), text: next };
}

export const addStep = (path, step) => change(path, (text0) => {
  const line = String(step).replace(/\s+/g, ' ').trim();
  if (!line) return null;
  const { s } = withNext(text0);
  let at = s.next + 1;
  for (let i = s.next + 1; i < s.nextEnd; i++) if (STEP_LINE.test(s.lines[i])) at = i + 1;
  const lines = [...s.lines];
  const add = [`- [ ] ${line}`];
  if (at === s.next + 1) add.unshift('');          // a blank line under the heading
  if (lines[at] !== undefined && lines[at].trim() !== '') add.push('');
  if (lines[at] === undefined) add.push('');
  lines.splice(at, 0, ...add);
  return lines.join('\n');
});

function stepLine(s, index) {
  let n = -1;
  for (let i = s.next + 1; i < s.nextEnd; i++) if (STEP_LINE.test(s.lines[i]) && ++n === index) return i;
  return -1;
}
export const toggleStep = (path, index) => change(path, (text) => {
  const s = sections(text);
  const i = s.next < 0 ? -1 : stepLine(s, index);
  if (i < 0) return null;
  const lines = [...s.lines];
  lines[i] = lines[i].replace(/^- \[([ xX!>])\]/, (all, c) => `- [${STATUS_OF[c] === 'done' ? ' ' : 'x'}]`);
  return lines.join('\n');
});
// The light of a step (0.28.0): 'open', 'next' (red), 'wait' (handed in, yellow), 'done' (green).
export const setStepStatus = (path, index, status) => change(path, (text) => {
  const mark = MARK_OF[status];
  const s = sections(text);
  const i = mark == null || s.next < 0 ? -1 : stepLine(s, index);
  if (i < 0) return null;
  const lines = [...s.lines];
  lines[i] = lines[i].replace(/^- \[([ xX!>])\]/, `- [${mark}]`);
  return lines.join('\n');
});
// Moves step `from` in front of or behind step `to` (0.28.1: dragging steps); its light goes along.
export const moveStep = (path, from, to, place = 'before') => change(path, (text) => {
  const s = sections(text);
  if (s.next < 0 || from === to) return null;
  const i = stepLine(s, from);
  let j = stepLine(s, to);
  if (i < 0 || j < 0) return null;
  const lines = [...s.lines];
  const [line] = lines.splice(i, 1);
  if (i < j) j -= 1;
  lines.splice(place === 'after' ? j + 1 : j, 0, line);
  return lines.join('\n');
});
// What to go on with in a project: the first red step, else the first open one (handed-in ones wait for others).
export const nextUp = (steps) => steps.find((x) => x.status === 'next') || steps.find((x) => x.status === 'open') || null;
export const removeStep = (path, index) => change(path, (text) => {
  const s = sections(text);
  const i = s.next < 0 ? -1 : stepLine(s, index);
  if (i < 0) return null;
  const lines = [...s.lines];
  lines.splice(i, 1);
  return lines.join('\n');
});

export const saveProjectNotes = (path, notes) => change(path, (text) => {
  const s = sections(text);
  const body = String(notes).replace(/\s+$/, '');
  const lines = [...s.lines];
  if (s.notes < 0) return `${text.replace(/\n*$/, '\n')}\n## Notes\n\n${body}\n`;
  lines.splice(s.notes + 1, s.notesEnd - s.notes - 1, '', ...(body ? body.split('\n') : []), ...(s.notesEnd < lines.length ? [''] : []));
  return `${lines.join('\n').replace(/\n*$/, '')}\n`;
});

// ------------------------------------------------------------------ what is new joins the project in focus
// A node that was just added (noteChange 'added') and that you made: it joins the project in focus. The check runs
// a moment later, when the node is in the index. skip: paths that must not join (a note you filed elsewhere).
const waiting = new Set();
const skipped = new Set();
export const skipAutoLink = (path) => skipped.add(path);
let timer = 0;
const joins = (d) => d && !d.conflict && d.type !== 'project' && !(d.type === 'clip' && d.run);
// the folder or the library of the project that already holds this node
function heldBy(d, has) {
  if (d.type === 'page') return has.has(d.library);
  if (d.type === 'clip') return allNodes().some((f) => f.type === 'research' && !f.conflict && has.has(f.slug) && f.clips.includes(d.slug));
  return false;
}

async function linkWaiting() {
  const focus = focusProject();
  const paths = [...waiting];
  waiting.clear();
  if (!focus) return;
  const found = paths.filter((p) => !skipped.has(p)).map((p) => nodeByPath(p)).filter(joins);
  const has = new Set([...focus.links, ...found.map((d) => d.slug)]);
  const slugs = found.filter((d) => !heldBy(d, has)).map((d) => d.slug);
  for (const p of paths) skipped.delete(p);
  if (!slugs.length) return;
  try {
    await addToProject(focus.path, slugs);
    // views that show one of these nodes draw its project in
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('toollib:linked', { detail: paths }));
  } catch (e) { console.warn('Could not add to the project in focus', e); }
}

export function startAutoLink() {
  return onNoteChange((entries) => {
    if (!focusPath()) return;
    for (const [path, what] of entries) if (what === 'added' && !path.startsWith('projects/')) waiting.add(path);
    if (!waiting.size) return;
    clearTimeout(timer);
    timer = setTimeout(linkWaiting, 250);
  });
}

// Everything that belongs to a project, as summaries in the order it was added; names that are gone are left out.
export const projectNodes = (links) => asList(links).map((slug) => nodeBySlug(slug)).filter(Boolean);

// What a project collected (0.16.0): kept works (clips), runs through websites and the PDF inbox as one entry each
// (sites), and the works of folders from before 0.16.0 that belong to it. { sites, clips }
export function projectWorks(p) {
  if (!p) return { sites: [], clips: [] };
  const nodes = projectNodes(p.links);
  const sites = nodes.filter((n) => n.type === 'research' && (n.crawl || n.pdfInbox));
  const clips = nodes.filter((n) => n.type === 'clip');
  const seen = new Set(clips.map((d) => d.slug));
  for (const f of nodes.filter((n) => n.type === 'research' && !n.crawl && !n.pdfInbox)) {
    for (const s of f.clips) { const d = nodeBySlug(s); if (d?.type === 'clip' && !seen.has(s)) { seen.add(s); clips.push(d); } }
  }
  return { sites, clips: clips.sort((a, b) => a.title.localeCompare(b.title)) };
}
// The library that holds the pages of a project, if it has one.
export const projectLibrary = (p) => (p ? projectNodes(p.links).find((n) => n.type === 'library') || null : null);
