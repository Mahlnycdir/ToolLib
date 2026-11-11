// Going through a website (0.14.3): from a start address Toollib follows the links below that address (the start
// path), up to a depth and a number of pages you set. It reads robots.txt first and keeps to it, takes the pages the
// sitemap lists, keeps a distance between two requests (at least the Crawl-delay of robots.txt) and turns every page
// into a clip with its text in a research folder of its own. PDFs the pages link to on the same site come along with
// their text (they count as pages). Clips link to each other where their text links ("links:").
// The run is kept on this device in /crawls/<folder>.json (outside the knowledge, not synced): a pause, an app the
// iPhone closed or a lost network continue where they stopped. Only one run at a time per device (Web Lock).
// With the Mac helper (0.14.4) pages that build their text with JavaScript are shown by Chromium on the Mac, and the
// PDFs stay as originals in your PDF folder (file: in the clip).
//   research/<name>.md  type: research; crawl: {start, scope, depth, max, pdfs}; crawl_state, crawl_pages, crawl_date
//   clips/<name>.md     type: clip; kind: page or document; site, url, crawl (the folder), crawl_depth, links, ## Text
import { fetchPage, hasFetcher, helperReady, renderPage, researchSettings, wantsRender } from './research.js';
import { KNOWLEDGE, exists, pfs, readText, removeFile, writeFile } from './storage.js';
import { parseNode, readNodeText, setField, slugify, writeNode, yamlValue } from './nodes.js';
import { allNodes, indexState, nodeByPath, nodeBySlug, onIndexChange, refreshNode } from './search.js';
import { isSyncing, noteChanges } from './sync.js';
import { holdAutoSync } from './autosync.js';
import { announce, onAnnounce, post } from './channel.js';
import { createFolder } from './research-store.js';
import { composeBody, parseBody } from './reader.js';
import { loadPref } from './prefs.js';

const DIR = '/crawls';
const LOCK = 'toollib-crawl';
const AGENTS = ['toollib-research', 'toollib'];
const MAX_SITEMAPS = 6;
const MAX_SITEMAP_URLS = 5000;
const today = () => new Date().toISOString().slice(0, 10);
const q = (v) => JSON.stringify(String(v));
const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) { resolve(); return; }
  const id = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(id); resolve(); }, { once: true });
});

export class CrawlError extends Error {
  constructor(code, status = 0) { super(status ? `${code} ${status}` : code); this.code = code; this.status = status; }
}

