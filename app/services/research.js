// Research (0.14.0): searches the open interfaces in research-sources.js at the same time, merges what they find
// (research-merge.js) and reports after every answer, so the first hits show while arXiv still thinks.
// Answers come directly where the browser may read them, otherwise through your fetcher (fetch-proxy/worker.js).
// Settings live on this device: research.worker, research.token, research.openalexKey, research.s2Key, research.off.
// fetchPage() (0.14.1) brings pages, PDFs and arXiv sources to the reader the same way.
import { loadPref, savePref } from './prefs.js';
import { SOURCES, sourceById } from './research-sources.js';
import { absorb, mergeRecords, parseQuery } from './research-merge.js';

const LIMIT = 15;
const TIMEOUT_MS = 75 * 1000;
const CACHE_MS = 15 * 60 * 1000;

// ------------------------------------------------------------------ settings
export function researchSettings() {
  return {
    worker: String(loadPref('research.worker', '') || '').trim().replace(/\/+$/, ''),
    token: String(loadPref('research.token', '') || '').trim(),
    openalexKey: String(loadPref('research.openalexKey', '') || '').trim(),
    s2Key: String(loadPref('research.s2Key', '') || '').trim(),
    off: loadPref('research.off', []),
  };
}
export const saveResearchSetting = (key, value) => savePref(`research.${key}`, typeof value === 'string' ? value.trim() : value);
export const hasWorker = (s = researchSettings()) => !!(s.worker && s.token);
export const sourceOn = (id, s = researchSettings()) => !(s.off || []).includes(id);
export function setSourceOn(id, on) {
  const off = new Set(researchSettings().off || []);
  if (on) off.delete(id); else off.add(id);
  saveResearchSetting('off', [...off]);
}

// ------------------------------------------------------------------ fetching
export class ResearchError extends Error {
  constructor(code, { status = 0, detail = '' } = {}) {
    super(`${code}${status ? ` ${status}` : ''}${detail ? `: ${detail}` : ''}`);
    this.code = code;   // offline, no-worker, worker-token, worker-origin, worker, blocked, rate, key, not-found, http, network, timeout, parse
    this.status = status;
  }
}

// Requests to the same site keep a distance (arXiv asks for three seconds).
const nextAt = new Map();
async function wait(src, signal) {
  const gap = src.gap || 150;
  const now = Date.now();
  const at = Math.max(now, nextAt.get(src.id) || 0);
  nextAt.set(src.id, at + gap);
  if (at > now) await sleep(at - now, signal);
}
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const id = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(id); reject(new ResearchError('aborted')); }, { once: true });
});

// One signal for "you stopped it" and "it took too long".
function timed(signal, ms) {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(new ResearchError('timeout')), ms);
  const stop = () => c.abort(new ResearchError('aborted'));
  if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true });
  return { signal: c.signal, done: () => { clearTimeout(id); signal?.removeEventListener('abort', stop); } };
}

async function readAnswer(res, req, viaWorker, src) {
  if (viaWorker && !res.headers.get('X-Final-URL')) {
    // The fetcher itself answered: its own error, not the site's.
    let err = '';
    try { err = (await res.json()).error || ''; } catch { /* no details */ }
    if (res.status === 401) throw new ResearchError('worker-token');
    if (err === 'origin-not-allowed') throw new ResearchError('worker-origin');
    if (res.status === 403 || res.status === 413) throw new ResearchError('blocked', { status: res.status, detail: err });
    throw new ResearchError('worker', { status: res.status, detail: err });
  }
  if (res.status === 404 && req.one) return null;
  if (res.status === 429) throw new ResearchError('rate', { status: 429 });
  // A refusal means a wrong key where a key is used; elsewhere the site refuses this address (DOAB refuses servers).
  if (res.status === 401 || res.status === 403) throw new ResearchError(src?.keyed ? 'key' : 'blocked', { status: res.status });
  if (!res.ok) throw new ResearchError('http', { status: res.status });
  try {
    return req.as === 'text' ? await res.text() : await res.json();
  } catch {
    throw new ResearchError('parse');
  }
}

const cache = new Map();   // url -> { time, data }

// Sources that refused this device or your fetcher (403): not asked again until the app reloads or the test works.
const blocked = new Set();
export const isBlocked = (id) => blocked.has(id);

