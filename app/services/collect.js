// Daten sammeln (0.35.0, P17, ENTE: "Webscraper für beliebige Entitäten, Variablen (Regex), feste Werte, Ausgabe als
// Tabelle/Visualisierung über mehrere Websites"). You say what you look for; Loom fetches it from several pages and
// lays it out as a table.
//
//   where     pages (addresses), and/or a search on the web (SearXNG in your Mac helper), how deep (0: the pages
//             themselves, 1: also the pages they link to on the same site) and how many pages at most
//   what      variables: a name, a kind (text, number, price, link) and an expression (a regular expression; its
//             first group is the value). Without an expression the name itself is looked for, and the value of its
//             kind after it ("Genauigkeit ±0,3 °C" → 0.3 for a number called Genauigkeit)
//   fixed     values you set (Menge = 3, Versand = 4,95) and formulas over the variables (Gesamt = Menge · Preis +
//             Versand), worked out for every row
//   rows      one row per page (the first hit of each variable), or one row per hit (the n-th hit of every variable)
//   result    each row keeps its page; everything is unchecked until you confirm it (ok); "every" fetches again by
//             itself (hourly, daily, weekly) while Loom is open
//
// A query is a JSON file in your knowledge, data/<id>.json, so it syncs to your other devices. robots.txt is read
// and kept to, and requests to one site keep a distance (fetchPage keeps one per host, this file one more second).
// For Python readers: runQuery is a loop over pages with re.finditer per variable; the formulas are compiled once
// (plot.js compile, like the scratch pad) and called with the numbers of each row.
import { KNOWLEDGE, exists, listTree, readText, removeFile, writeFile } from './storage.js';
import { noteChange } from './sync.js';
import { canWebSearch, fetchPage, webSearch } from './research.js';
import { normalizeLink, parseRobots, robotsAllows, sameSite, scopeFor, isPdfUrl, skipByName } from './crawl.js';
import { slugify } from './nodes.js';
import { compile } from '../shell/plot.js';
import { onNodesChange } from './search.js';

export const DIR = 'data';
export const KINDS = ['text', 'number', 'price', 'link'];
export const EVERY = ['off', 'hourly', 'daily', 'weekly'];
const EVERY_MS = { hourly: 3600e3, daily: 864e5, weekly: 7 * 864e5 };
const MAX_PAGES = 60;
const str = (v, max = 300) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '');
const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const isUrl = (u) => /^https?:\/\/[^\s]+$/i.test(String(u || ''));

// ------------------------------------------------------------------ the shape of a query
export function cleanQuery(q = {}) {
  const vars = (Array.isArray(q.vars) ? q.vars : []).slice(0, 16).map((v) => ({ name: str(v?.name, 40), kind: KINDS.includes(v?.kind) ? v.kind : 'text', expr: str(v?.expr, 300) })).filter((v) => v.name);
  const fixed = (Array.isArray(q.fixed) ? q.fixed : []).slice(0, 16).map((f) => ({ name: str(f?.name, 40), value: str(f?.value, 200) })).filter((f) => f.name && f.value);
  const where = q.where || {};
  return {
    id: /^[a-z0-9-]{1,60}$/.test(q.id || '') ? q.id : '',
    title: str(q.title, 100),
    where: {
      pages: [...new Set((Array.isArray(where.pages) ? where.pages : []).map((u) => str(u, 600)).filter(isUrl))].slice(0, 40),
      search: str(where.search, 200),
      depth: num(where.depth, 0, 1, 0),
      max: num(where.max, 1, MAX_PAGES, 20),
    },
    vars,
    fixed,
    rows: q.rows === 'match' ? 'match' : 'page',
    every: EVERY.includes(q.every) ? q.every : 'off',
    widget: q.widget === true,
    result: cleanResult(q.result),
  };
}
function cleanResult(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    fetched: str(r.fetched, 40),
    rows: (Array.isArray(r.rows) ? r.rows : []).slice(0, 500).map((x) => ({
      page: str(x?.page, 600), title: str(x?.title, 200), n: num(x?.n, 0, 999, 0), ok: x?.ok === true,
      values: Object.fromEntries(Object.entries(x?.values || {}).slice(0, 40).map(([k, v]) => [str(k, 40), v == null ? null : typeof v === 'number' ? v : str(String(v), 300)])),
    })),
    pages: num(r.pages, 0, 999, 0),
    missing: Object.fromEntries(Object.entries(r.missing || {}).slice(0, 40).map(([k, v]) => [str(k, 40), num(v, 0, 999, 0)])),
    errors: (Array.isArray(r.errors) ? r.errors : []).slice(0, 60).map((e) => ({ url: str(e?.url, 600), code: str(e?.code, 40) })),
  };
}
// a new query to fill in: one empty variable row to start with (the file never keeps rows without a name)
export const emptyQuery = (title = '') => ({ ...cleanQuery({ title }), vars: [{ name: '', kind: 'text', expr: '' }] });