// What a new run starts with (Settings › Research); every run can set its own.
export function crawlDefaults() {
  const num = (k, d, lo, hi) => { const n = Number(loadPref(k, d)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return {
    depth: Math.round(num('crawl.depth', 2, 0, 10)),
    max: Math.round(num('crawl.max', 200, 1, 5000)),
    gap: num('crawl.gap', 1, 0, 120),
    pdfs: loadPref('crawl.pdfs', true) !== false,
  };
}

// ------------------------------------------------------------------ addresses
const TLDS = new Set('com org net edu gov mil int io dev app info eu de at ch uk fr it es nl be se no fi dk pl cz pt ie lu li gr hu ro sk si hr jp cn kr in ru us ca au nz br mx ar za tw hk sg ac co me tv xyz ai science page online site wiki'.split(' '));
const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|ref_src|igshid|spm)$/i;
export const bareHost = (h) => String(h || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

// "docs.scipy.org/doc/scipy/tutorial", "https://…", "crawl …" → a full address, or null when it is no address.
export function parseStart(raw) {
  let s = String(raw || '').trim().replace(/^crawl\s+/i, '');
  if (!s || /\s/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) {
    const host = s.split(/[/?#]/)[0].replace(/:\d+$/, '');
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]*$/i.test(host)) return null;   // "10.1103/…" is a DOI
    if (!/[/?]/.test(s) && !TLDS.has(host.split('.').pop().toLowerCase())) return null;   // "scipy.integrate" is no address
    s = `https://${s}`;
  }
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
    u.hash = '';
    return u.href;
  } catch { return null; }
}

// A link as an address to fetch: absolute, http(s), without #part and tracking parameters.
export function normalizeLink(href, base) {
  let u;
  try { u = new URL(String(href || '').trim(), base); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  u.hash = '';
  const drop = [...u.searchParams.keys()].filter((k) => TRACKING.test(k));
  for (const k of drop) u.searchParams.delete(k);
  if (drop.length && ![...u.searchParams.keys()].length) u.search = '';
  return u.href;
}

// The same page under different spellings has one key: no scheme, no www., no index.html, no trailing slash,
// sorted parameters. "docs.scipy.org/doc/scipy/tutorial"
export function urlKey(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  let path = u.pathname.replace(/\/{2,}/g, '/').replace(/\/(index|default)\.(html?|php|aspx?)$/i, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  const params = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const search = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
  const port = u.port && !['80', '443'].includes(u.port) ? `:${u.port}` : '';
  return `${bareHost(u.hostname)}${port}${path === '/' ? '' : path}${search}`;
}

// The part of the website a run stays in: the host and the path below which pages are taken.
// A start that names a file ("…/tutorial/index.html") takes its folder.
export function scopeFor(start) {
  const u = new URL(start);
  let path = u.pathname;
  const last = path.slice(path.lastIndexOf('/') + 1);
  if (/\.[a-z0-9]{1,5}$/i.test(last)) path = path.slice(0, path.lastIndexOf('/') + 1);
  return { host: bareHost(u.hostname), prefix: path.replace(/\/+$/, '') };
}
// What you typed as the area ("docs.scipy.org/doc/scipy/"), taken as it is.
export function scopeFromText(text) {
  const url = parseStart(text);
  if (!url) return null;
  const u = new URL(url);
  return { host: bareHost(u.hostname), prefix: u.pathname.replace(/\/+$/, '') };
}
export const scopeLabel = (scope) => `${scope.host}${scope.prefix}/`;
export const sameSite = (url, scope) => { try { return bareHost(new URL(url).hostname) === scope.host; } catch { return false; } };
export function inScope(url, scope) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (bareHost(u.hostname) !== scope.host) return false;
  const p = u.pathname.replace(/\/{2,}/g, '/');
  return !scope.prefix || p === scope.prefix || p.startsWith(`${scope.prefix}/`);
}

const SKIP = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|css|js|mjs|map|json|xml|rss|atom|zip|gz|tgz|bz2|xz|7z|rar|tar|dmg|exe|msi|deb|rpm|apk|iso|bin|mp3|mp4|m4a|m4v|wav|ogg|oga|webm|mov|avi|mkv|flac|woff2?|ttf|otf|eot|ipynb|py|txt|csv|tsv|xlsx?|docx?|pptx?|odt|ods|odp|epub|mobi|bib|ris|tex|ps|eps|djvu|dvi|mat|npy|npz|h5|hdf5|fits)$/i;
const pathOf = (url) => { try { return new URL(url).pathname; } catch { return ''; } };
export const isPdfUrl = (url) => /\.pdf$/i.test(pathOf(url));
export const skipByName = (url) => SKIP.test(pathOf(url));
const isPdfBytes = (bytes, type) => /pdf/.test(type || '') || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
function isHtml(bytes, type) {
  if (/html|xhtml/.test(type || '')) return true;
  if (type && !/text\/plain|octet-stream/.test(type)) return false;
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<head');
}

// "docs.scipy.org" → "scipy", "en.wikipedia.org" → "wikipedia": the start of a clip's name.
export function siteLabel(host) {
  const parts = bareHost(host).split('.').filter((p) => !['docs', 'doc', 'en', 'de', 'm', 'www', 'web', 'pages', 'blog'].includes(p));
  return parts.length > 1 ? parts[parts.length - 2] : parts[0] || bareHost(host);
}

// ------------------------------------------------------------------ robots.txt (RFC 9309) and sitemaps
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let cur = null;
  let agentLine = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !agentLine) { cur = { agents: [], rules: [], delay: null }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      agentLine = true;
      continue;
    }
    agentLine = false;
    if (key === 'sitemap') { if (val) sitemaps.push(val); continue; }
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') { if (val) cur.rules.push({ allow: key === 'allow', path: val }); }
    else if (key === 'crawl-delay') { const n = parseFloat(val); if (Number.isFinite(n) && n >= 0) cur.delay = n; }
  }
  // the groups for Toollib, else those for everyone
  const mine = groups.filter((g) => g.agents.some((a) => AGENTS.includes(a)));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  const delays = use.map((g) => g.delay).filter((d) => d != null);
  return { rules: use.flatMap((g) => g.rules), delay: delays.length ? Math.max(...delays) : 0, sitemaps };
}

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
function ruleLength(pattern, target) {
  const end = pattern.endsWith('$');
  const body = end ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(`^${body.split('*').map(escapeRe).join('.*')}${end ? '$' : ''}`);
  let decoded = target;
  try { decoded = decodeURI(target); } catch { /* keep it */ }
  return re.test(target) || re.test(decoded) ? body.length : -1;
}
// The longest matching rule decides; on a tie Allow wins. Without a matching rule everything is allowed.
export function robotsAllows(rules, pathAndQuery) {
  if (pathAndQuery === '/robots.txt') return true;
  let best = null;
  for (const r of rules || []) {
    const len = ruleLength(r.path, pathAndQuery);
    if (len < 0) continue;
    if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { len, allow: r.allow };
  }
  return !best || best.allow;
}

