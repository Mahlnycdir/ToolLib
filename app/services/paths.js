// Paths (0.30.0, Etappe 5 "Problem zuerst"). ENTE: even on a bad day you should be able to start a project; who looks
// for a problem gets suggestions at once and a way step by step ("Wie schreibe ich eine Simulation?").
//
// A path is a node of its own kind (nodes/paths/<name>.md):
//   ---
//   type: path
//   title / title_de, problems / problems_de, themes: ["programming", "physics"], level, links (snippets it uses)
//   steps:
//     - {"id": "euler", "en": "One Euler step", "de": "Ein Euler-Schritt", "min": 15, "example": "ode-euler"}
//   ---
//   ::: en / ::: de   what the path is for
//   ## Step euler      per step: the text in both languages (with "### Hint" inside), and for a code step a block
//                      ```python starter``` (what you begin with in Kobra) and ```python check``` (runs against your
//                      code: your functions are there, like built-ins; it passes when nothing fails)
// A step without a check is a practical one (solder, print, measure): you tick it yourself.
//
// How far you are: on this device (path.progress) and, once you began a project from the path, in the project's
// steps with their lights (the project file names the path in "from_path"). The project wins where it has a step.
//
// For Python readers: plain functions over dicts, like a small module of helpers; nothing here draws anything.
import { allNodes, bestProblem, nodeBySlug, searchNodes } from './search.js';
import { getNode, localize, pathStepsOf, titleOf } from './nodes.js';
import { partText } from './md-parts.js';
import { loadPref, savePref } from './prefs.js';
import { createProject, focusPath, focusProject, projects, setFocus, setStepStatus } from './projects.js';
import { trail } from './trail.js';

// ------------------------------------------------------------------ themes (ENTE's interests, 14.11.)
// The order is the one ENTE named them in. Their names are in strings.json (theme.<id>, theme.<id>.hint).
export const THEMES = [
  { id: 'craft', icon: 'hammer' },
  { id: 'electronics', icon: 'bolt' },
  { id: 'analog', icon: 'wave' },
  { id: 'circuits', icon: 'circuit' },
  { id: 'math', icon: 'vars' },
  { id: 'physics', icon: 'atom' },
  { id: 'printing', icon: 'cube' },
  { id: 'programming', icon: 'code' },
];
export const themeById = (id) => THEMES.find((x) => x.id === id) || null;
export const isTheme = (id) => !!themeById(id);

