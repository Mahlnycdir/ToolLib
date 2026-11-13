// Relations (0.25.0): the one place that knows how the knowledge hangs together.
//
// Every node already says what it points to: `links:` in its head and [[name]] in its text, a formula card its
// `derived_from` ("follows from") and its `conventions`, a page its sources [@name], a project its cards. Until
// 0.24 each view looked that up by itself. Now this file collects it once into a graph (nodes and edges) and every
// view asks here: the context panel beside a node, later the network view, the board's threads and the widgets.
//
// Reading guide for Python people:
//   - `export function f()` is a function other files may import, like a public def in a module.
//   - `const x = …` is a name that is not reassigned; `let` one that is.
//   - `new Map()` is a dict, `new Set()` a set; `for (const x of list)` is `for x in list`.
//   - `async function` / `await` work like asyncio: the function waits for a file without blocking the page.
//   - `(d) => d.slug` is a lambda.
//
// Live: the search index calls onNodesChange whenever a node is saved here, deleted, or a sync brought new files.
// Then the cached graph is thrown away and everyone who called onRelationsChange draws again, a moment later and
// only once for many changes in a row.
import { allNodes, nodeBySlug, onNodesChange, refreshNode } from './search.js';
import { parseNode, readNodeText, setField, writeNode, yamlValue } from './nodes.js';
import { noteChange } from './sync.js';
import { announce } from './channel.js';

// The kinds of relation, from the point of view of the node that holds it ("from"):
//   link       from names to in `links:` or [[to]]
//   derived    from follows from to (formula cards, `derived_from`)
//   convention from is written in the convention to (`conventions`)
//   member     from is a project and holds to
//   cite       from (a page or note) cites the source to with [@to]
//   page       from is a page of the library to
export const KINDS = ['link', 'derived', 'convention', 'member', 'cite', 'page'];

// ------------------------------------------------------------------ the graph, built on demand and kept
let cache = null;           // { nodes: Map slug → summary, out: Map slug → [edge], in: Map slug → [edge], missing: Map slug → Set }
const listeners = new Set();
let timer = null;

// Nodes that take part: everything with a slug, except conflict copies (they are the same node twice).
const usable = (d) => d && !d.conflict && !d.error;