const unXml = (s) => s.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
export function parseSitemap(xml) {
  const text = String(xml || '');
  return { index: /<sitemapindex[\s>]/i.test(text), locs: [...text.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((m) => unXml(m[1])).filter(Boolean) };
}

// ------------------------------------------------------------------ the parts of a page
export function pageParts(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let base = url;
  const b = doc.querySelector('base[href]')?.getAttribute('href');
  if (b) { try { base = new URL(b, url).href; } catch { /* keep the page address */ } }
  const robots = [...doc.querySelectorAll('meta[name]')].filter((m) => /^(robots|toollib)$/i.test(m.getAttribute('name'))).map((m) => (m.getAttribute('content') || '').toLowerCase()).join(',');
  const canonical = doc.querySelector('link[rel~="canonical" i][href]')?.getAttribute('href');
  const links = [];
  for (const a of doc.querySelectorAll('a[href], area[href], link[rel~="next" i][href]')) {
    if (/\bnofollow\b/i.test(a.getAttribute('rel') || '')) continue;
    const href = a.getAttribute('href');
    if (!href || /^(mailto|tel|javascript|data):/i.test(href.trim())) continue;
    const u = normalizeLink(href, base);
    if (u) links.push(u);
  }
  return {
    title: (doc.querySelector('title')?.textContent || '').replace(/\s+/g, ' ').trim(),
    noindex: /\b(noindex|none)\b/.test(robots),
    nofollow: /\b(nofollow|none)\b/.test(robots),
    canonical: canonical ? normalizeLink(canonical, base) : null,
    links: [...new Set(links)],
  };
}

// Links in the text Toollib keeps (the main content, without menus): what a page is about points there.
export function textLinks(markdown) {
  return [...new Set([...String(markdown).matchAll(/\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => urlKey(m[1])).filter(Boolean))];
}

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

// ------------------------------------------------------------------ the run, kept on this device
let run = null;                // the run in this window: { state, ctrl, cmd }
const known = new Map();       // folder path -> brief state (from the file or another window)
const listeners = new Set();
export const onCrawl = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const slugOf = (path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
const fileOf = (folderPath) => `${DIR}/${slugOf(folderPath)}.json`;

function brief(s) {
  return {
    folder: s.folder, title: s.title, start: s.start, scope: scopeLabel(s.scope), depth: s.depth, max: s.max, pdfs: s.pdfs,
    gap: s.gap, delay: s.robots?.delay || 0, status: s.status, why: s.why || '', whyStatus: s.whyStatus || 0,
    started: s.started, updated: s.updated, finished: s.finished || 0, current: s.current || '', queue: s.queue.length,
    pages: Object.keys(s.paths).length, counts: { ...s.counts }, skipped: s.skipped.slice(-40), scopeMoved: !!s.scopeMoved,
    here: run?.state === s,
  };
}
function emit(s) {
  const b = brief(s);
  known.set(s.folder, b);
  for (const fn of listeners) { try { fn(b); } catch (e) { console.warn(e); } }
  try { post({ kind: 'crawl', state: { ...b, here: false } }); } catch { /* one window only */ }
}

function fresh({ folder, title, start, scope, depth, max, pdfs, gap }) {
  return {
    v: 1, folder, title, start, scope, depth, max, pdfs, gap, status: 'running', why: '', started: Date.now(), updated: Date.now(),
    robots: null, sitemapDone: false, queue: [], seen: [], done: {}, paths: {}, outlinks: {}, linked: {}, hashes: {}, order: [],
    counts: { fetched: 0, saved: 0, updated: 0, same: 0, robots: 0, outside: 0, type: 0, dup: 0, noindex: 0, empty: 0, missing: 0, blocked: 0, failed: 0, sitemap: 0, rendered: 0 },
    skipped: [], current: '',
  };
}

async function save(s) {
  s.updated = Date.now();
  const { _seen, _next, _dirty, _add, _lastFlush, _existing, ...rest } = s;
  rest.seen = [...(_seen || s.seen)];
  await writeFile(fileOf(s.folder), JSON.stringify(rest));
}
async function readState(folderPath) {
  try {
    const s = JSON.parse(await readText(fileOf(folderPath)));
    if (!s || s.v !== 1) return null;
    s._seen = new Set(s.seen || []);
    return s;
  } catch { return null; }
}

// The state of a folder's run as far as this window knows it; loadCrawl() reads the file.
export const crawlState = (folderPath) => (run?.state.folder === folderPath ? brief(run.state) : known.get(folderPath) || null);
export async function loadCrawl(folderPath) {
  if (run?.state.folder === folderPath) return brief(run.state);
  const s = await readState(folderPath);
  const b = s ? brief(s) : null;
  // another window may be running it right now: what it told us is newer than the file
  const told = known.get(folderPath);
  if (b && !(told && told.updated >= b.updated)) known.set(folderPath, b);
  return known.get(folderPath) || b;
}
export const crawlRunning = () => !!run;

async function lockHeld() {
  try { return !!(await navigator.locks?.query())?.held?.some((l) => l.name === LOCK); } catch { return false; }
}

// ------------------------------------------------------------------ starting, pausing, continuing
// opts: { start, scope (from scopeFor or scopeFromText), depth, max, pdfs, gap, title }. Returns the folder path.
export async function startCrawl(opts) {
  if (!hasFetcher(researchSettings())) throw new CrawlError('no-worker');
  if (run || await lockHeld()) throw new CrawlError('busy');
  const start = parseStart(opts.start);
  if (!start) throw new CrawlError('bad-url');
  const scope = opts.scope || scopeFor(start);
  if (!inScope(start, scope)) throw new CrawlError('outside-start');
  const d = crawlDefaults();
  const set = { depth: opts.depth ?? d.depth, max: opts.max ?? d.max, pdfs: opts.pdfs ?? d.pdfs, gap: opts.gap ?? d.gap };
  const title = String(opts.title || '').trim() || scopeLabel(scope).replace(/\/$/, '');
  const folder = await createFolder({
    title,
    extra: [`crawl: ${JSON.stringify({ start, scope: scopeLabel(scope), depth: set.depth, max: set.max, pdfs: set.pdfs })}`, 'crawl_state: "running"'],
  });
  const s = fresh({ folder, title, start, scope, ...set });
  s._seen = new Set();
  await save(s);
  go(s);
  return folder;
}

// Continues a paused or interrupted run of this device; more: raise the page limit by that much first.
export async function resumeCrawl(folderPath, { more = 0 } = {}) {
  if (run) throw new CrawlError('busy');
  if (await lockHeld()) throw new CrawlError('busy');
  const s = await readState(folderPath);
  if (!s) throw new CrawlError('no-state');
  if (more) s.max += more;
  s.gap = crawlDefaults().gap;
  go(s);
}

// The same run again: changed pages get their new text (your highlights stay), new pages come in.
export async function recrawl(folderPath) {
  if (run || await lockHeld()) throw new CrawlError('busy');
  const node = parseNode(await readNodeText(folderPath), folderPath);
  const c = node.meta.crawl && typeof node.meta.crawl === 'object' ? node.meta.crawl : null;
  const old = await readState(folderPath);
  const start = parseStart(c?.start || old?.start);
  if (!start) throw new CrawlError('no-state');
  const scope = (c?.scope && scopeFromText(c.scope)) || old?.scope || scopeFor(start);
  const d = crawlDefaults();
  const s = fresh({
    folder: folderPath, title: String(node.meta.title || old?.title || ''), start, scope,
    depth: Number(c?.depth ?? old?.depth ?? d.depth), max: Number(c?.max ?? old?.max ?? d.max), pdfs: (c?.pdfs ?? old?.pdfs ?? d.pdfs) !== false, gap: d.gap,
  });
  s._seen = new Set();
  await save(s);
  go(s);
}

// ------------------------------------------------------------------ runs on the Mac (0.14.4 part 2)
// A run for the Mac helper: the folder says crawl_on "mac" and crawl_state "queued"; the Toollib in the helper finds
// it after a sync, goes through and uploads like any device. Commands from other devices travel the same way:
// crawl_cmd and crawl_cmd_at in the folder; the helper answers with crawl_cmd_done (never the same line twice, so
// syncs from both sides merge).
export const MAC_CMDS = ['pause', 'stop', 'go', 'more', 'again'];
export async function queueCrawl(opts) {
  const start = parseStart(opts.start);
  if (!start) throw new CrawlError('bad-url');
  const scope = opts.scope || scopeFor(start);
  if (!inScope(start, scope)) throw new CrawlError('outside-start');
  const d = crawlDefaults();
  const set = { depth: opts.depth ?? d.depth, max: opts.max ?? d.max, pdfs: opts.pdfs ?? d.pdfs };
  const title = String(opts.title || '').trim() || scopeLabel(scope).replace(/\/$/, '');
  return createFolder({
    title,
    extra: [`crawl: ${JSON.stringify({ start, scope: scopeLabel(scope), ...set })}`, 'crawl_on: "mac"', 'crawl_state: "queued"', `crawl_at: ${q(new Date().toISOString())}`],
  });
}
export async function commandMac(folderPath, cmd) {
  if (!MAC_CMDS.includes(cmd)) throw new CrawlError('failed');
  await onFolder(folderPath, async () => {
    const text = await readNodeText(folderPath);
    let next = setField(text, 'crawl_cmd', q(cmd), ['crawl_on', 'crawl']);
    next = setField(next, 'crawl_cmd_at', q(new Date().toISOString()), ['crawl_cmd']);
    await writeNode(folderPath, next);
    await refreshNode(folderPath);
  });
  await noteChanges([[folderPath, 'edited']]);
  announce([folderPath]);
}
// The helper: a command is done (its time goes into crawl_cmd_done).
export async function commandDone(folderPath, at) {
  const changed = await onFolder(folderPath, async () => {
    const text = await readNodeText(folderPath);
    const next = setField(text, 'crawl_cmd_done', q(at), ['crawl_cmd_at', 'crawl_on']);
    if (next === text) return false;
    await writeNode(folderPath, next);
    await refreshNode(folderPath);
    return true;
  });
  if (changed) await noteChanges([[folderPath, 'edited']]);
}

// One change of a folder file at a time: the run (its pages, its state) and the helper's answers would otherwise read
// the same text, and the later write would drop the line of the other.
const folderQueue = new Map();
function onFolder(path, fn) {
  const next = (folderQueue.get(path) || Promise.resolve()).catch(() => {}).then(fn);
  folderQueue.set(path, next);
  next.catch(() => {}).finally(() => { if (folderQueue.get(path) === next) folderQueue.delete(path); });
  return next;
}
export const runningCrawl = () => (run ? { ...brief(run.state), ending: run.cmd || '' } : null);   // ending: told to pause or stop

export function pauseCrawl(folderPath) { command(folderPath, 'pause'); }
export function stopCrawl(folderPath) { command(folderPath, 'stop'); }
// Pause lets the page being fetched finish (it is not asked twice); Stop ends at once.
function command(folderPath, cmd) {
  if (run?.state.folder === folderPath) { tell(run, cmd); return; }
  try { post({ kind: 'crawl-cmd', folder: folderPath, cmd }); } catch { /* nothing runs elsewhere */ }
}

// Forgets the run of a folder on this device (the folder and its clips stay).
export async function forgetCrawl(folderPath) {
  if (run?.state.folder === folderPath) return;
  known.delete(folderPath);
  await removeFile(fileOf(folderPath));
}

// A run the app was closed in (the iPhone does that in the background) continues when Toollib opens again.
// Returns its title, or '' when nothing was waiting.
export async function resumeInterrupted() {
  if (run || await lockHeld()) return '';
  await indexReady();
  let names = [];
  try { names = (await pfs.readdir(DIR)).filter((n) => n.endsWith('.json')); } catch { return ''; }
  const waiting = [];
  for (const n of names) {
    try {
      const s = JSON.parse(await readText(`${DIR}/${n}`));
      if (s?.v === 1 && (s.status === 'running' || (s.status === 'paused' && s.why === 'offline')) && nodeByPath(s.folder)) waiting.push(s);
    } catch { /* unreadable: skip it */ }
  }
  const s = waiting.sort((a, b) => b.updated - a.updated)[0];
  if (!s) return '';
  s._seen = new Set(s.seen || []);
  s.gap = crawlDefaults().gap;
  go(s);
  return s.title;
}

function indexReady() {
  if (indexState().ready && !indexState().building) return Promise.resolve();
  return new Promise((resolve) => { const off = onIndexChange((st) => { if (st.ready && !st.building) { off(); resolve(); } }); });
}

function tell(r, cmd) {
  r.cmd = cmd;
  r.soft.abort();
  if (cmd === 'stop') r.ctrl.abort();
}

function go(s) {
  const ctrl = new AbortController();
  const r = { state: s, ctrl, soft: new AbortController(), cmd: null };
  run = r;
  s.status = 'running';
  s.why = '';
  s.whyStatus = 0;
  s.finished = 0;
  holdAutoSync('crawl', true);
  emit(s);
  const body = async () => {
    try {
      await loop(r);
    } catch (e) {
      s.status = 'error';
      s.why = e instanceof CrawlError ? e.code : 'failed';
      s.whyStatus = e?.status || 0;
      if (!(e instanceof CrawlError)) console.warn('Crawl failed', e);
    }
    if (r.cmd === 'pause') { s.status = 'paused'; s.why = ''; }
    if (r.cmd === 'stop') { s.status = 'stopped'; s.why = ''; }
    if (s.status !== 'running') s.finished = s.status === 'paused' ? 0 : Date.now();
    else { s.status = 'done'; s.finished = Date.now(); }
    s.current = '';
    try { await flush(s, { links: true, final: true }); } catch (e) { console.warn('Crawl: could not write the last pages', e); }
    try { await save(s); } catch { /* the folder keeps what was written */ }
    run = null;
    holdAutoSync('crawl', false);
    emit(s);
  };
  if (navigator.locks?.request) {
    navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock) { run = null; holdAutoSync('crawl', false); s.status = 'paused'; s.why = 'busy'; emit(s); return; }
      await body();
    });
  } else body();
}

