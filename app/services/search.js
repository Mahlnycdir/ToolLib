// Search over the knowledge on this device with MiniSearch: tolerant of typos, matches word beginnings,
// and finds English and German names alike (title, title_de and aliases are all indexed).
// The index lives in memory; it is rebuilt at start and after every sync, which takes well under a second.
import { MiniSearch } from '../../vendor/search.js';
import { getNode, loadAllNodes, summary } from './nodes.js';

// Lower case, without accents, ß as ss: "Zählschleife" and "zahlschleife" become the same word.
export const normalize = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

const FIELDS = ['title', 'title_de', 'aliases', 'tags', 'slug', 'text'];
const BOOST = { title: 4, title_de: 4, aliases: 3, tags: 2, slug: 2, text: 1 };

let mini = null;
let byPath = new Map();
let bySlug = new Map();
const state = { ready: false, building: false, count: 0, hasKnowledge: null };
const listeners = new Set();

export const indexState = () => ({ ...state });
export function onIndexChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => { for (const fn of listeners) fn(indexState()); };

let building = null;
export function buildIndex() {
  if (building) return building.then(() => buildIndex()); // a newer state of the files: build again afterwards
  building = (async () => {
    state.building = true;
    emit();
    try {
      const nodes = await loadAllNodes();
      const next = new MiniSearch({
        idField: 'path',
        fields: FIELDS,
        storeFields: ['path'],
        processTerm: (term) => normalize(term),
        extractField: (doc, field) => (Array.isArray(doc[field]) ? doc[field].join(' ') : doc[field]),
      });
      const docs = (nodes || []).map(summary);
      next.addAll(docs);
      mini = next;
      byPath = new Map(docs.map((d) => [d.path, d]));
      bySlug = new Map(docs.filter((d) => !d.conflict).map((d) => [d.slug, d]));
      state.count = docs.length;
      state.hasKnowledge = nodes !== null;
      state.ready = true;
    } catch (e) {
      console.warn('Index failed', e);
    } finally {
      state.building = false;
      building = null;
      emit();
    }
  })();
  return building;
}

// Hits as summaries (path, type, title, title_de, group, code, …), best first.
export function searchNodes(query, { limit = 8, filter } = {}) {
  if (!mini || !String(query).trim()) return [];
  const opts = {
    boost: BOOST,
    prefix: true,
    fuzzy: (term) => (term.length > 3 ? 0.2 : false),
    filter: filter ? (r) => filter(byPath.get(r.id)) : undefined,
  };
  let hits = mini.search(query, { ...opts, combineWith: 'AND' });
  if (!hits.length) hits = mini.search(query, { ...opts, combineWith: 'OR' });
  return hits.slice(0, limit).map((r) => byPath.get(r.id)).filter(Boolean);
}

// After a node changed on this device (e.g. marked as verified): update just this one entry.
// Quiet on purpose: views that show the node update themselves, the rest reads the new state when drawn.
export async function refreshNode(path) {
  const node = await getNode(path);
  if (!node || !mini) return node ? summary(node) : null;
  const d = summary(node);
  if (mini.has(path)) mini.replace(d);
  else mini.add(d);
  byPath.set(path, d);
  if (!d.conflict) bySlug.set(d.slug, d);
  state.count = byPath.size;
  return d;
}

export const nodeByPath = (path) => byPath.get(path) || null;
export const nodeBySlug = (slug) => bySlug.get(slug) || null;
export const allNodes = () => [...byPath.values()];
