// Python service: one worker for the whole app, started on first use. Output goes to the view that started
// the current run (its "sink"). Taken from Kobra's Runner (runner.js); changes for Toollib: Pyodide comes from
// vendor/pyodide, programs are snippets (code + definitions of needed snippets, or a check), texts via t(),
// a running animation can be stopped without restarting Python, and Python can be stored for offline use.
import { loadPref } from './prefs.js';

const PYODIDE = 'vendor/pyodide/';
const base = () => new URL('./', document.baseURI);
const pyUrl = (name) => new URL(`${PYODIDE}${name}`, base()).href;

const state = { status: 'off', python: '', version: '', error: '', sync: false, animating: false };
const listeners = new Set();
let worker = null;
let token = '';
let sink = null;          // see ConsoleView: write, figure, figureClosed, progress, note, requestInput, done, started …
let runStart = 0;
let bundle = null;        // vendor/pyodide/toollib-bundle.json
let startPromise = null;
let readyResolve = null;
let shownGuiNote = false;
let reported = new Set(); // packages already reported in this run
let stoppingLive = false;
let figures = new Map();  // key -> number of images of that figure in this run (more than one: an animation)
let stopTimer = null;
let idleWaiters = [];     // resolved when the current run is done

export const pythonState = () => ({ ...state });
export const isBusy = () => ['loading', 'running', 'live'].includes(state.status);
export function onPythonChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setStatus(status, extra = {}) {
  Object.assign(state, { status }, extra);
  for (const fn of listeners) fn(pythonState());
}

// What Toollib ships: Pyodide and Python version, packages and every file with its size.
export async function pythonBundle() {
  if (!bundle) {
    const res = await fetch(pyUrl('toollib-bundle.json'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bundle = await res.json();
  }
  return bundle;
}

export function startPython() {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    const info = await pythonBundle();
    token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    worker = new Worker(new URL('app/services/python-worker.js', base()), { type: 'module', name: 'python' });
    worker.onmessage = (e) => onMessage(e.data);
    worker.onerror = (e) => {
      setStatus('error', { error: e.message || 'worker error' });
      sink?.progress(null);
      sink?.note('python.err.worker', { detail: e.message || '' }, 'warn');
      readyResolve?.(false);
    };
    const ready = new Promise((r) => { readyResolve = r; });
    setStatus('loading');
    worker.postMessage({
      type: 'init',
      token,
      syncBase: new URL('__toollib__/', base()).href,
      indexURL: pyUrl(''),
      pyBundleURL: new URL(`vendor/py-bundle.json?v=${info.pyodide}`, base()).href,
      snippetsURL: new URL('app/services/toollib_snippets.py', base()).href,
      bundled: info.packages,
      screen: [window.innerWidth, window.innerHeight],
      useSync: !!navigator.serviceWorker?.controller && loadPref('python.sync', true) !== false,
    });
    return ready;
  })().catch((e) => {
    setStatus('error', { error: String(e) });
    sink?.progress(null);
    sink?.note('python.err.load', {}, 'warn');
    startPromise = null;
    return false;
  });
  return startPromise;
}

// Runs a program. spec: { name, code, deps: [[slug, code], ...], check }. The sink receives everything it prints.
export async function runPython(spec, newSink) {
  // A live animation ends with the next run by itself; a running program has to end first.
  if (state.status === 'running') await endRunning();
  if (sink && sink !== newSink) sink.detach?.();
  sink = newSink;
  shownGuiNote = false;
  reported = new Set();
  stoppingLive = false;
  figures = new Map();
  state.animating = false;
  sink.started?.();
  const ok = await startPython();
  if (sink !== newSink) return;
  if (!ok || !worker) {
    if (state.status !== 'off') sink.done?.({ exit: 1, gui: false, failed: true }, 0);   // off: stopped while loading
    return;
  }
  runStart = performance.now();
  if (state.sync) navigator.serviceWorker?.controller?.postMessage({ type: 'clear-events', token });
  worker.postMessage({ type: 'run', id: Date.now(), spec });
  setStatus('running');
}

