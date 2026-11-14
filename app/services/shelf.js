// The library to browse (0.29.0, Etappe 4b; ENTE: "eine kleine Library, wo man durchstöbern kann"). Everything you
// read and write, sorted onto four shelves that stay apart:
//   continue   Weiterlesen: the works and pages you had open last, with how far you got
//   texts      Deine Texte: your own books (the libraries of your projects, chapters and pages you write)
//   docs       Dokumentationen: websites you went through (a run of crawl.js), each one book with its pages
//   works      Papers & Funde: works you kept (papers, books, PDFs, single pages), read or not yet
// Nothing here is stored in the knowledge: the shelves are put together from the nodes (search.js) each time. Only
// how far you read a work is kept, on this device (reader.progress), like the trail of trail.js.
//
// For Python readers: the functions return plain lists of dicts; shell/shelf-view.js turns them into book cards.
import { allNodes, nodeByPath } from './search.js';
import { loadPref, savePref } from './prefs.js';
import { trail } from './trail.js';
import { libraries, pagesOf } from './library-store.js';
import { clipsIn, folders } from './research-store.js';
import { projects, projectsWith } from './projects.js';
import { bareHost, scopeFor, scopeFromText } from './crawl.js';

// ------------------------------------------------------------------ how far you read (on this device)
// reader.progress: { "<path of the clip>": { p: 0…1 (the furthest point you scrolled to), at: time of the last visit } }
const PROGRESS = 'reader.progress';
const MAX_PROGRESS = 400;
export const READ_AT = 0.9;   // from here on a work counts as read
const progressMap = () => { const v = loadPref(PROGRESS, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
const entry = (v) => (v && typeof v === 'object' ? { p: Math.max(0, Math.min(1, Number(v.p) || 0)), at: Number(v.at) || 0 } : { p: 0, at: 0 });
export const progressOf = (path) => entry(progressMap()[path]).p;
export const visitOf = (path) => entry(progressMap()[path]).at;

// The reader reports where you are: the fraction of the text above the bottom of the window. The furthest point
// stays (scrolling back up does not make a work unread); the newest visit goes last, so the oldest drop out first.
export function noteProgress(path, frac) {
  if (!path || !Number.isFinite(frac)) return;
  const all = progressMap();
  const before = entry(all[path]);
  const p = Math.round(Math.max(before.p, Math.min(1, Math.max(0, frac))) * 100) / 100;
  delete all[path];
  all[path] = { p, at: Date.now() };
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PROGRESS))) delete all[k];
  savePref(PROGRESS, all);
}

// ------------------------------------------------------------------ helpers
const live = (d) => d && !d.conflict;
// the projects a node belongs to, as { slug, title } (the shelves show them as small chips)
const projectsOf = (slug) => projectsWith(slug).map((p) => ({ slug: p.slug, path: p.path, title: p.title }));

