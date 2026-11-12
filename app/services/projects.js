// Projects (0.15.0): the bracket around everything you do for one aim. A project is a node in your knowledge:
//   projects/<name>.md   type: project; title, goal, state (active, paused, done), links: [every node that belongs to it];
//                        below: "## Next" with your steps as "- [ ] …" lines, and "## Notes" with free text
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

const q = (v) => JSON.stringify(String(v));
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
const focusListeners = new Set();
export const focusPath = () => loadPref('focus', '');
export function focusProject() {
  const d = nodeByPath(focusPath());
  return d && d.type === 'project' && !d.conflict ? d : null;
}
export function setFocus(path) {
  savePref('focus', path || '');
  if (path) touchProject(path);
  for (const fn of focusListeners) { try { fn(path || ''); } catch (e) { console.warn(e); } }
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

export function projectText({ title, goal = '', date = today() }) {
  const head = ['---', 'type: project', `title: ${q(title)}`, goal ? `goal: ${q(goal)}` : null, 'state: active', 'links: []', `created: ${q(date)}`, 'source: you', '---'].filter(Boolean);
  return `${head.join('\n')}\n\n## Next\n\n## Notes\n`;
}

export async function createProject({ title, goal = '' }) {
  const name = String(title).trim();
  if (!name) throw new Error('A project needs a title');
  const path = await freePath(slugify(name).slice(0, 40) || 'project');
  await writeNode(path, projectText({ title: name, goal: String(goal).trim() }));
  await written(path, 'added');
  touchProject(path);
  return path;
}

export async function deleteProject(path) {
  await deleteNode(path);
  forgetNode(path);
  await noteChange(path, 'removed');
  announce([path]);
  if (focusPath() === path) setFocus('');
}

// A part "## <name>" of the file: its heading line and the line where the next part starts, or -1.
function partOf(text, name) {
  const lines = text.split('\n');
  let fmEnd = 0;
  if (lines[0]?.replace(/^﻿/, '') === '---') { fmEnd = lines.indexOf('---', 1) + 1; }
  const at = lines.findIndex((l, i) => i >= fmEnd && l.trim() === `## ${name}`);
  let end = lines.length;
  if (at >= 0) for (let i = at + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break; }
  return { lines, at, end };
}
const partText = (text, name) => { const p = partOf(text, name); return p.at < 0 ? '' : p.lines.slice(p.at + 1, p.end).join('\n').trim(); };
// Puts `body` (text) under "## <name>", in place of what was there; a new part goes to the end of the file.
function setPart(text, name, body) {
  const p = partOf(text, name);
  const b = String(body).replace(/\s+$/, '');
  if (p.at < 0) return b ? `${text.replace(/\n*$/, '\n')}\n## ${name}\n\n${b}\n` : text;
  const lines = [...p.lines];
  lines.splice(p.at + 1, p.end - p.at - 1, '', ...(b ? b.split('\n') : []), ...(p.end < lines.length ? [''] : []));
  return `${lines.join('\n').replace(/\n*$/, '')}\n`;
}

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
      const m = s.lines[i].match(/^- \[([ xX])\] (.*)$/);
      if (m) steps.push({ text: m[2].trim(), done: m[1] !== ' ' });
    }
  }
  const notes = s.notes >= 0 ? s.lines.slice(s.notes + 1, s.notesEnd).join('\n').trim() : '';
  return {
    path, slug: node.slug, title: String(node.meta.title || node.slug), goal: String(node.meta.goal || ''),
    state: STATES.includes(node.meta.state) ? node.meta.state : 'active', links: asList(node.meta.links), steps, notes,
    ...boardParts(node.meta, text),
  };
}

// ------------------------------------------------------------------ the board (0.18.0)
// Where a node goes on its own: the station of its kind, as before 0.18.0.
const STATION = {
  clip: 'collect', research: 'collect',
  formula: 'keep', definition: 'keep', theorem: 'keep', term: 'keep', convention: 'keep', topic: 'keep', note: 'keep', rule: 'keep', part: 'keep', device: 'keep',
  page: 'keep', library: 'keep',
  snippet: 'apply', recipe: 'apply', pin_map: 'apply', tool: 'apply',
};
export const stationOf = (type) => STATION[type] || 'keep';
export const DEFAULT_SECTIONS = [{ id: 'collect', title: '', color: 'sky' }, { id: 'keep', title: '', color: 'violet' }, { id: 'apply', title: '', color: 'green' }];
export const SECTION_COLOURS = ['blue', 'sky', 'teal', 'green', 'orange', 'rose', 'violet', 'yellow', 'slate'];
export const WIDGETS = ['steps', 'reading', 'pins', 'calc', 'timer', 'due', 'links', 'pages', 'notes'];
export const DEFAULT_WIDGETS = ['steps', 'pages', 'reading', 'notes'];

