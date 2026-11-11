// Research (0.14.0): searches the open interfaces in research-sources.js at the same time, merges what they find
// (research-merge.js) and reports after every answer, so the first hits show while arXiv still thinks.
// Answers come directly where the browser may read them, otherwise through your Mac helper (mac-helper/, 0.14.4; your
// address at home, pages with JavaScript, the PDF folder) when it answers, otherwise through your fetcher
// (fetch-proxy/worker.js). Settings live on this device: research.worker, research.token, research.helper,
// research.helperToken, research.openalexKey, research.s2Key, research.off.
// fetchPage() (0.14.1) brings pages, PDFs and arXiv sources to the reader the same way; renderPage() (0.14.4) asks the
// helper for a page as Chromium shows it after its scripts ran.
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
    helper: String(loadPref('research.helper', '') || '').trim().replace(/\/+$/, ''),
    helperToken: String(loadPref('research.helperToken', '') || '').trim(),
    openalexKey: String(loadPref('research.openalexKey', '') || '').trim(),
    s2Key: String(loadPref('research.s2Key', '') || '').trim(),
    off: loadPref('research.off', []),
  };
}
export const saveResearchSetting = (key, value) => savePref(`research.${key}`, typeof value === 'string' ? value.trim() : value);
export const hasWorker = (s = researchSettings()) => !!(s.worker && s.token);
export const hasHelper = (s = researchSettings()) => !!(s.helper && s.helperToken);
// a way to fetch what the browser may not read itself: the helper or the worker
export const hasFetcher = (s = researchSettings()) => hasWorker(s) || hasHelper(s);
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
    this.code = code;   // offline, no-worker, worker-token, worker-origin, worker, helper-token, helper-origin, helper, no-helper, no-render, blocked, rate, key, not-found, http, network, timeout, parse
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

// ------------------------------------------------------------------ the Mac helper (0.14.4)
// Asked first when it answers; a Mac that sleeps or a phone away from home costs one short /ping every two minutes.
const HELPER_OK_MS = 5 * 60 * 1000;
const HELPER_DOWN_MS = 2 * 60 * 1000;
let helper = { key: '', ok: null, at: 0, info: null, pending: null };
export const helperState = () => ({ ok: helper.ok, info: helper.info });
export async function helperReady(settings = researchSettings(), { fresh = false } = {}) {
  if (!hasHelper(settings)) return false;
  const key = `${settings.helper}|${settings.helperToken}`;
  if (helper.key !== key) helper = { key, ok: null, at: 0, info: null, pending: null };
  const age = Date.now() - helper.at;
  if (!fresh && helper.ok === true && age < HELPER_OK_MS) return true;
  if (!fresh && helper.ok === false && age < HELPER_DOWN_MS) return false;
  if (helper.pending) return helper.pending;
  const mine = helper;
  mine.pending = (async () => {
    const c = new AbortController();
    const id = setTimeout(() => c.abort(), 4000);
    try {
      const res = await fetch(`${settings.helper}/ping`, { headers: { 'X-Toollib-Token': settings.helperToken }, credentials: 'omit', cache: 'no-store', signal: c.signal });
      const body = await res.json().catch(() => ({}));
      mine.ok = res.ok && body.ok === true;
      mine.info = mine.ok ? body : { status: res.status, error: body.error || '' };
    } catch {
      mine.ok = false;
      mine.info = null;
    } finally {
      clearTimeout(id);
    }
    mine.at = Date.now();
    mine.pending = null;
    return mine.ok;
  })();
  return mine.pending;
}
const helperDown = () => { helper.ok = false; helper.at = Date.now(); };
const helperHeaders = (s, more = {}) => ({ ...more, 'X-Toollib-Token': s.helperToken });

// The helper or the worker answered itself (no X-Final-URL): its own error, not the site's.
async function ownError(res, via) {
  let err = '';
  try { err = (await res.json()).error || ''; } catch { /* no details */ }
  if (res.status === 401) return new ResearchError(`${via}-token`);
  if (err === 'origin-not-allowed') return new ResearchError(`${via}-origin`);
  if (res.status === 413) return new ResearchError('too-large', { status: 413, detail: err });
  if (res.status === 403) return new ResearchError('blocked', { status: 403, detail: err });
  if (err === 'not-html') return new ResearchError('type', { status: res.status });
  if (err === 'no-render') return new ResearchError('no-render');
  if (via === 'helper' && res.status === 404) return new ResearchError('not-found', { status: 404, detail: err });
  if (via === 'helper' && res.status === 504) return new ResearchError('timeout', { status: 504 });
  return new ResearchError(via, { status: res.status, detail: err });
}