// another window runs a crawl: what it tells, and what it is asked to do
onAnnounce((msg) => {
  if (msg?.kind === 'crawl' && msg.state?.folder && run?.state.folder !== msg.state.folder) {
    known.set(msg.state.folder, msg.state);
    for (const fn of listeners) { try { fn(msg.state); } catch (e) { console.warn(e); } }
  }
  if (msg?.kind === 'crawl-cmd' && run?.state.folder === msg.folder) tell(run, msg.cmd);
});
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    const b = [...known.values()].find((x) => x.status === 'paused' && x.why === 'offline');
    if (b && !run) resumeCrawl(b.folder).catch(() => {});
  });
}

// ------------------------------------------------------------------ the loop
function skip(s, item, why, status = 0) {
  s.counts[why] = (s.counts[why] || 0) + 1;
  s.skipped.push({ u: item.u, why, ...(status ? { status } : {}) });
  if (s.skipped.length > 120) s.skipped.splice(0, s.skipped.length - 120);
}

async function pace(s, signal) {
  const gap = Math.max(s.gapNow || s.gap || 0, s.robots?.delay || 0) * 1000;
  const wait = (s._next || 0) - Date.now();
  if (wait > 0) await sleep(wait, signal);
  s._next = Date.now() + gap;
}

const origin = (s) => new URL(s.start).origin;