// ------------------------------------------------------------------ keeping queries (data/<id>.json)
let cache = null;
const listeners = new Set();
export const onQueries = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const tell = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.warn(e); } } };
const fileOf = (id) => `${DIR}/${id}.json`;

export async function listQueries({ fresh = false } = {}) {
  if (cache && !fresh) return cache;
  const out = [];
  for (const f of await listTree(`${KNOWLEDGE}/${DIR}`).catch(() => [])) {
    if (f.type !== 'file' || !/^[a-z0-9-]+\.json$/.test(f.path)) continue;
    try { const q = cleanQuery(JSON.parse(await readText(`${KNOWLEDGE}/${DIR}/${f.path}`))); q.id = f.path.replace(/\.json$/, ''); out.push(q); } catch { /* a broken file stays out */ }
  }
  out.sort((a, b) => (b.result?.fetched || '').localeCompare(a.result?.fetched || '') || a.title.localeCompare(b.title));
  cache = out;
  return out;
}
export async function loadQuery(id) { return (await listQueries()).find((q) => q.id === id) || null; }
export const queryNow = (id) => cache?.find((q) => q.id === id) || null;

async function freeId(title) {
  const base = slugify(title || 'abfrage').slice(0, 40).replace(/-+$/, '') || 'abfrage';
  for (let n = 1; ; n++) { const id = n === 1 ? base : `${base}-${n}`; if (!(await exists(`${KNOWLEDGE}/${fileOf(id)}`))) return id; }
}
export async function saveQuery(q0) {
  const q = cleanQuery(q0);
  if (!q.title) q.title = q.where.search || hostOf(q.where.pages[0]) || 'Abfrage';
  if (!q.id) q.id = await freeId(q.title);
  const file = `${KNOWLEDGE}/${fileOf(q.id)}`;
  const had = await exists(file);
  const text = `${JSON.stringify(q, null, 1)}\n`;
  if (had && (await readText(file).catch(() => '')) === text) return q;
  await writeFile(file, text);
  await noteChange(fileOf(q.id), had ? 'edited' : 'added');
  cache = null;
  await listQueries();
  tell();
  return q;
}
export async function removeQuery(id) {
  const file = `${KNOWLEDGE}/${fileOf(id)}`;
  if (!(await exists(file))) return false;
  await removeFile(file);
  await noteChange(fileOf(id), 'removed');
  cache = null;
  await listQueries();
  tell();
  return true;
}
// after a sync the files may have changed
export function forgetQueries() { cache = null; tell(); }