function build() {
  const nodes = new Map();
  for (const d of allNodes()) if (usable(d)) nodes.set(d.slug, d);
  const out = new Map();
  const inn = new Map();   // "in" is a word of the language, hence the second n
  const missing = new Map();
  const seen = new Set();
  const add = (from, to, kind) => {
    if (!to || to === from) return;
    if (!nodes.has(to)) {   // a link into the void: remembered, shown as such, not drawn
      if (!missing.has(from)) missing.set(from, new Set());
      missing.get(from).add(to);
      return;
    }
    const key = `${from}>${to}>${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    const e = { from, to, kind };
    if (!out.has(from)) out.set(from, []);
    if (!inn.has(to)) inn.set(to, []);
    out.get(from).push(e);
    inn.get(to).push(e);
  };
  for (const d of nodes.values()) {
    const special = new Set([...(d.derived || []), ...(d.conventions || [])]);
    for (const s of d.derived || []) add(d.slug, s, 'derived');
    for (const s of d.conventions || []) add(d.slug, s, 'convention');
    for (const s of d.cites || []) add(d.slug, s, 'cite');
    if (d.type === 'page' && d.library) add(d.slug, d.library, 'page');
    // a plain link is not counted twice when it is already a "follows from" or a convention
    for (const s of d.links || []) if (!special.has(s)) add(d.slug, s, d.type === 'project' ? 'member' : 'link');
  }
  return { nodes, out, in: inn, missing };
}

export function graph() {
  if (!cache) cache = build();
  return cache;
}

// Called by the index: drop the graph, tell the listeners once after a short calm (many saves → one redraw).
onNodesChange(() => {
  cache = null;
  clearTimeout(timer);
  timer = setTimeout(() => { for (const fn of listeners) { try { fn(); } catch (e) { console.warn('onRelationsChange', e); } } }, 60);
});

// fn() runs after every change of the relations. Returns a function that stops listening (call it when the view
// goes away, as main.cleanup does in shell.js).
export function onRelationsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ------------------------------------------------------------------ asking
const byTitle = (a, b) => String(a.d.title).localeCompare(String(b.d.title));

// Everything around one node, sorted for showing:
//   out:      [{ d, kind }]  what this node points to
//   in:       [{ d, kind }]  what points to it (projects apart)
//   projects: [summary]      the projects that hold it
//   missing:  [slug]         names it points to that are not in the knowledge (yet)
export function relationsOf(slug) {
  const g = graph();
  const out = (g.out.get(slug) || []).map((e) => ({ d: g.nodes.get(e.to), kind: e.kind })).sort(byTitle);
  const all = (g.in.get(slug) || []).map((e) => ({ d: g.nodes.get(e.from), kind: e.kind }));
  return {
    out,
    in: all.filter((x) => x.kind !== 'member').sort(byTitle),
    projects: all.filter((x) => x.kind === 'member').map((x) => x.d).sort((a, b) => a.title.localeCompare(b.title)),
    missing: [...(g.missing.get(slug) || [])].sort(),
  };
}

// How many relations a node has, in both directions (the size of its dot in the network).
export function degree(slug) {
  const g = graph();
  return (g.out.get(slug)?.length || 0) + (g.in.get(slug)?.length || 0);
}

// The neighbourhood of a node up to `depth` steps, in both directions: { nodes: Map slug → steps away, edges }.
// kinds: only these kinds of relation; max: stop after so many nodes (the nearest come first, breadth first).
export function neighbourhood(slug, { depth = 1, kinds = KINDS, max = 300 } = {}) {
  const g = graph();
  const allowed = new Set(kinds);
  const dist = new Map([[slug, 0]]);
  let ring = [slug];
  for (let step = 1; step <= depth && ring.length && dist.size < max; step++) {
    const next = [];
    for (const s of ring) {
      for (const e of [...(g.out.get(s) || []), ...(g.in.get(s) || [])]) {
        if (!allowed.has(e.kind)) continue;
        const other = e.from === s ? e.to : e.from;
        if (dist.has(other) || dist.size >= max) continue;
        dist.set(other, step);
        next.push(other);
      }
    }
    ring = next;
  }
  const edges = [];
  for (const s of dist.keys()) for (const e of g.out.get(s) || []) if (allowed.has(e.kind) && dist.has(e.to)) edges.push(e);
  return { nodes: dist, edges };
}

// ------------------------------------------------------------------ changing
// The relations you draw yourself live in `links:` of the node they start from: one line in its head changes, so
// Git shows a one-line difference, the sync combines it with other devices and every project sees it.
const LINKS_AFTER = ['derived_from', 'conventions', 'tags', 'problems_de', 'problems', 'group', 'title_de', 'title'];

async function saveLinks(d, change) {
  const text = await readNodeText(d.path);
  const meta = parseNode(text, d.path).meta;
  const before = (Array.isArray(meta.links) ? meta.links : meta.links ? [meta.links] : []).map(String);
  const after = change(before);
  if (!after || (after.length === before.length && after.every((x, i) => x === before[i]))) return false;
  await writeNode(d.path, setField(text, 'links', yamlValue(after), LINKS_AFTER));
  await refreshNode(d.path);           // the index, and with it every view through onRelationsChange
  await noteChange(d.path, 'edited');  // the sync takes it along
  announce([d.path]);                  // other Toollib windows
  return true;
}

// Draws a relation from → to (both slugs). Returns true when something changed, false when it was there already.
export async function connect(from, to) {
  const d = nodeBySlug(from);
  if (!usable(d) || !nodeBySlug(to) || from === to) return false;
  return saveLinks(d, (list) => (list.includes(to) ? null : [...list, to]));
}

// Takes a drawn relation away. Only what stands in `links:` can go here; a [[name]] in the text stays where it is
// (the answer is then 'text', so the view can say so), a "follows from" belongs to the card ('card').
export async function disconnect(from, to) {
  const d = nodeBySlug(from);
  if (!usable(d)) return false;
  const text = await readNodeText(d.path);
  const meta = parseNode(text, d.path).meta;
  const inField = (Array.isArray(meta.links) ? meta.links : meta.links ? [meta.links] : []).map(String).includes(to);
  if (!inField) return (d.derived || []).includes(to) || (d.conventions || []).includes(to) ? 'card' : 'text';
  return saveLinks(d, (list) => list.filter((s) => s !== to));
}

// Whether `from` names `to` only in its head (and so can let go of it here).
export function isDrawn(from, to) {
  const d = nodeBySlug(from);
  return !!d && (d.drawn || []).includes(to);
}

// For tests and the developer console: the whole graph as plain lists.
export function dump() {
  const g = graph();
  return { nodes: [...g.nodes.keys()], edges: [...g.out.values()].flat(), missing: Object.fromEntries([...g.missing].map(([k, v]) => [k, [...v]])) };
}