// ------------------------------------------------------------------ reading a path
const STEP_FENCE = /^```python[ \t]+(starter|check)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;
const lang2 = (lang) => (lang === 'de' ? 'de' : 'en');
export const stepTitle = (s, lang) => (lang2(lang) === 'de' ? s.de || s.en : s.en || s.de);
export const pathTitle = (d, lang) => titleOf(d, lang2(lang), d.slug || '');

// The whole path, with the text of every step in one language:
//   { path, slug, title, intro, goal, themes, level, links, sources, kobra, steps: [{ id, title, min, example,
//     text, hint, starter, check, kind: 'code' | 'do', file }] }
export async function loadPath(path, lang) {
  const node = await getNode(path);
  if (!node || node.error || node.meta.type !== 'path') return null;
  return parsePath(node, lang);
}
export function parsePath(node, lang) {
  const m = node.meta;
  const l = lang2(lang);
  const intro = localize(node.body.split(/^## /m)[0] || '', l).trim();
  const steps = pathStepsOf(m.steps).map((s, i) => {
    const raw = partText(node.body, `Step ${s.id}`);
    let starter = '';
    let check = '';
    const rest = raw.replace(STEP_FENCE, (all, which, code) => { if (which === 'starter') starter = code.replace(/\s+$/, '\n'); else check = code.replace(/\s+$/, '\n'); return ''; });
    const text = localize(rest, l);
    const [main, hint = ''] = text.split(/^###\s+(?:Hint|Hinweis)\s*$/m);
    return {
      id: s.id, title: stepTitle(s, l), min: s.min, example: s.example,
      text: main.trim(), hint: hint.trim(), starter, check, kind: check ? 'code' : 'do',
      file: `${String(i + 1).padStart(2, '0')}_${s.id.replace(/-/g, '_')}.py`,
    };
  });
  const goal = String((l === 'de' && m.goal_de) || m.goal || m.goal_de || '').trim();
  return {
    path: node.path, slug: node.slug, title: titleOf(m, l, node.slug), intro, goal,
    themes: (Array.isArray(m.themes) ? m.themes : []).map(String).filter(isTheme),
    level: String(m.level || ''), links: (Array.isArray(m.links) ? m.links : []).map(String),
    kobra: kobraName(node.slug), steps, meta: m,
  };
}
// The Kobra project the tasks of a path go into: "pfad-<name>" (only letters, digits and dashes).
export const kobraName = (slug) => `pfad-${String(slug).replace(/[^a-z0-9-]/g, '').slice(0, 50) || 'x'}`;

// ------------------------------------------------------------------ how far you are
const PROGRESS = 'path.progress';
const progressMap = () => { const v = loadPref(PROGRESS, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
export const doneHere = (slug) => new Set(Array.isArray(progressMap()[slug]?.done) ? progressMap()[slug].done.map(String) : []);
export const touchedAt = (slug) => Number(progressMap()[slug]?.at) || 0;
export function markHere(slug, id, done = true) {
  const all = progressMap();
  const had = new Set(Array.isArray(all[slug]?.done) ? all[slug].done.map(String) : []);
  if (done) had.add(id); else had.delete(id);
  delete all[slug];
  all[slug] = { done: [...had], at: Date.now() };
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - 100))) delete all[k];
  savePref(PROGRESS, all);
}
// you opened a path (it goes to the front of "in progress")
export function touchPath(slug) {
  const all = progressMap();
  const was = all[slug] || { done: [] };
  delete all[slug];
  all[slug] = { done: Array.isArray(was.done) ? was.done : [], at: Date.now() };
  savePref(PROGRESS, all);
}

// The projects begun from a path; the one in focus first, then the active ones.
export const projectsOfPath = (slug) => projects().filter((p) => p.fromPath === slug);
export function projectOfPath(slug) {
  const list = projectsOfPath(slug);
  return list.find((p) => p.path === focusPath()) || list.find((p) => p.state === 'active') || list[0] || null;
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
// The state of every step: [{ id, status ('open' | 'next' | 'wait' | 'done'), projectIndex }]. A step of the project
// is found by its text (in either language), so you can move steps there or add your own in between.
// d: the summary of the path (pathSteps) or a loaded path (steps with en/de missing: then by id only).
export function stepStates(d, project = projectOfPath(d.slug)) {
  const list = project?.steps?.list || [];
  const here = doneHere(d.slug);
  const steps = d.pathSteps || pathStepsOf(d.meta?.steps);
  return steps.map((s) => {
    const i = list.findIndex((x) => norm(x.text) === norm(s.en) || norm(x.text) === norm(s.de));
    return { id: s.id, status: i >= 0 ? list[i].status : here.has(s.id) ? 'done' : 'open', projectIndex: i };
  });
}
export const nextStepOf = (states) => states.find((x) => x.status === 'next') || states.find((x) => x.status === 'open') || null;
export const doneCount = (states) => states.filter((x) => x.status === 'done').length;

// A step is done (its check passed, or you ticked it) or open again. With a project the step's light changes there,
// and the next open step turns red.
export async function markStep(d, id, done = true) {
  markHere(d.slug, id, done);
  const project = projectOfPath(d.slug);
  if (!project) return null;
  const states = stepStates(d, project);
  const me = states.find((x) => x.id === id);
  if (me && me.projectIndex >= 0 && (me.status === 'done') !== done) await setStepStatus(project.path, me.projectIndex, done ? 'done' : 'open');
  if (done && !states.some((x) => x.status === 'next' && x.id !== id)) {
    const next = states.find((x) => x.id !== id && x.status === 'open' && x.projectIndex >= 0);
    if (next) await setStepStatus(project.path, next.projectIndex, 'next');
  }
  return project;
}

// "Als Projekt beginnen" (ENTE: "im Pfad das Projekt starten"): a project named like the path, its goal, the steps
// as next steps with lights (what you did here already green, the first open one red), the path and the snippets it
// uses as members. It goes into focus. Returns its file path.
export async function startProject(d, lang) {
  const l = lang2(lang);
  const here = doneHere(d.slug);
  const steps = pathStepsOf(d.meta.steps);
  const first = steps.findIndex((s) => !here.has(s.id));
  const path = await createProject({
    title: d.title,
    goal: d.goal,
    steps: steps.map((s, i) => ({ text: stepTitle(s, l), status: here.has(s.id) ? 'done' : i === first ? 'next' : 'open' })),
    links: [d.slug, ...d.links, ...steps.map((s) => s.example).filter(Boolean)],
    fromPath: d.slug,
  });
  setFocus(path);
  return path;
}

// ------------------------------------------------------------------ suggestions
// What helps with a problem, from your own knowledge: paths first (they lead you through), then recipes, snippets and
// cards, then your projects. [{ node, kind: 'path' | 'help' | 'project', problem }]
const HELP = new Set(['recipe', 'snippet', 'formula', 'definition', 'theorem', 'term', 'convention', 'topic', 'rule']);
export function suggest(query, { lang = 'en', limit = 8, skip = new Set() } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const seen = new Set(skip);
  const out = [];
  const add = (d, kind) => { if (!d || d.conflict || seen.has(d.path)) return; seen.add(d.path); out.push({ node: d, kind, problem: bestProblem(d, q, lang2(lang)) }); };
  const hits = searchNodes(q, { limit: 16 });
  // a path counts when one of its problems fits or it is among the best hits anyway (not for a stray word)
  const top = new Set(hits.slice(0, 8).map((d) => d.path));
  for (const d of searchNodes(q, { limit: 4, filter: (x) => x.type === 'path' })) if (bestProblem(d, q, lang2(lang)) || top.has(d.path)) add(d, 'path');
  for (const d of hits) if (d.type === 'recipe') add(d, 'help');
  for (const d of hits) if (HELP.has(d.type)) add(d, 'help');
  for (const d of hits) if (d.type === 'project') add(d, 'project');
  return out.slice(0, limit);
}

// The paths that fit a project: its own path first (with where you stand), then what fits its next step and its goal.
// "Weiterkommen" in the project and in the research window (ENTE: "gerade wenn man im Research ist und nicht weiter
// weiß … problemspezifisch, zum Projekt, um weiterzukommen").
export function suggestForProject(p, { lang = 'en', query = '', limit = 6 } = {}) {
  if (!p) return [];
  const out = [];
  const skip = new Set(p.links.map((s) => nodeBySlug(s)?.path).filter(Boolean));
  const own = p.fromPath ? nodeBySlug(p.fromPath) : null;
  if (own && own.type === 'path') { out.push({ node: own, kind: 'own', problem: '' }); skip.add(own.path); }
  const asks = [query, p.steps?.next, p.goal, p.title].map((x) => String(x || '').trim()).filter((x) => x.length >= 3);
  for (const a of asks) {
    for (const x of suggest(a, { lang, limit, skip })) { if (!out.some((y) => y.node.path === x.node.path)) { out.push({ ...x, why: a }); skip.add(x.node.path); } }
    if (out.length >= limit) break;
  }
  return out.filter((x) => x.kind !== 'project').slice(0, limit);
}

// Paths of a theme, the ones you are on first.
export const pathsOf = (theme) => allNodes().filter((d) => d.type === 'path' && !d.conflict && (!theme || d.themes.includes(theme)))
  .sort((a, b) => touchedAt(b.slug) - touchedAt(a.slug) || a.title.localeCompare(b.title));

// Paths you are on: something done or opened, not finished. [{ node, states, next }]
export function pathsInProgress() {
  return pathsOf('').map((d) => ({ node: d, states: stepStates(d) })).filter((x) => (touchedAt(x.node.slug) || doneCount(x.states) || projectOfPath(x.node.slug)) && doneCount(x.states) < x.states.length)
    .map((x) => ({ ...x, next: nextStepOf(x.states) }));
}

// ------------------------------------------------------------------ one small step (a bad day)
// Exactly one small thing, about a quarter of an hour; "Anderer Vorschlag" takes the next one. In this order: the
// next step of the project in focus, the next step of a path you are on, the red steps of other projects, a work you
// began reading, a note waiting in the inbox, the first step of a path from your themes.
//   [{ kind: 'project' | 'path' | 'read' | 'inbox' | 'new', title, detail, min, node, step }]
export function smallSteps({ lang = 'en', themes = [], inbox = [], started = [] } = {}) {
  const out = [];
  const f = focusProject();
  const projectStep = (p) => { const s = (p.steps?.list || []).find((x) => x.status === 'next') || (p.steps?.list || []).find((x) => x.status === 'open'); return s ? { kind: 'project', title: s.text, detail: p.title, min: 15, node: p } : null; };
  if (f) { const s = projectStep(f); if (s) out.push(s); }
  for (const x of pathsInProgress()) {
    if (projectOfPath(x.node.slug)) continue;   // its project's red step stands for it already
    const step = x.node.pathSteps.find((y) => y.id === x.next?.id);
    if (step) out.push({ kind: 'path', title: stepTitle(step, lang), detail: pathTitle(x.node, lang), min: step.min || 15, node: x.node, step: step.id });
  }
  for (const p of projects().filter((x) => x.state === 'active' && x.path !== f?.path)) {
    const s = (p.steps?.list || []).find((x) => x.status === 'next');
    if (s) out.push({ kind: 'project', title: s.text, detail: p.title, min: 15, node: p });
  }
  for (const w of started.slice(0, 2)) out.push({ kind: 'read', title: w.title, detail: '', min: 15, node: w });
  if (inbox.length) out.push({ kind: 'inbox', title: '', detail: '', min: 5, count: inbox.length, node: inbox[0] });
  const mine = new Set(themes);
  const fresh = pathsOf('').filter((d) => !touchedAt(d.slug) && !projectOfPath(d.slug) && (!mine.size || d.themes.some((t) => mine.has(t))));
  for (const d of fresh.slice(0, 3)) { const s = d.pathSteps[0]; if (s) out.push({ kind: 'new', title: stepTitle(s, lang), detail: pathTitle(d, lang), min: s.min || 15, node: d, step: s.id }); }
  return out;
}

// what you opened lately among paths (for Start's "Ideen" when no theme is chosen)
export const recentPaths = () => trail().filter((e) => e.kind === 'node').map((e) => allNodes().find((d) => d.path === e.path && d.type === 'path')).filter(Boolean);