async function endRunning() {
  if (state.animating && state.sync) {
    const done = new Promise((r) => idleWaiters.push(r));
    stopPython({ quiet: true });
    await Promise.race([done, new Promise((r) => setTimeout(r, 1600))]);
  }
  if (state.status === 'running') stopPython({ quiet: true, force: true });
}

// Stop: an animation is closed and Python stays ready, either after the script (status "live") or while plt.show()
// waits for it (its figures get a "close" event, as with Kobra's close button). Anything else ends the worker,
// and Python starts again (from the cache) with the next run.
export function stopPython({ quiet = false, force = false } = {}) {
  if (!worker) return;
  if (state.status === 'live' && !force) {
    stoppingLive = true;
    worker.postMessage({ type: 'stop-live' });
    if (!quiet) sink?.note('python.liveStopped', {}, 'info');
    return;
  }
  if (state.status === 'running' && state.animating && state.sync && !force) {
    if (stopTimer) return;
    const events = [...figures.keys()].map((key) => ({ k: 'close', w: key }));
    navigator.serviceWorker?.controller?.postMessage({ type: 'gui-events', token, events });
    if (!quiet) sink?.note('python.liveStopped', {}, 'info');
    // Still running a moment later (busy elsewhere): then the worker has to go after all.
    stopTimer = setTimeout(() => { stopTimer = null; if (state.status === 'running') stopPython({ quiet, force: true }); }, 1500);
    return;
  }
  clearTimeout(stopTimer);
  stopTimer = null;
  worker.terminate();
  worker = null;
  idleWaiters.splice(0).forEach((r) => r());
  startPromise = null;
  readyResolve?.(false);
  readyResolve = null;
  sink?.cancelInput?.();
  sink?.progress?.(null);
  if (!quiet) sink?.note('python.stopped', {}, 'warn');
  setStatus('off');
}

export function detachSink(s) {
  if (sink === s) sink = null;
}
export const isSink = (s) => sink === s;

function replySync(id, value) {
  navigator.serviceWorker?.controller?.postMessage({ type: 'sync-reply', token, id, value: JSON.stringify({ v: value === undefined ? null : value }) });
}

async function onSyncRequest(id, kind) {
  let value = null;
  try {
    if (kind === 'stdin') value = sink ? await sink.requestInput() : null;
  } catch { value = null; }
  replySync(id, value);
}

function onMessage(msg) {
  switch (msg.type) {
    case 'status':
      if (msg.state === 'ready' && msg.python) {
        Object.assign(state, { sync: !!msg.sync, python: msg.python, version: msg.version });
        readyResolve?.(true);
        readyResolve = null;
      }
      setStatus(msg.state);
      if (msg.state === 'loading') sink?.progress(msg.code, msg.vars);
      else sink?.progress(null);
      break;
    case 'fatal':
      setStatus('error', { error: msg.code });
      sink?.progress(null);
      sink?.note(msg.code, {}, 'warn');
      if (msg.detail) sink?.write(`${msg.detail}\n`, 'err');
      worker?.terminate();
      worker = null;
      startPromise = null;
      readyResolve?.(false);
      readyResolve = null;
      break;
    case 'progress': sink?.progress(msg.code, msg.vars); break;
    case 'stdout': sink?.write(msg.text, 'out'); break;
    case 'stderr': sink?.write(msg.text, 'err'); break;
    case 'gui': handleGuiOps(msg.ops); break;
    case 'sync-req': onSyncRequest(msg.id, msg.kind); break;
    case 'sync-lost':
      state.sync = false;
      sink?.note('python.syncLost', {}, 'warn');
      break;
    case 'notify': notify(msg.data); break;
    case 'run-done':
      clearTimeout(stopTimer);
      stopTimer = null;
      sink?.progress(null);
      setStatus(msg.result.gui ? 'live' : 'ready');
      sink?.done(msg.result, Math.round(performance.now() - runStart));
      idleWaiters.splice(0).forEach((r) => r());
      break;
    case 'gui-ended':
      if (!stoppingLive) sink?.liveEnded?.();
      stoppingLive = false;
      break;
    case 'live-stopped':
      // Windows (tkinter, Qt) keep a program alive even without figures: then the worker has to go.
      if (msg.alive) stopPython({ quiet: true, force: true });
      break;
    default: break;
  }
}

