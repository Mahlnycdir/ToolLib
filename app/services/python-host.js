// One Python for the whole app (0.23.0): a single worker (kobra/worker.js) that Toollib's Python service
// (python.js: "Run" in the cheatsheet, checks, plots in a page) and Kobra's Runner share. Pyodide loads once.
//
// Every message from the worker goes to every listener. Messages that belong to a run carry its owner
// ("toollib" or "kobra"); each side takes its own and the ones without an owner (loading, ready, tools).
// A restart (Stop in Kobra, a stuck program) is announced as { type: 'restart', by }, then Python loads again.

import { t } from '../i18n/i18n.js';

const PYODIDE = 'vendor/pyodide/';
// texts the worker shows itself (Kobra's console and packages), in the language of the app
const WORKER_TEXTS = ['loading', 'loadFailed', 'startFailed', 'inputNeedsSync', 'helpersMissing', 'packagesLoading', 'installing',
  'compiled', 'noSuchPackage', 'offline', 'loadingPkgs', 'someFailed', 'formatterLoading', 'formatterFailed'];
const base = () => new URL('./', document.baseURI);
export const pyUrl = (name) => new URL(`${PYODIDE}${name}`, base()).href;

let worker = null;
let token = '';
let startPromise = null;
let readyResolve = null;
let bundle = null;
let lastReady = null;     // the last "ready" message, for a side that comes later (Kobra opened after a run)
let lastTools = null;     // the last "tools" message (jedi, pyflakes), likewise
const listeners = new Set();

export const workerToken = () => token;
export const workerAlive = () => !!worker;
export const workerReady = () => !!lastReady;
export const workerSync = () => !!lastReady?.sync;

// What Toollib ships: Pyodide and Python version, packages and every file with its size.
export async function pythonBundle() {
  if (!bundle) {
    const res = await fetch(pyUrl('toollib-bundle.json'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bundle = await res.json();
  }
  return bundle;
}

// fn(msg) for every message; a late listener gets "ready" and "tools" again at once. Returns: stop listening.
export function onWorker(fn, { replay = true } = {}) {
  listeners.add(fn);
  if (replay) {
    if (lastReady) queueMicrotask(() => listeners.has(fn) && fn(lastReady));
    if (lastTools) queueMicrotask(() => listeners.has(fn) && fn(lastTools));
  }
  return () => listeners.delete(fn);
}

function emit(msg) {
  for (const fn of [...listeners]) {
    try { fn(msg); } catch (e) { console.error(e); }
  }
}

const readJson = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
};

// Starts the worker unless it runs; resolves to true once Python is ready (false if it could not start).
export function startWorker() {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    const info = await pythonBundle();
    token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    worker = new Worker(new URL('kobra/worker.js', base()), { type: 'module', name: 'python' });
    worker.onmessage = (e) => onMessage(e.data);
    worker.onerror = (e) => {
      emit({ type: 'worker-error', message: e.message || '' });
      readyResolve?.(false);
      readyResolve = null;
    };
    const ready = new Promise((r) => { readyResolve = r; });
    worker.postMessage({
      type: 'init',
      token,
      // the service worker answers input() and window events here (sw.js)
      syncBase: new URL('__toollib__/', base()).href,
      indexURL: pyUrl(''),
      pyBundleURL: new URL(`vendor/py-bundle.json?v=${info.pyodide}`, base()).href,
      snippetsURL: new URL('app/services/toollib_snippets.py', base()).href,
      bundled: info.packages,
      // packages you installed in Kobra (PyPI or Pyodide) come back with every start
      packages: readJson('kobra.packages', []),
      screen: [window.innerWidth, window.innerHeight],
      texts: Object.fromEntries(WORKER_TEXTS.map((k) => [k, t(`kobra.worker.${k}`)])),
      useSync: !!navigator.serviceWorker?.controller && readJson('toollib.python.sync', true) !== false,
    });
    return ready;
  })().catch((e) => {
    startPromise = null;
    emit({ type: 'fatal', code: 'python.err.load', msg: '', detail: String(e) });
    return false;
  });
  return startPromise;
}

function onMessage(msg) {
  if (msg.type === 'status' && msg.state === 'ready' && msg.python) {
    lastReady = msg;
    readyResolve?.(true);
    readyResolve = null;
  } else if (msg.type === 'tools') {
    lastTools = msg;
  } else if (msg.type === 'fatal') {
    worker?.terminate();
    worker = null;
    startPromise = null;
    lastReady = null;
    readyResolve?.(false);
    readyResolve = null;
  }
  emit(msg);
}

export function postWorker(msg, transfer) {
  worker?.postMessage(msg, transfer || []);
}

// Ends the worker (a program that does not stop, Stop in Kobra) and starts Python again from the cache.
// by: "toollib" or "kobra", so that side knows it asked for it.
export function restartWorker(by) {
  worker?.terminate();
  worker = null;
  startPromise = null;
  lastReady = null;
  lastTools = null;
  readyResolve?.(false);
  readyResolve = null;
  emit({ type: 'restart', by });
  return startWorker();
}
