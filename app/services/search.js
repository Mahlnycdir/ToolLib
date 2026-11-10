// Search over the knowledge on this device with MiniSearch: tolerant of typos, matches word beginnings,
// and finds English and German names alike (title, title_de and aliases are all indexed).
// The index lives in memory; it is rebuilt at start and after every sync, which takes well under a second.
import { MiniSearch } from '../../vendor/search.js';
import { getNode, loadAllNodes, summary } from './nodes.js';

// Lower case, without accents, ß as ss: "Zählschleife" and "zahlschleife" become the same word.
export const normalize = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

// You usually search for a problem in your own words ("wie kann ich eine Simulation animieren"). Filler words
// are left out, and a light stem makes "animieren", "Animation" and "animate" the same word. Python keywords
// such as if, for, in, with, and, or, not stay searchable.
const STOP = new Set([
  'how', 'do', 'does', 'i', 'can', 'a', 'an', 'the', 'to', 'of', 'my', 'me', 'want', 'should', 'would', 'some',
  'wie', 'kann', 'ich', 'man', 'mein', 'meine', 'meinen', 'meinem', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'der', 'die', 'das', 'den', 'dem', 'des', 'und', 'zu', 'zum', 'zur', 'von', 'auf', 'im', 'soll', 'will', 'mochte', 'mochten', 'ob',
  'als', 'fur', 'mit', 'aus', 'bei', 'nach', 'uber',
]);
const SUFFIXES = ['ationen', 'ations', 'ierungen', 'ierung', 'ieren', 'ation', 'ating', 'ated', 'ates', 'ate'];
export function stem(word) {
  for (const s of SUFFIXES) if (word.length - s.length >= 4 && word.endsWith(s)) return word.slice(0, -s.length);
  return word;
}
const processTerm = (term) => {
  const w = normalize(term);
  return STOP.has(w) ? null : stem(w);
};
const words = (s) => (String(s).match(/[\p{L}\p{N}_]+/gu) || []).map(processTerm).filter(Boolean);

const FIELDS = ['title', 'title_de', 'problems', 'problems_de', 'aliases', 'tags', 'slug', 'text'];
const BOOST = { title: 4, title_de: 4, problems: 3, problems_de: 3, aliases: 3, tags: 2, slug: 2, text: 1 };

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
        processTerm,
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
  // A node with one problem phrase that covers the whole question beats a node that has the words scattered
  // over several phrases: "Fehlerbalken für Monte-Carlo-Daten" finds the jackknife before the errorbar plot.
  const q = words(query);
  if (q.length >= 2) {
    hits = hits.map((r) => ({ ...r, score: r.score * (1 + 3 * matchProblem(byPath.get(r.id), q).coverage ** 2) }))
      .sort((a, b) => b.score - a.score);
  }
  return hits.slice(0, limit).map((r) => byPath.get(r.id)).filter(Boolean);
}

// After a node changed on this device (e.g. marked as verified): update just this one entry.
// Quiet on purpose: views that show the node update themselves, the rest reads the new state when drawn.
export async function refreshNode(path) {
  const node = await getNode(path);
  if (!node) { forgetNode(path); return null; }   // deleted on this device or in another window
  if (!mini) return summary(node);
  const d = summary(node);
  if (mini.has(path)) mini.replace(d);
  else mini.add(d);
  byPath.set(path, d);
  if (!d.conflict) bySlug.set(d.slug, d);
  state.count = byPath.size;
  return d;
}

// After a node was deleted on this device: take it out of the index.
export function forgetNode(path) {
  if (mini?.has(path)) mini.discard(path);
  const d = byPath.get(path);
  byPath.delete(path);
  if (d && bySlug.get(d.slug)?.path === path) bySlug.delete(d.slug);
  state.count = byPath.size;
}

// The problem phrase of a node that shares the most words with the query; coverage = share of the query's words.
function matchProblem(d, q, lang = 'en') {
  let phrase = '';
  let hits = 0;
  if (!d) return { phrase, coverage: 0 };
  for (const list of lang === 'de' ? [d.problems_de, d.problems] : [d.problems, d.problems_de]) {
    for (const p of list || []) {
      const pw = words(p);
      const n = q.filter((t) => pw.some((w) => w.startsWith(t) || (w.length >= 4 && t.startsWith(w)))).length;
      if (n > hits) { phrase = p; hits = n; }   // phrases in the chosen language win a tie
    }
  }
  return { phrase, coverage: q.length ? hits / q.length : 0 };
}

// The problem a hit solves, for the hit list: only for questions of two or more words, and only if the phrase
// covers at least half of them. A single word ("plot") keeps the first sentence of the node.
export function bestProblem(d, query, lang = 'en') {
  const q = words(query);
  if (q.length < 2) return '';
  const m = matchProblem(d, q, lang);
  return m.coverage >= 0.5 ? m.phrase : '';
}

export const nodeByPath = (path) => byPath.get(path) || null;
export const nodeBySlug = (slug) => bySlug.get(slug) || null;
export const allNodes = () => [...byPath.values()];