// ------------------------------------------------------------------ finding values in a page
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const VALUE = {
  number: '([-+±]?\\d+(?:[.,]\\d+)?)',
  price: '(\\d{1,6}(?:[.,]\\d{2})?)\\s?(?:€|EUR|\\$|USD)',
  link: '(https?:\\/\\/[^\\s)\\]]+)',
  text: '([^\\n|]{1,80})',
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The expression of a variable: yours, else its name followed by a value of its kind. Returns a RegExp or an Error.
export function exprOf(v) {
  let src = v.expr;
  if (!src) {
    if (v.kind === 'price' && !v.name) src = VALUE.price;
    else if (v.kind === 'link') src = VALUE.link;
    else src = `${escapeRe(v.name)}\\s*(?:[:=]|ist|is)?[^\\S\\n]*${v.kind === 'text' ? VALUE.text : `[^\\d\\n±+-]{0,30}?${VALUE[v.kind]}`}`;
  }
  try { return new RegExp(src, 'gi'); } catch (e) { return e; }
}
// "12,34" → 12.34, "1.234,5" → 1234.5, "±0,3" → 0.3
export function toNumber(s) {
  if (typeof s === 'number') return s;
  let t = String(s ?? '').replace(/[±\s€$]|EUR|USD/gi, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}
// The text the expressions look at: the page as Markdown without the link syntax (the link text stays)
const plainOf = (md) => String(md || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\((https?:[^)]*)\)/g, '$1 $2').replace(/[*_`#>]/g, '');

// The values of one page: { name → [values …] } (each value as found, as text)
export function findValues(text, vars) {
  const out = {};
  for (const v of vars) {
    const re = exprOf(v);
    out[v.name] = [];
    if (re instanceof Error) continue;
    for (const m of text.matchAll(re)) {
      const raw = (m[1] ?? m[0] ?? '').trim();
      if (raw) out[v.name].push(raw);
      if (out[v.name].length >= 200) break;
    }
  }
  return out;
}
const valueOf = (raw, kind) => (raw == null ? null : kind === 'number' || kind === 'price' ? toNumber(raw) : raw);

// The fixed values and formulas, compiled once: a function row values → { name → number }
export function fixedFor(q) {
  const names = [...q.vars.map((v) => v.name), ...q.fixed.map((f) => f.name)];
  const ids = names.map((_, i) => `v${i}`);
  // your names in the formulas become v0, v1 … (names may have spaces and umlauts), longest first
  const order = names.map((n, i) => [n, i]).sort((a, b) => b[0].length - a[0].length);
  const prep = (src) => {
    let s = ` ${String(src).replace(/[·×]/g, '*').replace(/(\d),(\d)/g, '$1.$2')} `;
    for (const [n, i] of order) s = s.replace(new RegExp(`(^|[^\\wäöüÄÖÜß])${escapeRe(n)}(?=$|[^\\wäöüÄÖÜß])`, 'gi'), `$1v${i}`);
    return s.trim();
  };
  const fns = q.fixed.map((f) => { try { return compile(prep(f.value), ids); } catch (e) { return e; } });
  return {
    errors: Object.fromEntries(q.fixed.map((f, i) => [f.name, fns[i] instanceof Error ? String(fns[i].message || fns[i]) : ''])),
    run(values) {
      const vals = names.map((n, i) => (i < q.vars.length ? (typeof values[n] === 'number' ? values[n] : toNumber(values[n])) : null));
      const out = {};
      q.fixed.forEach((f, k) => {
        const fn = fns[k];
        let r = null;
        if (!(fn instanceof Error)) { try { r = fn(...vals.map((x) => (x == null ? NaN : x))); } catch { r = null; } }
        if (!Number.isFinite(r)) r = null;
        out[f.name] = r == null ? null : Math.round(r * 1e6) / 1e6;
        vals[q.vars.length + k] = r;
      });
      return out;
    },
  };
}

// The rows of one page
export function rowsOf(q, page, title, text) {
  const found = findValues(text, q.vars);
  const fixed = fixedFor(q);
  const make = (pick, n) => {
    const values = {};
    for (const v of q.vars) values[v.name] = valueOf(pick(found[v.name]), v.kind);
    return { page, title, n, ok: false, values: { ...values, ...fixed.run(values) } };
  };
  if (q.rows === 'match') {
    const count = Math.max(0, ...q.vars.map((v) => found[v.name].length));
    return Array.from({ length: Math.min(count, 200) }, (_, i) => make((l) => l[i], i));
  }
  if (!q.vars.some((v) => found[v.name].length)) return [];
  return [make((l) => l[0], 0)];
}
// the values again after you changed fixed values or formulas (no fetching)
export function recompute(q) {
  if (!q.result) return q;
  const fixed = fixedFor(q);
  const names = new Set(q.vars.map((v) => v.name));
  const rows = q.result.rows.map((r) => {
    const base = Object.fromEntries(Object.entries(r.values).filter(([k]) => names.has(k)));
    return { ...r, values: { ...base, ...fixed.run(base) } };
  });
  return { ...q, result: { ...q.result, rows } };
}

// ------------------------------------------------------------------ fetching
const robots = new Map();   // host → rules (for this app session)
async function allowed(url, signal) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!robots.has(u.host)) {
    let rules = null;
    try {
      const r = await fetchPage(`${u.protocol}//${u.host}/robots.txt`, { signal });
      rules = parseRobots(new TextDecoder().decode(r.bytes));
    } catch { rules = null; }   // none, or unreachable: allowed
    robots.set(u.host, rules);
  }
  const rules = robots.get(u.host);
  return !rules || robotsAllows(rules.rules, u.pathname + u.search);
}
const pause = (ms, signal) => new Promise((ok, no) => { const t = setTimeout(ok, ms); signal?.addEventListener('abort', () => { clearTimeout(t); no(new Error('aborted')); }, { once: true }); });