async function getRobots(s, signal) {
  for (let attempt = 0; ; attempt++) {
    try {
      const page = await fetchPage(`${origin(s)}/robots.txt`, { signal });
      const type = page.contentType || '';
      // a page instead of a robots.txt (some sites answer everything with their start page): no rules
      if (/html/.test(type) && /<html/i.test(new TextDecoder().decode(page.bytes.subarray(0, 2000)))) return { rules: [], delay: 0, sitemaps: [] };
      return parseRobots(new TextDecoder().decode(page.bytes));
    } catch (e) {
      if (signal.aborted) throw e;
      const code = e?.code || 'network';
      // RFC 9309: a missing robots.txt (4xx) allows everything; an unreachable one (5xx) allows nothing for now
      if (['not-found', 'blocked'].includes(code) || (code === 'http' && e.status >= 400 && e.status < 500)) return { rules: [], delay: 0, sitemaps: [] };
      if (['no-worker', 'worker-token', 'worker-origin', 'helper-token', 'helper-origin', 'offline'].includes(code)) throw new CrawlError(code);
      if ((code === 'worker' || code === 'helper') && /unreachable/.test(e.message)) throw new CrawlError(code);
      if (attempt >= 1) throw new CrawlError('robots', e.status || 0);
      await sleep(3000, signal);
    }
  }
}

async function addSitemap(s, signal, wake = signal) {
  const list = (s.robots.sitemaps || []).filter((u) => sameSite(u, s.scope));
  if (!list.length) list.push(`${origin(s)}/sitemap.xml`);
  const found = [];
  let files = 0;
  while (list.length && files < MAX_SITEMAPS && found.length < MAX_SITEMAP_URLS) {
    const u = list.shift();
    files++;
    await pace(s, wake);
    if (wake.aborted) return false;
    let page;
    try { page = await fetchPage(u, { signal }); } catch (e) { if (signal.aborted) return false; continue; }
    let bytes = page.bytes;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      try { const { gunzipSync } = await import('../../vendor/reader.js'); bytes = gunzipSync(bytes); } catch { continue; }
    }
    const sm = parseSitemap(new TextDecoder().decode(bytes));
    if (sm.index) {
      // child sitemaps that name the start path first
      const first = s.scope.prefix.split('/').filter(Boolean)[0] || '';
      list.push(...sm.locs.filter((x) => sameSite(x, s.scope)).sort((a, b) => Number(!!first && b.includes(first)) - Number(!!first && a.includes(first))));
    } else found.push(...sm.locs);
  }
  if (s.depth < 1) return true;
  let n = 0;
  for (const raw of found) {
    const u = normalizeLink(raw);
    if (!u || !inScope(u, s.scope) || skipByName(u) || u.length > 400) continue;
    if (isPdfUrl(u) && !s.pdfs) continue;
    const k = urlKey(u);
    if (s._seen.has(k)) continue;
    s._seen.add(k);
    s.queue.push({ u, k, d: 1, sm: 1 });
    n++;
  }
  s.counts.sitemap = n;
  return true;
}

function enqueue(s, links, depth) {
  for (const u of links) {
    const k = urlKey(u);
    if (!k || s._seen.has(k)) continue;
    if (isPdfUrl(u)) {
      // PDFs a page links to come along when they are on the same website, also one level deeper (they are leaves)
      if (!s.pdfs || !sameSite(u, s.scope)) continue;
    } else if (!inScope(u, s.scope) || skipByName(u) || depth + 1 > s.depth || u.length > 400) continue;
    s._seen.add(k);
    s.queue.push({ u, k, d: depth + 1 });
  }
}