// "id|title|colour" → { id, title, colour }; when the sync joined two versions of one section, the later one wins.
export function parseSections(list) {
  const out = [];
  for (const raw of asList(list)) {
    const [id, title = '', color = ''] = String(raw).split('|');
    if (!/^[a-z0-9-]{1,40}$/.test(id || '')) continue;
    const s = { id, title: title.trim(), color: SECTION_COLOURS.includes(color) ? color : 'slate' };
    const i = out.findIndex((x) => x.id === id);
    if (i >= 0) out[i] = s; else out.push(s);
  }
  return out;
}
const sectionLine = (s) => `${s.id}|${String(s.title || '').replace(/\|/g, '/')}|${s.color || ''}`;
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
    widgets: meta.widgets == null ? null : asList(meta.widgets).filter((w) => WIDGETS.includes(w)),
    read: asList(meta.read),
    pins: asList(meta.pins),
    due: isDate(meta.due) ? String(meta.due) : '',
    dueWhat: meta.due_what ? String(meta.due_what) : '',
    links2: links,
    calc: partText(text, 'Calc'),
    time,
  };
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
export async function addSection(path, title, color = 'slate') {
  let id = '';
  await changeProject(path, (text, p) => {
    const secs = sectionsOf(p);
    id = freeId(title, secs.map((s) => s.id));
    return writeSections(text, [...secs, { id, title: String(title).trim(), color }]);
  });
  return id;
}
export const updateSection = (path, id, change) => changeProject(path, (text, p) => {
  const secs = sectionsOf(p);
  const s = secs.find((x) => x.id === id);
  if (!s) return null;
  if (change.title != null) s.title = String(change.title).trim();
  if (change.color && SECTION_COLOURS.includes(change.color)) s.color = change.color;
  return writeSections(text, secs);
});
// A section goes; its cards go back to the section of their kind. The last section stays.
export const removeSection = (path, id) => changeProject(path, (text, p) => {
  const secs = sectionsOf(p);
  if (secs.length < 2 || !secs.some((s) => s.id === id)) return null;
  return removeField(writeSections(text, secs.filter((s) => s.id !== id)), `board_${id}`);
});
export const moveSectionTo = (path, id, before) => changeProject(path, (text, p) => {
  const secs = sectionsOf(p);
  const from = secs.findIndex((s) => s.id === id);
  if (from < 0) return null;
  let at = before < 0 || before > secs.length ? secs.length : before;
  if (at === from || at === from + 1) return null;
  const [s] = secs.splice(from, 1);
  if (at > from) at -= 1;
  secs.splice(at, 0, s);
  return writeSections(text, secs);
});

// ------------------------------------------------------------------ widgets and their data
export const setWidgets = (path, list) => changeProject(path, (text) => setField(text, 'widgets', yamlValue([...new Set(list)].filter((w) => WIDGETS.includes(w))), AFTER_LINKS));
const toggleIn = (key) => (path, slug, on) => changeProject(path, (text, p) => {
  const list = p[key];
  const has = list.includes(slug);
  const want = on ?? !has;
  if (want === has) return null;
  return setField(text, key, yamlValue(want ? [...list, slug] : list.filter((s) => s !== slug)), AFTER_LINKS);
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
export const saveCalc = (path, body) => changeProject(path, (text) => setPart(text, 'Calc', String(body).replace(/^(#{1,6}\s)/gm, ' $1').replace(/^---\s*$/gm, ' ---')));
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
    if ((/^board_/.test(k) || k === 'read' || k === 'pins') && asList(meta[k]).includes(slug)) next = setField(next, k, yamlValue(asList(meta[k]).filter((s) => s !== slug)), AFTER_LINKS);
  }
  return next;
});

export const setProjectField = (path, key, value) => change(path, (text) => {
  const v = String(value ?? '').trim();
  if (key === 'title') return v ? setField(text, 'title', q(v)) : null;
  if (key === 'goal') return v ? setField(text, 'goal', q(v), ['title']) : removeField(text, 'goal');
  if (key === 'state') return STATES.includes(v) ? setField(text, 'state', v, ['goal', 'title']) : null;
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
  for (let i = s.next + 1; i < s.nextEnd; i++) if (/^- \[[ xX]\] /.test(s.lines[i])) at = i + 1;
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
  for (let i = s.next + 1; i < s.nextEnd; i++) if (/^- \[[ xX]\] /.test(s.lines[i]) && ++n === index) return i;
  return -1;
}
export const toggleStep = (path, index) => change(path, (text) => {
  const s = sections(text);
  const i = s.next < 0 ? -1 : stepLine(s, index);
  if (i < 0) return null;
  const lines = [...s.lines];
  lines[i] = lines[i].replace(/^- \[([ xX])\]/, (all, c) => `- [${c === ' ' ? 'x' : ' '}]`);
  return lines.join('\n');
});
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
