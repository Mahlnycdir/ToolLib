// Learning a subject (0.15.1): papers alone rarely teach it. For one query this asks, side by side, for what gets
// you started: an overview (Wikipedia), introductions, lecture notes and reviews (OpenAlex), free books (OpenAlex,
// Open Library), courses and textbooks on the web (Wikibooks, Wikiversity), things to try (GitHub) and, with the Mac
// helper, tutorials on the web (SearXNG). Each part reports by itself; a part that fails is left out.
//   groups: overview, intro, books, courses, practice, web
//   an item: { title, url, content } (a page, shown like a hit on the web); a work: as in the paper search
// LEARN_SOURCES can be switched off one by one (setting learn.off); what you search for goes to those you leave on.
import { loadPref, savePref } from './prefs.js';
import { getLang } from '../i18n/i18n.js';
import { sourceById } from './research-sources.js';
import { mergeRecords, titleTokens } from './research-merge.js';
import { canWebSearch, getFor, helperReady, researchSettings, webSearch } from './research.js';

export const LEARN_GROUPS = ['overview', 'intro', 'books', 'courses', 'practice', 'web'];
export const LEARN_SOURCES = [
  { id: 'wikipedia', name: 'Wikipedia', groups: ['overview'] },
  { id: 'openalex', name: 'OpenAlex', groups: ['intro', 'books'] },
  { id: 'openlibrary', name: 'Open Library', groups: ['books'] },
  { id: 'wikibooks', name: 'Wikibooks', groups: ['courses'] },
  { id: 'github', name: 'GitHub', groups: ['practice'] },
  { id: 'web', name: 'SearXNG', groups: ['web'], helper: true },
];
export const learnOn = (id) => !loadPref('learn.off', []).includes(id);
export function setLearnOn(id, on) {
  const off = new Set(loadPref('learn.off', []));
  if (on) off.delete(id); else off.add(id);
  savePref('learn.off', [...off]);
}

const enc = encodeURIComponent;
// words that mark a text written to teach
export const TEACHES = /\b(introduction|introductory|intro|lecture notes?|lectures?|primer|tutorial|review|overview|pedagogical|beginners?|basics|fundamentals|course|textbook|handbook|guide|einf(ü|ue)hrung|grundlagen|skript|vorlesung(en)?|lehrbuch|(ü|ue)bersicht)\b/i;