async function loop(r) {
  const s = r.state;
  const { signal } = r.ctrl;   // Stop: also the page being fetched
  const wake = r.soft.signal;  // Pause and Stop: no next page
  s._seen = s._seen || new Set(s.seen || []);
  s._dirty = new Map();   // path -> 'added' | 'edited'
  s._add = [...s.order];   // pages written before the app closed, perhaps not in the folder yet
  s._lastFlush = Date.now();
  s._existing = clipIndex();
  await markFolder(s, 'running');
  if (!s.robots) {
    s.current = `${origin(s)}/robots.txt`;
    emit(s);
    s.robots = await getRobots(s, signal);
    if (wake.aborted) return;
    await save(s);
  }
  if (!s.queue.length && !s.counts.fetched) {
    const k = urlKey(s.start);
    s._seen.add(k);
    s.queue.push({ u: s.start, k, d: 0 });
  }
  let fails = 0;
  while (!wake.aborted) {
    if (s.counts.fetched >= 1 && !s.sitemapDone) {
      s.current = `${origin(s)} · sitemap`;
      emit(s);
      if (!(await addSitemap(s, signal, wake))) break;
      s.sitemapDone = true;
      await save(s);
      continue;
    }
    if (s.counts.fetched >= s.max) { s.status = 'done'; s.why = s.queue.length ? 'limit' : ''; break; }
    const item = s.queue.shift();
    if (!item) { s.status = 'done'; break; }
    s.current = item.u;
    const at = new URL(item.u);
    if (!robotsAllows(s.robots.rules, at.pathname + at.search)) {
      skip(s, item, 'robots');
      if (item.d === 0) throw new CrawlError('robots-start');
      continue;
    }
    emit(s);
    await pace(s, wake);
    if (wake.aborted) { s.queue.unshift(item); break; }
    let page;
    try {
      page = await fetchPage(item.u, { signal, keep: s.pdfs });
    } catch (e) {
      if (signal.aborted) { s.queue.unshift(item); break; }
      const code = e?.code || 'network';
      if (['no-worker', 'worker-token', 'worker-origin', 'helper-token', 'helper-origin'].includes(code) || ((code === 'worker' || code === 'helper') && /unreachable/.test(e.message))) { s.queue.unshift(item); throw new CrawlError(code); }
      if (code === 'offline') { s.queue.unshift(item); s.status = 'paused'; s.why = 'offline'; break; }
      if (code === 'rate' && (item.r || 0) < 3) {
        item.r = (item.r || 0) + 1;
        s.gapNow = Math.min(60, Math.max(2, (s.gapNow || s.gap || 1) * 2));
        s.queue.unshift(item);
        await sleep(8000 * item.r, wake);
        continue;
      }
      if (['network', 'timeout', 'worker'].includes(code) && !item.r) {
        item.r = 1;
        s.queue.push(item);
        if (++fails >= 6) throw new CrawlError('network');
        continue;
      }
      s.counts.fetched++;
      skip(s, item, { 'not-found': 'missing', blocked: 'blocked', 'too-large': 'type' }[code] || 'failed', e?.status || 0);
      if (item.d === 0) throw new CrawlError(code === 'blocked' ? 'blocked' : 'start-failed', e?.status || 0);
      await save(s);
      continue;
    }
    fails = 0;
    s.counts.fetched++;
    try {
      await take(s, item, page, signal);
    } catch (e) {
      if (signal.aborted) { s.counts.fetched--; s.queue.unshift(item); break; }
      console.warn('Crawl: could not take', item.u, e);
      skip(s, item, 'failed');
    }
    if (item.d === 0 && !Object.keys(s.paths).length && !s.queue.length) throw new CrawlError('start-empty');
    if (s._dirty.size + s._add.length >= 12 || Date.now() - s._lastFlush > 15000) await flush(s, { links: s.counts.fetched % 60 === 0 });
    await save(s);
    emit(s);
  }
}

// One fetched page or PDF: its links into the queue, its text into a clip.
async function take(s, item, page, signal) {
  const finalUrl = page.finalUrl || item.u;
  const fkey = urlKey(finalUrl);
  const keys = [item.k];
  if (fkey && fkey !== item.k) {
    if (s.done[fkey]) { s.done[item.k] = s.done[fkey]; return skip(s, item, 'dup'); }
    s._seen.add(fkey);
    keys.push(fkey);
  }
  let doc;
  let kind;
  let title = '';
  if (isPdfBytes(page.bytes, page.contentType)) {
    if (!s.pdfs || !sameSite(finalUrl, s.scope)) return skip(s, item, s.pdfs ? 'outside' : 'type');
    const { pdfToDoc } = await import('./reader-pdf.js');
    doc = await pdfToDoc(page.bytes, { signal });
    kind = 'document';
    title = doc.title || decodeURIComponent(pathOf(finalUrl).split('/').pop() || '').replace(/\.pdf$/i, '');
  } else if (isHtml(page.bytes, page.contentType)) {
    if (!inScope(finalUrl, s.scope)) {
      // the start moved (scipy.org/docs → docs.scipy.org/…): the area moves with it
      if (item.d === 0) { s.scope = scopeFor(finalUrl); s.scopeMoved = true; } else return skip(s, item, 'outside');
    }
    const { decodeHtml, htmlToDoc } = await import('./reader-html.js');
    const html = decodeHtml(page.bytes, page.contentType);
    const parts = pageParts(html, finalUrl);
    if (parts.canonical) {
      const ck = urlKey(parts.canonical);
      if (ck && !keys.includes(ck)) {
        if (s.done[ck]) { for (const k of keys) s.done[k] = s.done[ck]; return skip(s, item, 'dup'); }
        if (inScope(parts.canonical, s.scope)) { s._seen.add(ck); keys.push(ck); }
      }
    }
    if (!parts.nofollow) enqueue(s, parts.links, item.d);
    if (parts.noindex) return skip(s, item, 'noindex');
    doc = await htmlToDoc(html, finalUrl);
    // little text but scripts: Chromium on your Mac shows the page (0.14.4); its links count too
    if (wantsRender(html, doc.markdown) && await helperReady()) {
      try {
        const shown = await renderPage(finalUrl, { signal });
        const html2 = decodeHtml(shown.bytes, shown.contentType);
        const parts2 = pageParts(html2, shown.finalUrl || finalUrl);
        if (!parts.nofollow && !parts2.nofollow) enqueue(s, parts2.links, item.d);
        const doc2 = await htmlToDoc(html2, shown.finalUrl || finalUrl);
        if (doc2.markdown.trim().length > doc.markdown.trim().length) {
          doc = { ...doc2, via: 'render' };
          s.counts.rendered = (s.counts.rendered || 0) + 1;
          if (!parts.title) parts.title = parts2.title;
        }
      } catch (e) {
        if (signal.aborted) throw e;
        console.warn('Crawl: the helper could not show', finalUrl, e);
      }
    }
    kind = 'page';
    title = withoutSite(s, doc.title || parts.title, item.d === 0);
  } else return skip(s, item, 'type');
  if (!doc?.markdown?.trim()) return skip(s, item, 'empty');
  const hash = fnv(doc.markdown);
  if (s.hashes[hash]) { for (const k of keys) s.done[k] = s.hashes[hash]; return skip(s, item, 'dup'); }
  const site = bareHost(new URL(finalUrl).hostname);
  const slug = await writePage(s, { url: item.u, finalUrl, kind, title: title || pathOf(finalUrl) || site, site, depth: item.d, doc, file: kind === 'document' ? page.savedAs || '' : '', fileSha1: page.sha1 || '' });
  for (const k of keys) s.done[k] = slug;
  s.hashes[hash] = slug;
  s.outlinks[slug] = textLinks(doc.markdown).slice(0, 80);
}

