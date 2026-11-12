// Search over the knowledge on this device with MiniSearch: tolerant of typos, matches word beginnings,
// and finds English and German names alike (title, title_de and aliases are all indexed).
// The index lives in memory; it is rebuilt at start and after every sync, which takes well under a second.
// 0.19.0: also under other names. Names in code are split (curve_fit, FuncAnimation, np.linspace) and joined
// (curvefit); every word of a question also searches its synonyms (synonyms.js), a little lower; a word that is
// nowhere is corrected to the nearest name (swapped letters too); and what you open after a search is learned,
// so your own words lead to the same node next time (on this device and in the settings file).
import { MiniSearch } from '../../vendor/search.js';
import { getNode, loadAllNodes, summary } from './nodes.js';
import { SYNONYMS } from './synonyms.js';
import { loadPref, savePref } from './prefs.js';

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

// Names in code: "curve_fit", "np.linspace" and "FuncAnimation" are found by their parts; the index also keeps
// them joined ("curvefit"), for a search typed without the separator.
const CHUNK = /[\p{L}\p{N}_.]+/gu;
const camel = (w) => w.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2').split(' ');
function partsOf(chunk) {
  return chunk.split(/[_.]+/).flatMap(camel).filter(Boolean);
}
export function indexTokenize(text) {
  const out = [];
  for (const chunk of String(text).match(CHUNK) || []) {
    const parts = partsOf(chunk);
    out.push(...parts);
    if (parts.length > 1 && parts.length <= 4 && chunk.length <= 40) out.push(parts.join(''));
  }
  return out;
}
export const searchTokenize = (text) => (String(text).match(CHUNK) || []).flatMap(partsOf);
const words = (s) => searchTokenize(s).map(processTerm).filter(Boolean);

const FIELDS = ['title', 'title_de', 'problems', 'problems_de', 'aliases', 'tags', 'slug', 'group', 'language', 'text'];
const BOOST = { title: 4, title_de: 4, problems: 3, problems_de: 3, aliases: 3, tags: 2, slug: 2, group: 1, language: 1, text: 1 };
const SYN_BOOST = Object.fromEntries(Object.entries(BOOST).map(([k, v]) => [k, v * 0.6]));   // a synonym counts a little less

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
        tokenize: indexTokenize,
        searchOptions: { tokenize: searchTokenize, processTerm },
        extractField: (doc, field) => (Array.isArray(doc[field]) ? doc[field].join(' ') : doc[field]),
      });
      const docs = (nodes || []).map(summary);
      next.addAll(docs);
      names = new Map(SYN_NAMES);
      for (const d of docs) addNames(d);
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

// ------------------------------------------------------------------ other names (0.19.0)
// Every entry of a synonym group under its normalized key ("curve fit", "kleinste quadrat"); one-word keys also in
// a list, for German endings ("fittest" → "fitten").
const SYN_KEYS = new Map();
const SYN_ONE = [];
SYNONYMS.forEach((group, gi) => {
  for (const text of group) {
    const key = words(text).join(' ');
    if (!key) continue;
    if (!SYN_KEYS.has(key)) SYN_KEYS.set(key, new Set());
    SYN_KEYS.get(key).add(gi);
    if (!key.includes(' ')) SYN_ONE.push(key);
  }
});
const SYN_LONGEST = Math.max(1, ...[...SYN_KEYS.keys()].map((k) => k.split(' ').length));
// the names a word can be corrected to: words of titles, aliases, problems, tags and the synonyms, with a count
const SYN_NAMES = new Map();
for (const key of SYN_KEYS.keys()) for (const w of key.split(' ')) SYN_NAMES.set(w, (SYN_NAMES.get(w) || 0) + 1);
let names = new Map(SYN_NAMES);
function addNames(d) {
  for (const f of ['title', 'title_de', 'aliases', 'problems', 'problems_de', 'tags', 'group', 'slug']) {
    const v = Array.isArray(d[f]) ? d[f].join(' ') : d[f];
    if (v) for (const w of words(v)) if (w.length >= 3) names.set(w, (names.get(w) || 0) + 1);
  }
}

