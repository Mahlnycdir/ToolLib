// Python service: started on first use. Output goes to the view that started the current run (its "sink").
// Taken from Kobra's Runner (runner.js); for Toollib: programs are snippets (code + definitions of needed snippets,
// or a check), texts via t(), a running animation can be stopped without restarting Python, and Python can be
// stored for offline use.
// Since 0.23.0 there is one Python for the whole app: this service and Kobra share one worker (python-host.js,
// kobra/worker.js). Messages of Kobra's runs (owner "kobra") are not for this service.
import { onWorker, postWorker, pyUrl, pythonBundle, restartWorker, startWorker, workerReady, workerToken } from './python-host.js';

export { pythonBundle };

const state = { status: 'off', python: '', version: '', error: '', sync: false, animating: false };
const listeners = new Set();
let sink = null;          // see ConsoleView: write, figure, figureClosed, progress, note, requestInput, done, started …
let runStart = 0;
let listening = null;
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

function listen() {
  if (!listening) listening = onWorker(onMessage);
}

export function startPython() {
  listen();
  if (!workerReady() && state.status !== 'loading') setStatus('loading');
  return startWorker().then((ok) => {
    if (!ok && state.status === 'loading') setStatus('error', { error: state.error || 'start' });
    return ok;
  });
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
  if (!ok) {
    if (state.status !== 'off') sink.done?.({ exit: 1, gui: false, failed: true }, 0);   // off: stopped while loading
    return;
  }
  runStart = performance.now();
  if (state.sync) navigator.serviceWorker?.controller?.postMessage({ type: 'clear-events', token: workerToken() });
  postWorker({ type: 'run-spec', id: Date.now(), spec });
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
// waits for it (its figures get a "close" event, as with Kobra's close button). Anything else restarts the one
// Python (Kobra's files come back into it by themselves).
export function stopPython({ quiet = false, force = false } = {}) {
  if (state.status === 'off' || state.status === 'error') return;
  if (state.status === 'live' && !force) {
    stoppingLive = true;
    postWorker({ type: 'stop-live' });
    if (!quiet) sink?.note('python.liveStopped', {}, 'info');
    return;
  }
  if (state.status === 'running' && state.animating && state.sync && !force) {
    if (stopTimer) return;
    const events = [...figures.keys()].map((key) => ({ k: 'close', w: key }));
    navigator.serviceWorker?.controller?.postMessage({ type: 'gui-events', token: workerToken(), events });
    if (!quiet) sink?.note('python.liveStopped', {}, 'info');
    // Still running a moment later (busy elsewhere): then Python has to start again after all.
    stopTimer = setTimeout(() => { stopTimer = null; if (state.status === 'running') stopPython({ quiet, force: true }); }, 1500);
    return;
  }
  clearTimeout(stopTimer);
  stopTimer = null;
  idleWaiters.splice(0).forEach((r) => r());
  sink?.cancelInput?.();
  sink?.progress?.(null);
  if (!quiet) sink?.note('python.stopped', {}, 'warn');
  setStatus('off');
  restartWorker('toollib');
}

export function detachSink(s) {
  if (sink === s) sink = null;
}
export const isSink = (s) => sink === s;

function replySync(id, value) {
  navigator.serviceWorker?.controller?.postMessage({ type: 'sync-reply', token: workerToken(), id, value: JSON.stringify({ v: value === undefined ? null : value }) });
}

async function onSyncRequest(id, kind) {
  let value = null;
  try {
    if (kind === 'stdin') value = sink ? await sink.requestInput() : null;
  } catch { value = null; }
  replySync(id, value);
}

function onMessage(msg) {
  if (msg.type === 'restart') {
    // Kobra restarted Python (Stop there): a run of ours ends with it
    if (msg.by !== 'toollib' && state.status !== 'off') {
      sink?.cancelInput?.();
      sink?.progress?.(null);
      if (state.status === 'running' || state.status === 'live') sink?.done?.({ exit: 1, gui: false, failed: true }, 0);
      idleWaiters.splice(0).forEach((r) => r());
      setStatus('off');
    }
    return;
  }
  if (msg.type === 'worker-error') {
    setStatus('error', { error: msg.message || 'worker error' });
    sink?.progress(null);
    sink?.note('python.err.worker', { detail: msg.message || '' }, 'warn');
    return;
  }
  if (msg.owner && msg.owner !== 'toollib') return;
  switch (msg.type) {
    case 'status':
      if (msg.state === 'ready' && msg.python) Object.assign(state, { sync: !!msg.sync, python: msg.python, version: msg.version });
      // a broadcast (loading, ready) while a run of ours goes on does not change our state
      if (!msg.owner && (state.status === 'running' || state.status === 'live') && msg.state !== 'ready') break;
      if (!msg.owner && msg.state === 'ready' && state.status !== 'loading' && state.status !== 'off' && state.status !== 'error') break;
      setStatus(msg.state);
      if (msg.state === 'loading') sink?.progress(msg.code, msg.vars);
      else sink?.progress(null);
      break;
    case 'fatal':
      setStatus('error', { error: msg.code });
      sink?.progress(null);
      sink?.note(msg.code || 'python.err.load', {}, 'warn');
      if (msg.detail) sink?.write(`${msg.detail}\n`, 'err');
      break;
    case 'progress': sink?.progress(msg.code, msg.vars); break;
    case 'stdout': sink?.write(msg.text, 'out'); break;
    case 'stderr':
      sink?.write(msg.text, 'err');
      // Pyodide has no threads (and asyncio.run needs stack switching, which not every browser has)
      if (!reported.has('<threads>') && /can't start new thread|stack switching not supported/.test(msg.text)) {
        reported.add('<threads>');
        sink?.note('python.desktopOnly', {}, 'warn');
      }
      break;
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
      // Windows (tkinter, Qt) keep a program alive even without figures: then Python starts again.
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

// matplotlib figures go to the console; windows of tkinter and Qt open in Kobra (the run panel offers that for code
// that imports them; "new" and "qt_new" create a widget; "reset" at the start of every run and the rest are ignored).
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
  if (state.status !== 'off') stopPython({ quiet: true, force: true });
  await caches.delete(pythonCacheName(info));
}