// "Part A — Example Docs": the name of the site that every title of a run ends with (learnt from the start page) goes.
const TITLE_SEP = /\s+[|—–·:-]{1,2}\s+/;
export function withoutSite(s, title, isStart = false) {
  const parts = String(title || '').split(TITLE_SEP);
  if (isStart && parts.length > 1 && s.titleTail == null) s.titleTail = parts[parts.length - 1].trim();
  const tail = s.titleTail || '';
  if (!tail || parts.length < 2 || parts[parts.length - 1].trim() !== tail) return String(title || '').trim();
  return String(title).slice(0, String(title).lastIndexOf(tail)).replace(/\s+[|—–·:-]{1,2}\s*$/, '').trim() || String(title).trim();
}

// ------------------------------------------------------------------ writing
function clipIndex() {
  const map = new Map();
  // only pages and documents: a paper you kept keeps its own text, even when its address comes up
  for (const d of allNodes()) if (d.type === 'clip' && !d.conflict && d.url && (d.kind === 'page' || d.kind === 'document')) map.set(urlKey(d.url), d.path);
  return map;
}

async function freePath(base) {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const path = `clips/${slug}.md`;
    if (!nodeBySlug(slug) && !(await exists(`${KNOWLEDGE}/${path}`))) return path;
  }
}

export function pageClipText(p) {
  const version = { kind: 'other', free: true, url: p.url, ...(p.kind === 'document' ? { pdf: p.url } : {}), host: p.site };
  const head = [
    '---', 'type: clip', `kind: ${q(p.kind)}`, `title: ${q(p.title)}`, `site: ${q(p.site)}`, `url: ${q(p.url)}`,
    'versions:', `  - ${JSON.stringify(version)}`,
    'sources:', `  - ${JSON.stringify({ title: p.site, url: p.url })}`,
    `crawl: ${q(p.folder)}`, `crawl_depth: ${Number(p.depth) || 0}`,
    `fetched: ${q(p.date)}`, `text_via: ${q(p.doc.via || (p.kind === 'document' ? 'pdf' : 'html'))}`, `text_url: ${q(p.finalUrl || p.url)}`, `text_fetched: ${q(p.date)}`,
    ...(p.file ? [`file: ${q(p.file)}`, `file_sha1: ${q(p.fileSha1 || '')}`] : []),
    'source: scraper', 'verified: false', '---',
  ];
  return `${head.join('\n')}\n\n${composeBody([{ title: null, lines: [] }], { text: p.doc.markdown, references: p.doc.references || [] })}`;
}

const FRONT = /^(﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$))/;

// A new clip, or the clip you have for this address (its text is renewed when it changed; highlights stay).
async function writePage(s, p) {
  await untilSyncIdle();
  const folderSlug = slugOf(s.folder);
  const have = s._existing.get(urlKey(p.url)) || s._existing.get(urlKey(p.finalUrl));
  const date = today();
  if (have && nodeByPath(have)) {
    const text = await readNodeText(have);
    const m = text.match(FRONT);
    const parts = parseBody(m ? text.slice(m[1].length) : text).parts;
    const old = parseBody(m ? text.slice(m[1].length) : text).text;
    const slug = slugOf(have);
    s.paths[slug] = have;
    if (!s.order.includes(slug)) { s.order.push(slug); s._add.push(slug); }
    const sameText = old.trim() === p.doc.markdown.trim();
    if (sameText && (!p.file || (m && m[1].includes(`file: ${q(p.file)}`)))) { s.counts.same++; return slug; }
    let head = m ? m[1] : '';
    if (sameText) {   // only the original in your PDF folder is new
      head = setField(head, 'file', q(p.file), ['text_fetched']);
      head = setField(head, 'file_sha1', q(p.fileSha1 || ''), ['file']);
      await writeNode(have, `${head}${text.slice(m ? m[1].length : 0)}`);
      await refreshNode(have);
      s._dirty.set(have, s._dirty.get(have) || 'edited');
      s.counts.same++;
      return slug;
    }
    head = setField(head, 'text_via', q(p.doc.via || 'html'), ['fetched', 'source']);
    head = setField(head, 'text_url', q(p.finalUrl || p.url), ['text_via']);
    head = setField(head, 'text_fetched', q(date), ['text_url']);
    head = setField(head, 'fetched', q(date), ['crawl_depth', 'url']);
    if (p.file) {
      head = setField(head, 'file', q(p.file), ['text_fetched']);
      head = setField(head, 'file_sha1', q(p.fileSha1 || ''), ['file']);
    }
    await writeNode(have, `${head}\n${composeBody(parts, { text: p.doc.markdown, references: p.doc.references || [] })}`);
    await refreshNode(have);
    s._dirty.set(have, s._dirty.get(have) || 'edited');
    s.counts.updated++;
    return slug;
  }
  const words = String(p.title).split(/\s+/).slice(0, 7).join(' ');
  const base = slugify(`${siteLabel(p.site)} ${words}`).slice(0, 48).replace(/-+$/, '') || 'page';
  const path = await freePath(base);
  await writeNode(path, pageClipText({ ...p, folder: folderSlug, date }));
  await refreshNode(path);
  const slug = slugOf(path);
  s._existing.set(urlKey(p.url), path);
  s.paths[slug] = path;
  s.order.push(slug);
  s._add.push(slug);
  s._dirty.set(path, 'added');
  s.counts.saved++;
  return slug;
}