// The addresses to look at: your pages, the hits of the search, and with depth 1 the links of those pages on their site
async function startPages(q, { signal }) {
  const list = [...q.where.pages];
  if (q.where.search && canWebSearch()) {
    try {
      const r = await webSearch(q.where.search, { signal });
      for (const x of r.results || []) if (isUrl(x.url) && !list.includes(x.url)) list.push(x.url);
    } catch (e) { if (signal?.aborted) throw e; }
  }
  return list.slice(0, q.where.max);
}

let running = null;   // { id, done, total, abort }
export const collectRunning = () => (running ? { id: running.id, done: running.done, total: running.total } : null);
export function stopQuery() { running?.abort.abort(); }

// Fetches, finds, works out and keeps the result in the query. onProgress({ done, total, url }).
// Returns the saved query; rows you confirmed before stay confirmed when their values did not change.
export async function runQuery(q0, { onProgress } = {}) {
  if (running) throw new Error('busy');
  let q = await saveQuery(q0);
  const abort = new AbortController();
  const signal = abort.signal;
  running = { id: q.id, done: 0, total: 0, abort };
  tell();
  const rows = [];
  const errors = [];
  const seen = new Set();
  let pages = 0;
  try {
    const queue = (await startPages(q, { signal })).map((url) => ({ url, depth: 0 }));
    running.total = queue.length;
    while (queue.length && pages < q.where.max) {
      const { url, depth } = queue.shift();
      const key = url.replace(/#.*$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      onProgress?.({ done: pages, total: running.total, url });
      if (!(await allowed(url, signal))) { errors.push({ url, code: 'robots' }); continue; }
      let page;
      try { page = await fetchPage(url, { signal }); } catch (e) { if (signal.aborted) break; errors.push({ url, code: e?.code || 'network' }); continue; }
      pages += 1;
      running.done = pages;
      const ct = page.contentType || '';
      if (/pdf/.test(ct)) { errors.push({ url, code: 'pdf' }); continue; }
      const { decodeHtml, htmlToDoc } = await import('./reader-html.js');
      const html = decodeHtml(page.bytes, ct);
      let doc = null;
      try { doc = await htmlToDoc(html, page.finalUrl || url); } catch { errors.push({ url, code: 'parse' }); continue; }
      rows.push(...rowsOf(q, url, doc.title || hostOf(url), plainOf(doc.markdown)));
      // depth 1: the links of this page on its own site (the whole site: a list at /liste links products at /p/…)
      if (depth < q.where.depth) {
        const scope = scopeFor(new URL(page.finalUrl || url));
        const dom = new DOMParser().parseFromString(html, 'text/html');
        for (const a of dom.querySelectorAll('a[href]')) {
          const next = normalizeLink(a.getAttribute('href'), page.finalUrl || url);
          if (!next || !sameSite(next, scope) || isPdfUrl(next) || skipByName(next) || seen.has(next)) continue;
          if (queue.length + pages >= q.where.max * 2) break;
          queue.push({ url: next, depth: depth + 1 });
        }
        running.total = Math.min(q.where.max, pages + queue.length);
      }
      if (queue.length) await pause(1000, signal);
    }
  } finally {
    running = null;
  }
  // confirmed rows stay confirmed when nothing changed
  const before = new Map((q.result?.rows || []).filter((r) => r.ok).map((r) => [`${r.page}#${r.n}`, JSON.stringify(r.values)]));
  for (const r of rows) if (before.get(`${r.page}#${r.n}`) === JSON.stringify(r.values)) r.ok = true;
  const missing = {};
  const byPage = new Map();
  for (const r of rows) byPage.set(r.page, [...(byPage.get(r.page) || []), r]);
  for (const v of q.vars) missing[v.name] = [...byPage.values()].filter((list) => list.every((r) => r.values[v.name] == null)).length + Math.max(0, pages - byPage.size);
  q = await saveQuery({ ...q, result: { fetched: new Date().toISOString(), rows, pages, missing, errors } });
  tell();
  return q;
}

// confirm one row (or all with index -1), or take one out
export async function confirmRows(id, index = -1, ok = true) {
  const q = await loadQuery(id);
  if (!q?.result) return null;
  const rows = q.result.rows.map((r, i) => (index < 0 || i === index ? { ...r, ok } : r));
  return saveQuery({ ...q, result: { ...q.result, rows } });
}

// ------------------------------------------------------------------ fetching again by itself
export const dueAt = (q) => (q.every === 'off' || !EVERY_MS[q.every] ? Infinity : (Date.parse(q.result?.fetched || '') || 0) + EVERY_MS[q.every]);
let timer = 0;
// Called once when the app starts (shell.js); looks every ten minutes, one query at a time, only online and with a
// knowledge that is there already (a fresh device first clones).
export function startCollectSchedule() {
  if (timer) return;
  // a sync may have brought queries from another device
  onNodesChange((paths) => { if (paths === null) forgetQueries(); });
  const look = async () => {
    if (running || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    if (!(await exists(`${KNOWLEDGE}/.git`))) return;
    const due = (await listQueries({ fresh: true })).filter((q) => dueAt(q) <= Date.now() && (q.where.pages.length || q.where.search));
    if (due.length) { try { await runQuery(due[0]); } catch (e) { console.warn('Collect', e); } }
  };
  timer = setInterval(look, 10 * 60e3);
  setTimeout(look, 30e3);
}

// ------------------------------------------------------------------ as a table for a note (Archiv later)
export function tableMarkdown(q) {
  const cols = [...q.vars.map((v) => v.name), ...q.fixed.map((f) => f.name)];
  const cell = (v) => (v == null ? '' : String(typeof v === 'number' ? String(v).replace('.', ',') : v).replace(/\|/g, '\\|'));
  const lines = [`| ${[...cols, 'Seite'].join(' | ')} |`, `| ${[...cols, ''].map(() => '---').join(' | ')} |`];
  for (const r of q.result?.rows || []) lines.push(`| ${cols.map((c) => cell(r.values[c])).join(' | ')} | [${hostOf(r.page)}](${r.page}) |`);
  return lines.join('\n');
}