function notify(d) {
  if (d.type === 'auto-imports') {
    sink?.note('python.autoImports', { lines: d.lines.join(' · ') }, 'auto');
  } else if (d.type === 'not-bundled') {
    const fresh = d.packages.filter((p) => !reported.has(p));
    fresh.forEach((p) => reported.add(p));
    if (fresh.length) sink?.note('python.notBundled', { names: fresh.join(', ') }, 'warn');
  } else if (d.type === 'missing-module') {
    if (reported.has(d.package) || reported.has(d.module)) return;
    reported.add(d.module);
    sink?.note('python.missingModule', { module: d.module }, 'warn');
  } else if (d.type === 'package-failed') {
    sink?.note('python.packageFailed', { names: d.packages.join(', ') }, 'warn');
  } else if (d.type === 'no-input') {
    if (reported.has('<stdin>')) return;
    reported.add('<stdin>');
    sink?.note('python.noInput', {}, 'warn');
  }
}

// matplotlib figures go to the console; windows of tkinter and Qt need Kobra's GUI view, which comes later
// ("new" and "qt_new" create a widget; "reset" at the start of every run and the rest are ignored).
function handleGuiOps(json) {
  let ops;
  try { ops = JSON.parse(json); } catch { return; }
  for (const op of ops) {
    if (op[0] === 'mpl') {
      const n = (figures.get(op[1]) || 0) + 1;
      figures.set(op[1], n);
      if (n === 2 && !state.animating) setStatus(state.status, { animating: true });
      sink?.figure(op[1], op[2], op[3], op[4], op[5]);
    } else if (op[0] === 'mpl_closed') sink?.figureClosed?.(op[1]);
    else if ((op[0] === 'new' || op[0] === 'qt_new') && !shownGuiNote) {
      shownGuiNote = true;
      sink?.note('python.guiLater', {}, 'info');
    }
  }
}

// ------------------------------------------------------------------ offline copy
// The service worker keeps vendor/pyodide in its own cache "toollib-python-<version>", which survives app updates.
export const pythonCacheName = (info) => `toollib-python-${info.pyodide}`;
const storedNames = (info) => ['toollib-bundle.json', ...info.files.map((f) => f.name)];

// How much of Python is on this device: { stored, total, complete } in bytes.
export async function pythonStorage() {
  const info = await pythonBundle();
  let stored = 0;
  if ('caches' in self && (await caches.has(pythonCacheName(info)))) {   // open() would create it
    const cache = await caches.open(pythonCacheName(info));
    for (const f of info.files) if (await cache.match(pyUrl(f.name))) stored += f.size;
  }
  return { stored, total: info.total, complete: stored >= info.total };
}

// Loads every file once through the service worker, which stores it. onProgress(doneBytes, totalBytes).
export async function storePython(onProgress) {
  const info = await pythonBundle();
  if (!navigator.serviceWorker?.controller) throw new Error('no service worker');
  const cache = await caches.open(pythonCacheName(info));
  let done = 0;
  onProgress?.(0, info.total);
  for (const name of storedNames(info)) {
    const size = info.files.find((f) => f.name === name)?.size || 0;
    if (await cache.match(pyUrl(name))) { done += size; onProgress?.(done, info.total); continue; }
    const res = await fetch(pyUrl(name));
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const reader = res.body.getReader();
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      done += value.length;
      onProgress?.(Math.min(done, info.total), info.total);
    }
  }
  // The service worker writes each file into the cache right after sending it; give it a moment.
  for (let i = 0; i < 40; i++) {
    const s = await pythonStorage();
    if (s.complete) return s;
    await new Promise((r) => setTimeout(r, 250));
  }
  return pythonStorage();
}

export async function removePython() {
  const info = await pythonBundle();
  if (state.status !== 'off') stopPython({ quiet: true });
  await caches.delete(pythonCacheName(info));
}