function groupsOf(key) {
  const exact = SYN_KEYS.get(key);
  if (exact) return exact;
  if (key.includes(' ') || key.length < 5) return null;
  // German and English endings: "fittest", "plottet", "animiert" find the group of "fitten", "plotten", "animieren"
  const out = new Set();
  for (const k of SYN_ONE) {
    const n = Math.min(k.length, key.length);
    if (n >= 5 && Math.abs(k.length - key.length) <= 3 && k.slice(0, n - 1) === key.slice(0, n - 1)) for (const g of SYN_KEYS.get(k)) out.add(g);
  }
  return out.size ? out : null;
}

// The query in units: phrases known as one name ("kleinste quadrate", "pull request") stay together, the other
// words stand alone. Each unit carries the other names of its groups.
function unitsOf(query) {
  const raw = searchTokenize(query).map((w) => ({ w, k: processTerm(w) })).filter((x) => x.k);
  const units = [];
  for (let i = 0; i < raw.length;) {
    let took = 0;
    for (let n = Math.min(SYN_LONGEST, raw.length - i); n >= 2 && !took; n--) {
      const key = raw.slice(i, i + n).map((x) => x.k).join(' ');
      if (SYN_KEYS.has(key)) { units.push(unit(raw.slice(i, i + n).map((x) => x.w).join(' '), key)); took = n; }
    }
    if (!took) { units.push(unit(raw[i].w, raw[i].k)); took = 1; }
    i += took;
  }
  return units;
}
function unit(text, key) {
  const syn = [];
  for (const g of groupsOf(key) || []) for (const e of SYNONYMS[g]) if (words(e).join(' ') !== key && !syn.includes(e)) syn.push(e);
  return { text, key, syn: syn.slice(0, 48) };
}

// Damerau–Levenshtein (adjacent letters swapped count once), stopping early above `max`.
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      best = Math.min(best, d[i][j]);
    }
    if (best > max) return max + 1;
  }
  return d[a.length][b.length];
}
// A word that is nowhere in the knowledge (not even as a word beginning) and is no known name: the nearest name.
function correct(u) {
  if (u.key.includes(' ') || u.key.length < 3 || SYN_KEYS.has(u.key) || names.has(u.key)) return null;
  if (mini.search(u.key, { prefix: true, fuzzy: false, combineWith: 'AND' }).length) return null;
  const max = u.key.length <= 4 ? 1 : u.key.length <= 8 ? 2 : 3;
  let best = null;
  for (const [w, n] of names) {
    if (Math.abs(w.length - u.key.length) > max || w[0] !== u.key[0] && w[1] !== u.key[1]) continue;
    const dist = distance(u.key, w, max);
    if (dist <= max && (!best || dist < best.dist || (dist === best.dist && n > best.n))) best = { w, dist, n };
  }
  return best ? best.w : null;
}

// ------------------------------------------------------------------ what you open after a search (0.19.0)
// "Ausgleichsgerade" → you open curve_fit → next time "Ausgleichsgerade" puts curve_fit first. Kept as
// { "<the query's words>": { "<slug>": times } }, at most 250 queries with 5 nodes each, the newest last (it
// travels in the settings file, which has room for 60 000 characters per setting).
const LEARNED = 'search.learned';
const learnKey = (query) => [...new Set(words(query))].sort().join(' ').slice(0, 80);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function learnedAll() {
  const raw = loadPref(LEARNED, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}
export function rememberPick(query, slug) {
  const key = learnKey(query);
  if (!key || !/^[a-z0-9][a-z0-9-]{0,120}$/.test(String(slug))) return;
  const all = learnedAll();
  const entry = own(all, key) && all[key] && typeof all[key] === 'object' ? { ...all[key] } : {};
  entry[slug] = Math.min((entry[slug] || 0) + 1, 99);
  for (const k of Object.keys(entry).sort((x, y) => entry[x] - entry[y]).slice(0, Math.max(0, Object.keys(entry).length - 5))) if (k !== slug) delete entry[k];
  delete all[key];
  all[key] = entry;
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - 250))) delete all[k];
  savePref(LEARNED, all);
}
export function forgetPicks() { savePref(LEARNED, {}); }
function learnedFor(query) {
  const all = learnedAll();
  const key = learnKey(query);
  const e = key && own(all, key) ? all[key] : null;
  return e && typeof e === 'object' ? Object.fromEntries(Object.entries(e).filter(([k, n]) => typeof n === 'number' && /^[a-z0-9][a-z0-9-]*$/.test(k))) : null;
}

// ------------------------------------------------------------------ searching
// Hits as summaries (path, type, title, title_de, group, code, …), best first.
export function searchNodes(query, opts) { return searchDetailed(query, opts).hits; }

