// Projects (0.15.0): the bracket around everything you do for one aim. A project is a node in your knowledge:
//   projects/<name>.md   type: project; title, goal, state (active, paused, done), links: [every node that belongs to it];
//                        below: "## Next" with your steps as "- [ ] …" lines, and "## Notes" with free text
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
  };
}

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
  const before = asList(parseNode(text, path).meta.links);
  return before.includes(slug) ? setLinks(text, before.filter((s) => s !== slug)) : null;
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