async function getJson(url, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  signal?.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

// One of the wikis of Wikimedia: the best pages for a query with their first sentences.
async function wiki(host, q, limit, signal) {
  const data = await getJson(`https://${host}/w/api.php?action=query&generator=search&gsrsearch=${enc(q)}&gsrlimit=${limit}&prop=extracts%7Cinfo&exintro=1&explaintext=1&exsentences=3&exlimit=${limit}&inprop=url&format=json&origin=*`, signal);
  return Object.values(data?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((p) => ({ title: String(p.title || ''), url: String(p.fullurl || ''), content: String(p.extract || '').replace(/\s+/g, ' ').trim(), host }))
    .filter((p) => p.title && /^https:\/\//.test(p.url));
}

// How well a work teaches: its title says so, it is a book or a review, it is free, people cite it.
export function teachScore(w, queryWords) {
  let s = 0;
  if (TEACHES.test(w.title)) s += 3;
  if (w.type === 'book' || w.type === 'chapter') s += 1;
  if (w.free) s += 2;
  s += Math.min(2, Math.log10(1 + (w.cited || 0)) / 2);
  const tt = new Set(titleTokens(w.title));
  if (queryWords.length) s += 2 * (queryWords.filter((x) => tt.has(x)).length / queryWords.length);
  return s;
}

async function openalex(q, signal) {
  const src = sourceById('openalex');
  const settings = researchSettings();
  const key = settings.openalexKey ? `&api_key=${enc(settings.openalexKey)}` : '';
  const select = 'id,doi,title,display_name,publication_year,type,ids,open_access,best_oa_location,primary_location,locations,authorships,cited_by_count,abstract_inverted_index';
  const words = q.replace(/[,|:]/g, ' ').trim();
  const reqs = [
    `https://api.openalex.org/works?search=${enc(words)}&filter=type:review%7Cbook%7Cbook-chapter&per-page=15&select=${select}${key}`,
    `https://api.openalex.org/works?filter=title.search:${enc(words)},title.search:introduction%7Clectures%7Clecture%7Cprimer%7Ctutorial%7Cpedagogical%7Cbasics%7Ccourse&per-page=15&select=${select}${key}`,
  ];
  const records = [];
  let failed = 0;
  await Promise.all(reqs.map(async (url, i) => {
    try {
      const data = await getFor(src, { url, as: 'json' }, { settings, signal });
      records.push(...src.parse(data, {}).map((r) => ({ ...r, rank: r.rank + i * 5 })));
    } catch { failed++; }
  }));
  if (failed === reqs.length) throw new Error('OpenAlex');
  const qw = titleTokens(words);
  const works = mergeRecords(records).map((w) => ({ ...w, teach: teachScore(w, qw) })).sort((a, b) => b.teach - a.teach);
  const isBook = (w) => (w.type === 'book' || w.type === 'chapter') && !TEACHES.test(w.title);
  return { intro: works.filter((w) => !isBook(w)).slice(0, 10), books: works.filter(isBook).slice(0, 6) };
}

async function openLibrary(q, signal) {
  const data = await getJson(`https://openlibrary.org/search.json?q=${enc(q)}&has_fulltext=true&limit=12&fields=key,title,author_name,first_publish_year,ebook_access`, signal);
  return (data?.docs || []).filter((d) => d.ebook_access === 'public' || d.ebook_access === 'borrowable').slice(0, 5).map((d) => ({
    title: [d.title, d.author_name?.[0]].filter(Boolean).join(' · '), url: `https://openlibrary.org${d.key}`,
    content: [d.first_publish_year, d.ebook_access === 'public' ? 'Open Library: free to read' : 'Open Library: free to borrow'].filter(Boolean).join(' · '),
  }));
}

async function github(q, signal) {
  const data = await getJson(`https://api.github.com/search/repositories?q=${enc(`${q} in:name,description,topics`)}&sort=stars&order=desc&per_page=8`, signal);
  return (data?.items || []).filter((r) => r.stargazers_count >= 100 && !r.archived).slice(0, 6).map((r) => ({
    title: r.full_name, url: r.html_url, content: [r.description, `★ ${r.stargazers_count.toLocaleString('en')}`, r.language].filter(Boolean).join(' · '),
  }));
}

// Starts the search. onUpdate({ query, groups, finished }) runs when a part reports; groups[id] = { state, items, works }
// with state busy | done | error | off. Returns { cancel(), done }.
export function learnSearch(raw, { onUpdate } = {}) {
  const query = String(raw || '').trim();
  const ctrl = new AbortController();
  const groups = {};
  for (const g of LEARN_GROUPS) groups[g] = { state: 'off', items: [], works: [] };
  let finished = false;
  const emit = () => { if (!ctrl.signal.aborted) onUpdate?.({ query, groups: { ...groups }, finished }); };
  const part = async (ids, fn) => {
    for (const g of ids) if (groups[g].state === 'off') groups[g] = { ...groups[g], state: 'busy' };
    try {
      const out = await fn();
      for (const g of ids) groups[g] = { state: 'done', items: [...groups[g].items, ...(out[g]?.items || [])], works: [...groups[g].works, ...(out[g]?.works || [])] };
    } catch (e) {
      if (ctrl.signal.aborted) return;
      for (const g of ids) if (!groups[g].items.length && !groups[g].works.length) groups[g] = { ...groups[g], state: 'error' };
    }
    emit();
  };
  const langs = getLang() === 'de' ? ['de', 'en'] : ['en', 'de'];
  const jobs = [];
  if (learnOn('wikipedia')) jobs.push(part(['overview'], async () => {
    const [a, b] = await Promise.all(langs.map((l) => wiki(`${l}.wikipedia.org`, query, 2, ctrl.signal).catch(() => [])));
    if (!a.length && !b.length) throw new Error('Wikipedia');
    return { overview: { items: [...a, ...b] } };
  }));
  if (learnOn('openalex')) jobs.push(part(['intro'], async () => {
    const r = await openalex(query, ctrl.signal);
    groups.books = { ...groups.books, state: groups.books.state === 'off' ? 'done' : groups.books.state, works: r.books };
    return { intro: { works: r.intro } };
  }));
  if (learnOn('openlibrary')) jobs.push(part(['books'], async () => ({ books: { items: await openLibrary(query, ctrl.signal) } })));
  if (learnOn('wikibooks')) jobs.push(part(['courses'], async () => {
    const hosts = [`${langs[0]}.wikibooks.org`, 'en.wikiversity.org', ...(langs[0] === 'en' ? [] : ['en.wikibooks.org'])];
    const all = await Promise.all(hosts.map((host) => wiki(host, query, 2, ctrl.signal).catch(() => [])));
    return { courses: { items: all.flat() } };
  }));
  if (learnOn('github')) jobs.push(part(['practice'], async () => ({ practice: { items: await github(query, ctrl.signal) } })));
  if (learnOn('web')) jobs.push(part(['web'], async () => {
    if (!(await helperReady()) || !canWebSearch()) { groups.web = { state: 'off', items: [], works: [] }; return {}; }
    const r = await webSearch(`${query} tutorial`, { signal: ctrl.signal });
    return { web: { items: (r.results || []).slice(0, 8) } };
  }));
  const done = (async () => {
    await null;
    emit();
    await Promise.all(jobs);
    // a part that was skipped while it ran (the helper is away) must not stay busy
    for (const g of LEARN_GROUPS) if (groups[g].state === 'busy') groups[g] = { ...groups[g], state: 'done' };
    finished = true;
    emit();
    return { query, groups };
  })();
  return { query, cancel: () => ctrl.abort(), done };
}