// via: '' (directly), 'helper' or 'worker'
async function readAnswer(res, req, via, src) {
  if (via && !res.headers.get('X-Final-URL')) {
    const e = await ownError(res, via);
    throw e.code === 'too-large' ? new ResearchError('blocked', { status: 413, detail: 'too-large' }) : e;
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
        data = await readAnswer(res, req, '', src);
        cache.set(req.url, { time: Date.now(), data });
        return data;
      } catch (e) {
        if (t.signal.aborted) throw t.signal.reason instanceof ResearchError ? t.signal.reason : new ResearchError('aborted');
        if (e instanceof ResearchError && !(e.code === 'rate' && src.cors === 'try')) throw e;
        directFailed = e;   // the browser refused (CORS) or the site is not reachable from here
      }
    }
    if (await helperReady(settings)) {
      let res = null;
      try {
        res = await fetch(`${settings.helper}/fetch?url=${encodeURIComponent(req.url)}`, { headers: helperHeaders(settings, headers), signal: t.signal, credentials: 'omit', cache: 'no-store' });
      } catch {
        if (t.signal.aborted) throw t.signal.reason instanceof ResearchError ? t.signal.reason : new ResearchError('aborted');
        helperDown();   // the Mac sleeps or you are away: the worker takes over
      }
      if (res) {
        data = await readAnswer(res, req, 'helper', src);
        blocked.delete(src.id);
        cache.set(req.url, { time: Date.now(), data });
        return data;
      }
    }
    if (!hasWorker(settings)) {
      if (hasHelper(settings)) throw new ResearchError('helper', { detail: 'unreachable' });
      throw new ResearchError(src.cors === 'no' ? 'no-worker' : directFailed instanceof ResearchError ? directFailed.code : 'network');
    }
    const via = `${settings.worker}/fetch?url=${encodeURIComponent(req.url)}${src.ttl ? `&ttl=${src.ttl}` : ''}`;
    let res;
    try {
      res = await fetch(via, { headers: { ...headers, 'X-Toollib-Token': settings.token }, signal: t.signal, credentials: 'omit', cache: 'no-store' });
    } catch {
      if (t.signal.aborted) throw t.signal.reason instanceof ResearchError ? t.signal.reason : new ResearchError('aborted');
      throw new ResearchError('worker', { detail: 'unreachable' });
    }
    data = await readAnswer(res, req, 'worker', src);
    cache.set(req.url, { time: Date.now(), data });
    return data;
  } finally {
    t.done();
  }
}

// ------------------------------------------------------------------ pages and files for the reader
const PAGE_TIMEOUT_MS = 120 * 1000;
const hostGap = (host) => (/(^|\.)arxiv\.org$/.test(host) ? 3100 : 400);

// A page, a PDF or an arXiv source: { bytes, finalUrl, contentType, via, savedAs, sha1 }. Through your Mac helper when
// it answers, else your fetcher; without either only sites that allow it (CORS) answer. keep: the helper keeps a PDF
// in your PDF folder (savedAs: its path there). onProgress(received, total) while the body comes in.
export async function fetchPage(url, { signal, settings = researchSettings(), onProgress, keep = false } = {}) {
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
    let res = null;
    let via = '';
    if (await helperReady(settings)) {
      try {
        res = await fetch(`${settings.helper}/fetch?url=${encodeURIComponent(url)}${keep ? '&keep=1' : ''}`, { headers: helperHeaders(settings, { Accept: '*/*' }), signal: t.signal, credentials: 'omit', cache: 'no-store' });
        via = 'helper';
      } catch {
        if (t.signal.aborted) throw t.signal.reason instanceof ResearchError ? t.signal.reason : new ResearchError('aborted');
        helperDown();
        res = null;
      }
    }
    if (res) {
      // the helper answered
    } else if (hasWorker(settings)) {
      via = 'worker';
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
        throw hasHelper(settings) ? new ResearchError('helper', { detail: 'unreachable' }) : new ResearchError('no-worker');
      }
    }
    if (via && !res.headers.get('X-Final-URL')) throw await ownError(res, via);
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
    const saved = res.headers.get('X-Saved-As');
    return {
      bytes, finalUrl: res.headers.get('X-Final-URL') || res.url || url, contentType: (res.headers.get('content-type') || '').toLowerCase(),
      via: via || 'direct', savedAs: saved ? decodeURIComponent(saved) : '', sha1: res.headers.get('X-Saved-Sha1') || '',
    };
  } catch (e) {
    if (t.signal.aborted && !(e instanceof ResearchError)) throw t.signal.reason instanceof ResearchError ? t.signal.reason : new ResearchError('aborted');
    if (e instanceof ResearchError) throw e;
    throw new ResearchError('network');
  } finally {
    t.done();
  }
}