// The part of a website that pages share, when their run has no folder any more: host and the longest common folder.
export function commonScope(clips) {
  let host = '';
  let common = null;
  for (const d of clips) {
    let u;
    try { u = new URL(d.url); } catch { continue; }
    const hst = bareHost(u.hostname);
    if (!host) host = hst;
    if (hst !== host) continue;
    const parts = u.pathname.split('/').filter(Boolean);
    if (!u.pathname.endsWith('/')) parts.pop();   // the file itself is no folder
    if (!common) { common = parts; continue; }
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  return host ? `${host}/${(common || []).map((p) => `${p}/`).join('')}` : '';
}

// ------------------------------------------------------------------ Dokumentationen
// One documentation: a folder of a run (crawl.js), or pages whose run has lost its folder (they stay a book).
//   { key, folder (summary or null), slug, title, scope, start, clips, pages, read, opened, last ({ path, title, at }),
//     at, running, projects }
function docOf({ key, folder, title, scope, start, clips }, all) {
  let read = 0;
  let opened = 0;
  let last = null;
  for (const d of clips) {
    const v = entry(all[d.path]);
    if (v.p >= READ_AT) read++;
    if (v.at) { opened++; if (!last || v.at > last.at) last = { path: d.path, title: d.title, at: v.at }; }
  }
  const state = folder?.crawl?.state || '';
  return {
    key, folder, slug: folder ? folder.slug : key.slice(4), title, scope, start, clips,
    pages: clips.length, read, opened, last, at: last?.at || 0,
    running: state === 'running' || state === 'queued',
    projects: folder ? projectsOf(folder.slug) : [],
  };
}

export function docs() {
  const all = progressMap();
  const runs = folders().filter((f) => f.crawl);
  const out = runs.map((f) => docOf({ key: f.path, folder: f, title: f.title, scope: f.crawl.scope, start: f.crawl.start, clips: clipsIn(f) }, all));
  // pages of a run whose folder is gone (e.g. after "Delete" in the research window kept them): still a book
  const known = new Set(runs.map((f) => f.slug));
  const filed = new Set(runs.flatMap((f) => f.clips));
  const lost = new Map();
  for (const d of allNodes()) {
    if (d.type !== 'clip' || !live(d) || !d.run || known.has(d.run) || filed.has(d.slug)) continue;
    if (!lost.has(d.run)) lost.set(d.run, []);
    lost.get(d.run).push(d);
  }
  for (const [run, clips] of lost) {
    const scope = commonScope(clips);
    out.push(docOf({ key: `run:${run}`, folder: null, title: scope.replace(/\/$/, '') || clips[0].site || run, scope, start: '', clips }, all));
  }
  return out.sort((a, b) => b.at - a.at || a.title.localeCompare(b.title));
}
export const docByKey = (key, list = docs()) => list.find((d) => d.key === key) || null;

// Documentation worth having, for "Get a documentation" (ENTE: Python, NumPy, SciPy, Matplotlib, the Rust book).
// The run starts at the address and stays below its folder (crawl.js scopeFor), like any run you start yourself.
export const DOC_SUGGESTIONS = [
  { id: 'python', title: 'Python', start: 'https://docs.python.org/3/tutorial/index.html' },
  { id: 'numpy', title: 'NumPy', start: 'https://numpy.org/doc/stable/user/index.html' },
  { id: 'scipy', title: 'SciPy', start: 'https://docs.scipy.org/doc/scipy/tutorial/index.html' },
  { id: 'matplotlib', title: 'Matplotlib', start: 'https://matplotlib.org/stable/users/index.html' },
  { id: 'rust', title: 'The Rust Book', start: 'https://doc.rust-lang.org/book/' },
];
// The documentation on the shelf that already covers a suggestion: same host, one area inside the other.
export function docFor(s, list = docs()) {
  const want = scopeFor(s.start);
  return list.find((d) => {
    const have = scopeFromText(d.scope);
    if (!have || have.host !== want.host) return false;
    const inside = (a, b) => a === b || a.startsWith(`${b}/`);
    return inside(want.prefix, have.prefix) || inside(have.prefix, want.prefix);
  }) || null;
}

// ------------------------------------------------------------------ Deine Texte
// Your books: { path, slug, title, pages, project ({ slug, path, title } or null), last ({ path, title, at }), at }
export function texts() {
  const lastOf = new Map();
  for (const e of trail()) if (e.kind === 'write' && e.lib && !lastOf.has(e.lib) && nodeByPath(e.path)) lastOf.set(e.lib, e);
  return libraries().map((l) => {
    const owner = projectsOf(l.slug)[0] || null;
    const last = lastOf.get(l.path);
    return {
      path: l.path, slug: l.slug, title: l.title, pages: pagesOf(l.slug).length, project: owner,
      last: last ? { path: last.path, title: nodeByPath(last.path)?.title || last.title, at: last.at } : null, at: last?.at || 0,
    };
  }).sort((a, b) => b.at - a.at || a.title.localeCompare(b.title));
}

// ------------------------------------------------------------------ Papers & Funde
// The works you kept, without the pages of a website (those are documentations):
//   { path, slug, title, authors, year, kind, url, read (ticked in a project), progress, at, projects }
export function works() {
  const ticked = new Set(projects().flatMap((p) => p.readSlugs || []));
  const all = progressMap();
  return allNodes().filter((d) => d.type === 'clip' && live(d) && !d.run).map((d) => {
    const v = entry(all[d.path]);
    return {
      path: d.path, slug: d.slug, title: d.title, authors: d.authors || [], year: d.year || '', kind: d.kind, url: d.url,
      read: ticked.has(d.slug) || v.p >= READ_AT, progress: v.p, at: v.at, projects: projectsOf(d.slug),
    };
  }).sort((a, b) => Number(a.read) - Number(b.read) || b.at - a.at || a.title.localeCompare(b.title));
}

// ------------------------------------------------------------------ Weiterlesen
// What you had open last, newest first: works in the reader and pages you wrote. It comes from the trail (trail.js,
// the last 24 things) and from how far you read (more of them, kept longer); there a work you read to the end is
// left out, it is done. A documentation shows once, at the page you read last in it.
//   { kind: 'read' | 'write', path, title, at, progress, doc (the documentation of a page of a website),
//     lib (the library of a page), project, projects }
export function continueItems(max = 12, docList = docs()) {
  const docOfClip = new Map();
  for (const d of docList) for (const c of d.clips) docOfClip.set(c.path, d);
  const seen = new Map();   // path -> { kind, at }
  const add = (kind, path, at) => { const was = seen.get(path); if (!was || at > was.at) seen.set(path, { kind, path, at }); };
  for (const e of trail()) if (e.kind === 'read' || e.kind === 'write') add(e.kind, e.path, e.at || 0);
  for (const [path, v] of Object.entries(progressMap())) { const x = entry(v); if (x.at && x.p < READ_AT) add('read', path, x.at); }
  const out = [];
  const seenDocs = new Set();
  for (const e of [...seen.values()].sort((a, b) => b.at - a.at)) {
    if (out.length >= max) break;
    const d = nodeByPath(e.path);
    if (!live(d)) continue;
    if (e.kind === 'read' && d.type === 'clip') {
      const doc = docOfClip.get(d.path) || null;
      if (doc) { if (seenDocs.has(doc.key)) continue; seenDocs.add(doc.key); }
      out.push({ kind: 'read', path: d.path, title: d.title, at: e.at, progress: progressOf(d.path), doc, authors: d.authors || [], year: d.year || '', projects: doc ? doc.projects : projectsOf(d.slug) });
    } else if (e.kind === 'write' && d.type === 'page') {
      const lib = libraries().find((l) => l.slug === d.library) || null;
      const project = lib ? projectsOf(lib.slug)[0] || null : null;
      out.push({ kind: 'write', path: d.path, title: d.title, at: e.at, progress: null, lib: lib ? { path: lib.path, title: lib.title, slug: lib.slug } : null, project, projects: project ? [project] : [] });
    }
  }
  return out;
}