// GET an address for a source: directly, or through the fetcher.
export async function getFor(src, req, { settings = researchSettings(), signal, fresh = false } = {}) {
  const hit = cache.get(req.url);
  if (!fresh && hit && Date.now() - hit.time < CACHE_MS) return hit.data;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ResearchError('offline');
  await wait(src, signal);
  const headers = { Accept: req.as === 'text' ? 'application/atom+xml, application/xml, text/xml, */*' : 'application/json', ...(req.headers || {}) };
  const t = timed(signal, TIMEOUT_MS);
  try {
    let data;
    let directFailed = null;
    if (src.cors !== 'no') {
      try {
        const res = await fetch(req.url, { headers, signal: t.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
        data = await readAnswer(res, req, false, src);
        cache.set(req.url, { time: Date.now(), data });
        return data;
      } catch (e) {
        if (t.signal.aborted) throw t.signal.reason instanceof ResearchError ? t.signal.reason : new ResearchError('aborted');
        if (e instanceof ResearchError && !(e.code === 'rate' && src.cors === 'try')) throw e;
        directFailed = e;   // the browser refused (CORS) or the site is not reachable from here
      }
    }
    if (!hasWorker(settings)) throw new ResearchError(src.cors === 'no' ? 'no-worker' : directFailed instanceof ResearchError ? directFailed.code : 'network');
    const via = `${settings.worker}/fetch?url=${encodeURIComponent(req.url)}${src.ttl ? `&ttl=${src.ttl}` : ''}`;
    let res;
    try {
      res = await fetch(via, { headers: { ...headers, 'X-Toollib-Token': settings.token }, signal: t.signal, credentials: 'omit', cache: 'no-store' });
    } catch {
      if (t.signal.aborted) throw t.signal.reason instanceof ResearchError ? t.signal.reason : new ResearchError('aborted');
      throw new ResearchError('worker', { detail: 'unreachable' });
    }
    data = await readAnswer(res, req, true, src);
    cache.set(req.url, { time: Date.now(), data });
    return data;
  } finally {
    t.done();
  }
}

// ------------------------------------------------------------------ pages and files for the reader
const PAGE_TIMEOUT_MS = 120 * 1000;
const hostGap = (host) => (/(^|\.)arxiv\.org$/.test(host) ? 3100 : 400);

// A page, a PDF or an arXiv source: { bytes, finalUrl, contentType }. Through your fetcher; without one only sites that
// allow it (CORS) answer. onProgress(received, total) while the body comes in.
export async function fetchPage(url, { signal, settings = researchSettings(), onProgress } = {}) {
  let host = '';
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('scheme');
    host = u.hostname;
  } catch { throw new ResearchError('bad-url'); }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ResearchError('offline');
  await wait({ id: `host:${host}`, gap: hostGap(host) }, signal);
  const t = timed(signal, PAGE_TIMEOUT_MS);
  try {
    let res;
    let viaWorker = false;
    if (hasWorker(settings)) {
      viaWorker = true;
      try {
        res = await fetch(`${settings.worker}/fetch?url=${encodeURIComponent(url)}`, { headers: { Accept: '*/*', 'X-Toollib-Token': settings.token }, signal: t.signal, credentials: 'omit', cache: 'no-store' });
      } catch {
        if (t.signal.aborted) throw t.signal.reason instanceof ResearchError ? t.signal.reason : new ResearchError('aborted');
        throw new ResearchError('worker', { detail: 'unreachable' });
      }
    } else {
      try {
        res = await fetch(url, { headers: { Accept: '*/*' }, signal: t.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      } catch {
        if (t.signal.aborted) throw t.signal.reason instanceof ResearchError ? t.signal.reason : new ResearchError('aborted');
        throw new ResearchError('no-worker');
      }
    }
    if (viaWorker && !res.headers.get('X-Final-URL')) {
      let err = '';
      try { err = (await res.json()).error || ''; } catch { /* no details */ }
      if (res.status === 401) throw new ResearchError('worker-token');
      if (err === 'origin-not-allowed') throw new ResearchError('worker-origin');
      if (res.status === 413) throw new ResearchError('too-large', { status: 413 });
      if (res.status === 403) throw new ResearchError('blocked', { status: 403, detail: err });
      throw new ResearchError('worker', { status: res.status, detail: err });
    }
    if (res.status === 404 || res.status === 410) throw new ResearchError('not-found', { status: res.status });
    if (res.status === 429) throw new ResearchError('rate', { status: 429 });
    if (res.status === 401 || res.status === 402 || res.status === 403) throw new ResearchError('blocked', { status: res.status });
    if (!res.ok) throw new ResearchError('http', { status: res.status });
    const total = Number(res.headers.get('content-length')) || 0;
    let bytes;
    if (res.body && onProgress) {
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onProgress(got, total);
      }
      bytes = new Uint8Array(got);
      let at = 0;
      for (const c of chunks) { bytes.set(c, at); at += c.length; }
    } else {
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    return { bytes, finalUrl: res.headers.get('X-Final-URL') || res.url || url, contentType: (res.headers.get('content-type') || '').toLowerCase() };
  } catch (e) {
    if (t.signal.aborted && !(e instanceof ResearchError)) throw t.signal.reason instanceof ResearchError ? t.signal.reason : new ResearchError('aborted');
    if (e instanceof ResearchError) throw e;
    throw new ResearchError('network');
  } finally {
    t.done();
  }
}

// ------------------------------------------------------------------ searching
// Starts a search. onUpdate({ query, works, status, finished }) runs after every answer; status per source:
// { state: 'busy'|'ok'|'none'|'skip'|'error', n, error }. Returns { query, cancel(), done }.
export function startSearch(raw, { onUpdate, only } = {}) {
  const query = parseQuery(raw);
  const settings = researchSettings();
  const ctrl = new AbortController();
  const records = [];
  const status = {};
  let works = [];
  let finished = false;
  let versions = null;   // { key, state: 'busy' | 'done', added, failed } for a DOI, an arXiv id or a PMID
  const emit = () => onUpdate?.({ query, works, status: { ...status }, finished, versions });
  const active = SOURCES.filter((s) => (only ? only.includes(s.id) : sourceOn(s.id, settings)));
  for (const s of SOURCES) status[s.id] = active.includes(s) ? { state: 'busy', n: 0 } : { state: 'off', n: 0 };

  const runOne = async (src) => {
    const reqs = src.requests(query, settings, src.id === 'doab' ? 10 : LIMIT);
    if (!reqs.length) { status[src.id] = { state: 'skip', n: 0 }; return; }
    if (blocked.has(src.id)) { status[src.id] = { state: 'error', n: 0, error: 'blocked', status: 403 }; return; }
    try {
      let n = 0;
      for (const req of reqs) {
        const data = await getFor(src, req, { settings, signal: ctrl.signal });
        const found = src.parse(data, req);
        n += found.length;
        records.push(...found);
      }
      status[src.id] = { state: n ? 'ok' : 'none', n };
      works = mergeRecords(records);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (e instanceof ResearchError && e.code === 'blocked') blocked.add(src.id);
      status[src.id] = { state: 'error', n: 0, error: e instanceof ResearchError ? e.code : 'network', status: e.status || 0 };
    }
    emit();
  };

  const done = (async () => {
    await null;   // the caller has its handle before the first report
    emit();
    await Promise.all(active.map(runOne));
    if (ctrl.signal.aborted) return { query, works, status };
    // A DOI, an arXiv id or a PMID: look for the other versions of what it names.
    if (query.kind !== 'text' && works.length) {
      const main = works.find((w) => w.ids[query.kind] === query.value || (query.kind === 'isbn' && w.ids.isbn?.includes(query.value))) || works[0];
      versions = { key: main.key, state: 'busy' };
      emit();
      const r = await findVersions(main, {
        signal: ctrl.signal,
        settings,
        onUpdate: (w) => { works = works.map((x) => (x.key === main.key ? w : x)); emit(); },
      });
      versions = { key: main.key, state: 'done', added: r.added, failed: r.failed };
    }
    finished = true;
    emit();
    return { query, works, status };
  })();
  return { query, cancel: () => ctrl.abort(), done };
}

// Looks for more versions of one work by its title (an arXiv preprint of a paid article, the published version of
// a preprint, a copy in PubMed Central). onUpdate(work) runs when a source added something; resolves to the work
// and how many versions came in.
export async function findVersions(work, { onUpdate, signal, settings = researchSettings() } = {}) {
  let current = work;
  let added = 0;
  const failed = [];
  await Promise.all(SOURCES.filter((s) => sourceOn(s.id, settings) && s.versionRequests && !blocked.has(s.id)).map(async (src) => {
    for (const req of src.versionRequests(current, settings)) {
      try {
        const data = await getFor(src, req, { settings, signal });
        const r = absorb(current, src.parse(data, req));
        if (r.added || r.work !== current) {
          current = r.work;
          added += r.added;
          onUpdate?.(current);
        }
      } catch (e) {
        if (signal?.aborted) return;
        failed.push({ source: src.id, error: e instanceof ResearchError ? e.code : 'network' });
      }
    }
  }));
  return { work: current, added, failed };
}

// ------------------------------------------------------------------ settings test
// One line per check: { id, status: 'ok'|'warn'|'fail'|'info', key, vars }. onLine(lines) after every answer.
export async function testResearch(onLine) {
  const s = researchSettings();
  const lines = [];
  const set = (id, status, key, vars = {}) => {
    const i = lines.findIndex((l) => l.id === id);
    const line = { id, status, key, vars };
    if (i >= 0) lines[i] = line; else lines.push(line);
    onLine?.([...lines]);
  };
  const checks = [];
  set('worker', hasWorker(s) ? 'busy' : 'info', hasWorker(s) ? 'research.test.busy' : 'research.test.noWorker', { name: 'Fetcher' });
  if (hasWorker(s)) {
    checks.push((async () => {
      try {
        const res = await fetch(`${s.worker}/ping`, { headers: { 'X-Toollib-Token': s.token }, credentials: 'omit', cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.ok) set('worker', 'ok', 'research.test.worker', { version: body.version || '?' });
        else if (res.status === 401) set('worker', 'fail', 'research.test.workerToken');
        else if (body.error === 'origin-not-allowed') set('worker', 'fail', 'research.test.workerOrigin', { origin: location.origin });
        else set('worker', 'fail', 'research.test.workerError', { status: res.status });
      } catch {
        set('worker', 'fail', 'research.test.workerUnreachable');
      }
    })());
  }
  const probe = (id, req, ok, extra) => {
    const src = sourceById(id);
    if (!sourceOn(id, s)) return;
    set(id, 'busy', 'research.test.busy', { name: src.name });
    checks.push((async () => {
      try {
        await getFor(src, req, { settings: s, fresh: true });
        blocked.delete(id);
        set(id, 'ok', ok, { name: src.name, ...extra });
      } catch (e) {
        const code = e instanceof ResearchError ? e.code : 'network';
        if (code === 'blocked') blocked.add(id);
        set(id, code === 'no-worker' ? 'info' : code === 'rate' ? 'warn' : 'fail', `research.err.${code}`, { name: src.name, id, status: e.status || '' });
      }
    })());
  };
  probe('openalex', { url: `https://api.openalex.org/works/W2741809807?select=id${s.openalexKey ? `&api_key=${encodeURIComponent(s.openalexKey)}` : ''}`, as: 'json', one: true }, s.openalexKey ? 'research.test.keyOk' : 'research.test.noKey');
  probe('crossref', { url: 'https://api.crossref.org/works?rows=0', as: 'json' }, 'research.test.ok');
  probe('arxiv', { url: 'https://export.arxiv.org/api/query?id_list=1810.04414&max_results=1', as: 'text' }, 'research.test.ok');
  probe('s2', { url: 'https://api.semanticscholar.org/graph/v1/paper/search?query=bosonization&limit=1&fields=title', as: 'json', headers: s.s2Key ? { 'x-api-key': s.s2Key } : {} }, s.s2Key ? 'research.test.keyOk' : 'research.test.ok');
  probe('europepmc', { url: 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=nursing&format=json&pageSize=1', as: 'json' }, 'research.test.ok');
  probe('doaj', { url: 'https://doaj.org/api/search/articles/physics?pageSize=1', as: 'json' }, 'research.test.ok');
  probe('doab', { url: 'https://directory.doabooks.org/rest/search?query=physics&expand=metadata&limit=1', as: 'json' }, 'research.test.ok');
  await Promise.all(checks);
  return lines;
}