async function untilSyncIdle() {
  for (let i = 0; i < 600 && isSyncing(); i++) await sleep(250);
}

// The folder lists the pages; the clips name each other ("links"); Sync learns what changed.
async function flush(s, { links = false, final = false } = {}) {
  s._lastFlush = Date.now();
  await untilSyncIdle();
  const changed = new Map(s._dirty || []);
  if (s._dirty) s._dirty.clear();
  if (s._add?.length) {
    const add = s._add;
    s._add = [];
    const grew = await onFolder(s.folder, async () => {
      const text = await readNodeText(s.folder);
      const node = parseNode(text, s.folder);
      const before = Array.isArray(node.meta.clips) ? node.meta.clips.map(String) : [];
      const after = [...before, ...add.filter((x) => !before.includes(x))];
      if (after.length === before.length) return false;
      await writeNode(s.folder, setField(text, 'clips', yamlValue(after), ['question', 'title_de', 'title']));
      await refreshNode(s.folder);
      return true;
    });
    if (grew) changed.set(s.folder, 'edited');
  }
  if (links) for (const p of await linkPass(s)) if (!changed.has(p)) changed.set(p, 'edited');
  if (final) { if (await markFolder(s, s.status)) changed.set(s.folder, 'edited'); }
  if (!changed.size) return;
  await noteChanges([...changed]);
  announce([...changed.keys()]);
}

async function linkPass(s) {
  const out = [];
  for (const [slug, keys] of Object.entries(s.outlinks)) {
    const path = s.paths[slug];
    if (!path) continue;
    const targets = [...new Set(keys.map((k) => s.done[k]).filter((x) => x && x !== slug))];
    const was = s.linked[slug] || [];
    if (!targets.length || (targets.length === was.length && targets.every((x, i) => x === was[i]))) continue;
    try {
      const text = await readNodeText(path);
      const have = parseNode(text, path).meta.links;
      const list = Array.isArray(have) ? have.map(String) : [];
      const next = [...list, ...targets.filter((x) => !list.includes(x))];
      s.linked[slug] = targets;
      if (next.length === list.length) continue;
      await writeNode(path, setField(text, 'links', yamlValue(next), ['crawl_depth', 'crawl', 'sources']));
      await refreshNode(path);
      out.push(path);
    } catch { /* the clip is gone: nothing to link */ }
  }
  return out;
}

// crawl_state, crawl_pages and crawl_date in the folder: what other devices see of the run.
function markFolder(s, status) {
  return onFolder(s.folder, () => markFolderNow(s, status));
}
async function markFolderNow(s, status) {
  try {
    const text = await readNodeText(s.folder);
    let next = setField(text, 'crawl_state', q(status), ['crawl', 'clips']);
    next = setField(next, 'crawl_pages', String(Object.keys(s.paths).length), ['crawl_state']);
    next = setField(next, 'crawl_date', q(today()), ['crawl_pages']);
    // for devices that only see the folder (a run on the Mac, 0.14.4): what waits, why it ended, when this was
    next = setField(next, 'crawl_queue', String((s.queue || []).length), ['crawl_date']);
    next = setField(next, 'crawl_why', q(s.why || ''), ['crawl_queue']);
    next = setField(next, 'crawl_at', q(new Date().toISOString()), ['crawl_why']);
    if (next === text) return false;
    await writeNode(s.folder, next);
    await refreshNode(s.folder);
    if (status !== 'running') { await noteChanges([[s.folder, 'edited']]); announce([s.folder]); }
    return true;
  } catch (e) {
    throw new CrawlError('no-folder');
  }
}

// ------------------------------------------------------------------ for the views
// Where a page sits below the area of its run: ["stats", "discrete.html"]; pages outside (PDFs) start with "/".
export function treePath(url, scopeText) {
  const scope = scopeFromText(scopeText || '');
  const p = pathOf(url).replace(/\/{2,}/g, '/');
  if (scope && (p === scope.prefix || p.startsWith(`${scope.prefix}/`))) return p.slice(scope.prefix.length).split('/').filter(Boolean);
  const parts = p.split('/').filter(Boolean);
  return parts.length ? [`/${parts.slice(0, -1).join('/')}`, parts[parts.length - 1]].filter((x) => x !== '/') : [];
}

// The clip of a page you went through, by its address (for links between them in the reader).
let urlMap = null;
let urlMapCount = -1;
export function clipByUrl(href) {
  const all = allNodes();
  if (!urlMap || urlMapCount !== all.length) {
    urlMap = new Map();
    for (const d of all) if (d.type === 'clip' && !d.conflict && d.url) urlMap.set(urlKey(d.url), d);
    urlMapCount = all.length;
  }
  const d = urlMap.get(urlKey(href));
  return d && nodeByPath(d.path) ? d : null;
}

// A single page as a work for the reader ("only this page").
export function pageWork(url) {
  const u = new URL(url);
  const site = bareHost(u.hostname);
  const pdf = isPdfUrl(url);
  return {
    key: `url:${urlKey(url)}`, title: `${site}${u.pathname === '/' ? '' : u.pathname}`, authors: [], year: null, venue: site, type: 'page', abstract: '', cited: 0,
    ids: { doi: '', arxiv: '', pmid: '', pmcid: '', openalex: '', isbn: [] }, free: true, sources: [], ranks: {},
    versions: [{ kind: 'other', free: true, url, pdf: pdf ? url : '', host: site, license: '', via: [] }],
  };
}