// A request to the helper itself (0.14.4, the PDF folder): the answer, or a ResearchError ('helper' when it does not answer).
export async function helperFetch(path, { method = 'GET', json = null, signal, settings = researchSettings() } = {}) {
  if (!(await helperReady(settings))) throw new ResearchError(hasHelper(settings) ? 'helper' : 'no-helper', { detail: 'unreachable' });
  let res;
  try {
    res = await fetch(`${settings.helper}${path}`, {
      method, body: json ? JSON.stringify(json) : null, headers: helperHeaders(settings, json ? { 'Content-Type': 'application/json' } : {}),
      signal, credentials: 'omit', cache: 'no-store',
    });
  } catch {
    if (signal?.aborted) throw new ResearchError('aborted');
    helperDown();
    throw new ResearchError('helper', { detail: 'unreachable' });
  }
  if (!res.ok) throw await ownError(res, 'helper');
  return res;
}

// A page as Chromium on your Mac shows it after its scripts ran (0.14.4): { bytes, finalUrl, contentType, via: 'render' }.
// Needs the Mac helper; for pages that build their text with JavaScript (the reader and going through ask by themselves).
export async function renderPage(url, { signal, settings = researchSettings() } = {}) {
  if (!(await helperReady(settings))) throw new ResearchError(hasHelper(settings) ? 'helper' : 'no-helper', { detail: 'unreachable' });
  const t = timed(signal, PAGE_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(`${settings.helper}/render?url=${encodeURIComponent(url)}`, { headers: helperHeaders(settings), signal: t.signal, credentials: 'omit', cache: 'no-store' });
    } catch {
      if (t.signal.aborted) throw t.signal.reason instanceof ResearchError ? t.signal.reason : new ResearchError('aborted');
      helperDown();
      throw new ResearchError('helper', { detail: 'unreachable' });
    }
    if (!res.headers.get('X-Final-URL')) throw await ownError(res, 'helper');
    if (res.status === 404 || res.status === 410) throw new ResearchError('not-found', { status: res.status });
    if (res.status === 429) throw new ResearchError('rate', { status: 429 });
    if (res.status === 401 || res.status === 402 || res.status === 403) throw new ResearchError('blocked', { status: res.status });
    if (!res.ok) throw new ResearchError('http', { status: res.status });
    return { bytes: new Uint8Array(await res.arrayBuffer()), finalUrl: res.headers.get('X-Final-URL'), contentType: 'text/html; charset=utf-8', via: 'render', savedAs: '', sha1: '' };
  } catch (e) {
    if (t.signal.aborted && !(e instanceof ResearchError)) throw t.signal.reason instanceof ResearchError ? t.signal.reason : new ResearchError('aborted');
    if (e instanceof ResearchError) throw e;
    throw new ResearchError('network');
  } finally {
    t.done();
  }
}

// A page that builds its text with JavaScript: little text, but scripts. Then the helper shows it as Chromium does.
export function wantsRender(html, markdown) {
  const plain = String(markdown || '').replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, '').replace(/[#*_>`\-\s]+/g, ' ').trim();
  return plain.length < 200 && /<script[\s>]/i.test(String(html || ''));
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
    if (blocked.has(src.id) && !(await helperReady(settings))) { status[src.id] = { state: 'error', n: 0, error: 'blocked', status: 403 }; return; }
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
  const home = await helperReady(settings);
  await Promise.all(SOURCES.filter((s) => sourceOn(s.id, settings) && s.versionRequests && (home || !blocked.has(s.id))).map(async (src) => {
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
  if (hasHelper(s)) {
    set('helper', 'busy', 'research.test.busy', { name: 'Mac helper' });
    checks.push((async () => {
      await helperReady(s, { fresh: true });
      const st = helperState();
      if (st.ok) set('helper', 'ok', st.info.render ? 'research.test.helper' : 'research.test.helperNoRender', { version: st.info.version || '?', folder: st.info.pdfDir || '', n: st.info.inbox || 0 });
      else if (st.info?.status === 401) set('helper', 'fail', 'research.test.helperToken');
      else if (st.info?.error === 'origin-not-allowed') set('helper', 'fail', 'research.test.helperOrigin', { origin: location.origin });
      else if (st.info) set('helper', 'fail', 'research.test.workerError', { status: st.info.status });
      else set('helper', 'fail', 'research.test.helperUnreachable');
    })());
    await checks[0];   // the sources below then know whether the helper answers
  }
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