// Hits plus how they were found: { hits, note: { corrected: [{ from, to }], via: [names], learned } }.
export function searchDetailed(query, { limit = 8, filter } = {}) {
  const note = { corrected: [], via: [], learned: false };
  if (!mini || !String(query).trim()) return { hits: [], note };
  let units = unitsOf(query);
  for (const [i, u] of units.entries()) {
    const to = correct(u);
    if (to) { note.corrected.push({ from: u.text, to }); units[i] = unit(to, to); }
  }
  const opts = {
    boost: BOOST,
    prefix: true,
    fuzzy: (term) => (term.length > 3 ? 0.2 : false),
    filter: filter ? (r) => filter(byPath.get(r.id)) : undefined,
  };
  const own = (u) => ({ combineWith: 'AND', queries: [u.text] });
  const withSyn = (u) => (u.syn.length ? {
    combineWith: 'OR',
    queries: [own(u), { combineWith: 'OR', boost: SYN_BOOST, fuzzy: false, prefix: (t) => t.length >= 5, queries: u.syn.map((e) => (searchTokenize(e).length > 1 ? { combineWith: 'AND', queries: [e] } : e)) }],
  } : own(u));
  let hits = [];
  if (units.length) {
    hits = mini.search({ combineWith: 'AND', queries: units.map(withSyn) }, opts);
    if (!hits.length && units.length > 1) hits = mini.search({ combineWith: 'OR', queries: units.map(withSyn) }, opts);
    if (!hits.length) hits = mini.search({ combineWith: 'OR', queries: units.map(own) }, { ...opts, fuzzy: (term) => (term.length > 2 ? 0.34 : false) });
  }
  // A node with one problem phrase that covers the whole question beats a node that has the words scattered
  // over several phrases: "Fehlerbalken für Monte-Carlo-Daten" finds the jackknife before the errorbar plot.
  const fixed = note.corrected.length ? units.map((u) => u.text).join(' ') : query;
  const q = words(fixed);
  if (q.length >= 2) hits = hits.map((r) => ({ ...r, score: r.score * (1 + 3 * matchProblem(byPath.get(r.id), q).coverage ** 2) }));
  // The node that is called exactly what you typed (its title or one of its other names) comes first (0.19.0):
  // "Ausgleichsgerade" is a name of the straight-line fit, so that card beats curve_fit with all its synonyms.
  const asTyped = q.join(' ');
  if (asTyped && hits.length) {
    const top = Math.max(...hits.map((r) => r.score));
    hits = hits.map((r) => {
      const d = byPath.get(r.id);
      const named = d && [d.title, d.title_de, ...(d.aliases || [])].some((n) => n && words(n).join(' ') === asTyped);
      return named ? { ...r, score: top * 1.05 + r.score } : r;
    });
  }
  // what you opened before for the same words comes first
  const picked = learnedFor(query) || (note.corrected.length ? learnedFor(fixed) : null);
  if (picked) {
    const top = hits.reduce((m, r) => Math.max(m, r.score), 1);
    for (const [slug, n] of Object.entries(picked)) {
      const d = bySlug.get(slug);
      if (!d || (filter && !filter(d))) continue;
      const r = hits.find((x) => x.id === d.path);
      if (r) r.score = Math.max(r.score, top) * (1.5 + 0.1 * n);
      else hits.push({ id: d.path, score: top * (1.2 + 0.1 * n), queryTerms: [] });
      note.learned = true;
    }
  }
  hits.sort((a, b) => b.score - a.score);
  hits = hits.slice(0, limit);
  // the other names that found a hit whose words were not yours
  for (const r of hits) {
    const got = new Set(r.queryTerms || []);
    for (const u of units) {
      if (words(u.text).some((w) => got.has(w))) continue;
      for (const e of u.syn) if (note.via.length < 4 && !note.via.includes(e) && words(e).every((w) => got.has(w))) note.via.push(e);
    }
  }
  return { hits: hits.map((r) => byPath.get(r.id)).filter(Boolean), note };
}

// After a node changed on this device (e.g. marked as verified): update just this one entry.
// Quiet on purpose: views that show the node update themselves, the rest reads the new state when drawn.
export async function refreshNode(path) {
  const node = await getNode(path);
  if (!node) { forgetNode(path); return null; }   // deleted on this device or in another window
  if (!mini) return summary(node);
  const d = summary(node);
  addNames(d);
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
