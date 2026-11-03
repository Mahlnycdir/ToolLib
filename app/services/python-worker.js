// Python worker: loads Pyodide from Toollib's own server (vendor/pyodide), runs programs and keeps running
// matplotlib animations alive. Taken from Kobra's worker.js; changes for Toollib: Pyodide and the packages come
// from vendor/pyodide instead of a CDN, only the bundled packages are loaded, messages carry codes instead of
// German sentences (the page translates them), no editor tools yet (jedi, pyflakes, black come with the editor).
const HOME = '/home/pyodide';
const LIB = `${HOME}/.pyide/lib`;
const PROJECTS = `${HOME}/projects`;

let INDEX_URL = '';
let pyodide = null;
let rt = null;            // pyide_runtime (Kobra)
let gui = null;           // pyide_gui (Kobra)
let snippets = null;      // toollib_snippets
let token = '';
let syncBase = '';
let syncAvailable = false;
let running = false;
let guiAlive = false;
let idleAbort = null;
let idleLooping = false;
let fallbackTimer = null;
let bundled = new Set();   // packages shipped in vendor/pyodide
let importToPackage = {};  // import name -> package name (from the lock file)
let readyResolve;
const ready = new Promise((r) => (readyResolve = r));

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

// ------------------------------------------------------------ output
const decoderOut = new TextDecoder();
const decoderErr = new TextDecoder();
let outBuf = '';
let errBuf = '';
let lastFlush = 0;
function flushOut() {
  if (outBuf) { post({ type: 'stdout', text: outBuf }); outBuf = ''; }
  if (errBuf) { post({ type: 'stderr', text: errBuf }); errBuf = ''; }
  lastFlush = Date.now();
}
function maybeFlush() {
  if (Date.now() - lastFlush > 40 || outBuf.length + errBuf.length > 8192) flushOut();
}
const stdoutWriter = {
  write(buf) { if (errBuf) flushOut(); outBuf += decoderOut.decode(buf, { stream: true }); maybeFlush(); return buf.length; },
  isatty: false,
};
const stderrWriter = {
  write(buf) { if (outBuf) flushOut(); errBuf += decoderErr.decode(buf, { stream: true }); maybeFlush(); return buf.length; },
  isatty: false,
};

// ------------------------------------------------- synchronous channel (service worker), for input()
let syncCounter = 0;
function busyWait(ms) { const end = Date.now() + ms; while (Date.now() < end) { /* wait */ } }

function syncXhr(url) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.send();
  return xhr;
}

function syncRequest(kind, payload) {
  if (!syncAvailable) return null;
  flushOut();
  const id = `${Date.now().toString(36)}-${++syncCounter}`;
  post({ type: 'sync-req', id, kind, payload: typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}) });
  for (let attempt = 0; attempt < 100000; attempt++) {
    let xhr;
    try { xhr = syncXhr(`${syncBase}sync/${token}/${id}`); } catch { busyWait(100); continue; }
    if (xhr.status === 200) return xhr.responseText;
    if (xhr.status === 204) continue;          // time limit, wait again
    if (xhr.status === 0) { busyWait(100); continue; }
    syncAvailable = false;                     // the channel does not work
    post({ type: 'sync-lost' });
    return null;
  }
  return null;
}

function pollEvents(waitMs) {
  if (!syncAvailable) return '[]';
  flushOut();
  try {
    const xhr = syncXhr(`${syncBase}events/${token}?wait=${Math.max(0, waitMs | 0)}`);
    if (xhr.status === 200) return xhr.responseText || '[]';
  } catch { /* ignore */ }
  return '[]';
}

function testSync() {
  try {
    const xhr = syncXhr(`${syncBase}ping/${token}`);
    return xhr.status === 200 && xhr.responseText === 'pong';
  } catch { return false; }
}

// -------------------------------------------------------------- JS module for Python (Kobra's interface)
const jsModule = {
  send(opsJson) { flushOut(); post({ type: 'gui', ops: opsJson }); },
  has_sync() { return syncAvailable; },
  sync(kind, payload) {
    const res = syncRequest(kind, payload);
    if (res == null) return null;
    try { const v = JSON.parse(res); return v.v === undefined ? null : JSON.stringify(v.v); } catch { return null; }
  },
  poll(waitMs) { return pollEvents(waitMs); },
  wake() { wakeIdle(); },
  notify(json) {
    let data = {};
    try { data = JSON.parse(json); } catch { return; }
    if (data.type === 'files-maybe-changed') return;   // programs here work in a scratch folder
    post({ type: 'notify', data });
  },
};

// ------------------------------------------------------------------- start
async function boot(msg) {
  token = msg.token;
  syncBase = msg.syncBase;
  INDEX_URL = msg.indexURL;
  post({ type: 'status', state: 'loading', code: 'python.loading' });
  let loadPyodide;
  try {
    ({ loadPyodide } = await import(`${INDEX_URL}pyodide.mjs`));
    pyodide = await loadPyodide({ indexURL: INDEX_URL, env: { HOME, PYTHONIOENCODING: 'utf-8' } });
  } catch (e) {
    post({ type: 'fatal', code: 'python.err.load', detail: String(e) });
    return;
  }
  pyodide.setStdout(stdoutWriter);
  pyodide.setStderr(stderrWriter);
  syncAvailable = msg.useSync !== false && testSync();
  pyodide.setStdin({
    stdin: () => {
      if (!syncAvailable) {
        post({ type: 'notify', data: { type: 'no-input' } });
        return null;
      }
      const res = syncRequest('stdin', '{}');
      if (res == null) return null;
      try { const v = JSON.parse(res).v; return v === null ? null : String(v); } catch { return null; }
    },
  });
  pyodide.registerJsModule('pyide_js', jsModule);

  bundled = new Set(msg.bundled || []);
  try {
    const lock = pyodide._api?.lockfile_packages || pyodide.lockfile?.packages
      || (await (await fetch(`${INDEX_URL}pyodide-lock.json`)).json()).packages;
    for (const [name, info] of Object.entries(lock)) for (const imp of info.imports || []) importToPackage[imp] = name;
  } catch { /* without the list every import is treated as built in */ }

  // Kobra's Python library (runtime, matplotlib backend, tkinter and Qt replicas) and Toollib's snippet helper
  try {
    const bundle = await (await fetch(msg.pyBundleURL)).json();
    for (const [rel, content] of Object.entries(bundle.files)) writeFile(`${LIB}/${rel}`, content);
    writeFile(`${LIB}/toollib_snippets.py`, await (await fetch(msg.snippetsURL)).text());
  } catch (e) {
    post({ type: 'fatal', code: 'python.err.bundle', detail: String(e) });
    return;
  }
  pyodide.FS.mkdirTree(PROJECTS);
  pyodide.runPython(`import sys\nsys.path.insert(0, ${JSON.stringify(LIB)})\nimport pyide_runtime\npyide_runtime.setup()`);
  rt = pyodide.pyimport('pyide_runtime');
  gui = pyodide.pyimport('pyide_gui');
  snippets = pyodide.pyimport('toollib_snippets');
  pyodide.runPython(`import pyide_gui\npyide_gui._S.screen = (${msg.screen[0] | 0}, ${msg.screen[1] | 0})`);
  readyResolve();
  post({ type: 'status', state: 'ready', sync: syncAvailable, version: pyodide.version, python: pyodide.runPython('import sys; sys.version.split()[0]') });
}

function writeFile(path, content) {
  pyodide.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
  pyodide.FS.writeFile(path, content);
}

// ------------------------------------------------------------ packages
// Loads the packages the program and its definitions import, but only those Toollib ships; the rest are reported.
async function loadImports() {
  let imports = [];
  try { imports = JSON.parse(snippets.needed_imports()); } catch { imports = []; }
  const missing = [];
  const notShipped = [];
  for (const imp of imports) {
    const pkg = importToPackage[imp];
    if (!pkg || pyodide.loadedPackages[pkg]) continue;
    if (bundled.has(pkg)) { if (!missing.includes(pkg)) missing.push(pkg); } else if (!notShipped.includes(pkg)) notShipped.push(pkg);
  }
  if (notShipped.length) post({ type: 'notify', data: { type: 'not-bundled', packages: notShipped } });
  if (!missing.length) return;
  post({ type: 'progress', code: 'python.loadingPackages', vars: { names: missing.join(', ') } });
  const failed = [];
  await pyodide.loadPackage(missing, { messageCallback: () => {}, errorCallback: (m) => failed.push(m) }).catch((e) => failed.push(String(e)));
  if (failed.length) post({ type: 'notify', data: { type: 'package-failed', packages: missing.filter((p) => !pyodide.loadedPackages[p]), detail: failed[0] } });
  post({ type: 'progress', code: null });
}

// ------------------------------------------------------------ run
// spec: { name, code, deps: [[name, code], ...], check }. main.py in a fresh scratch folder is exactly the code
// shown (edited code or the check); the definitions it needs are offered beforehand (toollib_snippets.py).
async function doRun(msg) {
  await ready;
  stopIdle();
  running = true;
  guiAlive = false;
  post({ type: 'status', state: 'running' });
  const dir = `${PROJECTS}/run`;
  let result = { gui: false, exit: 1 };
  try {
    pyodide.FS.chdir(HOME);   // the last run left Python inside dir, which keeps it from being removed
    removeTree(dir);
    pyodide.FS.mkdirTree(dir);
    snippets.prepare(JSON.stringify(msg.spec), dir);
    await loadImports();
    if (snippets.define()) result = JSON.parse(rt.run_file(dir, 'main.py', '[]'));
  } catch (e) {
    errBuf += `${e?.message || (e?.errno ? `file system error ${e.errno}` : e)}\n`;
  }
  flushOut();
  running = false;
  guiAlive = !!result.gui;
  post({ type: 'run-done', id: msg.id, result });
  post({ type: 'status', state: guiAlive ? 'live' : 'ready' });
  if (guiAlive) startIdle();
}

function removeTree(path) {
  const FS = pyodide.FS;
  let st;
  try { st = FS.stat(path); } catch { return; }
  if (!FS.isDir(st.mode)) { FS.unlink(path); return; }
  for (const name of FS.readdir(path)) if (name !== '.' && name !== '..') removeTree(`${path}/${name}`);
  FS.rmdir(path);
}

// Event loop after the script ended while figures (animations) or windows are still open (Kobra).
function stopIdle() {
  if (idleAbort) { idleAbort.abort(); idleAbort = null; }
  if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
}

function wakeIdle() {
  if (running) return;
  if (syncAvailable) { if (idleAbort) idleAbort.abort(); } else scheduleFallbackTick();
}

function startIdle() {
  if (syncAvailable) { if (!idleLooping) idleLoop(); } else scheduleFallbackTick();
}

async function idleLoop() {
  idleLooping = true;
  try {
    while (guiAlive && !running) {
      let delay = -1;
      try { delay = gui.process_idle(); } catch { /* go on */ }
      flushOut();
      if (!checkGuiAlive()) break;
      const wait = delay < 0 ? 20000 : Math.min(delay, 20000);
      idleAbort = new AbortController();
      let evs = '[]';
      try {
        const res = await fetch(`${syncBase}events/${token}?wait=${wait}`, { signal: idleAbort.signal });
        evs = await res.text();
      } catch { /* aborted */ }
      idleAbort = null;
      if (running) break;
      if (evs && evs !== '[]') dispatchEvents(evs);
      if (!checkGuiAlive()) break;
    }
  } finally {
    idleLooping = false;
  }
}

function checkGuiAlive() {
  let alive = false;
  try { alive = rt.gui_alive(); } catch { alive = false; }
  if (!alive && guiAlive) {
    guiAlive = false;
    post({ type: 'status', state: 'ready' });
    post({ type: 'gui-ended' });
  }
  return alive;
}

function dispatchEvents(json) {
  try { gui.dispatch(json); } catch (e) { errBuf += `${e}\n`; }
  flushOut();
}

function scheduleFallbackTick() {
  if (fallbackTimer) clearTimeout(fallbackTimer);
  let delay = -1;
  try { delay = gui.process_idle(); } catch { /* ignore */ }
  flushOut();
  if (!checkGuiAlive()) return;
  if (delay >= 0) fallbackTimer = setTimeout(scheduleFallbackTick, delay);
}

// Stop pressed while an animation runs: close every live figure; Python stays ready for the next run.
function stopLive() {
  if (running || !pyodide) return;
  try {
    pyodide.runPython('import pyide_mpl\nfor _f in list(pyide_mpl._live.values()):\n    pyide_mpl.close_figure(_f)\ndel _f');
  } catch { /* nothing open */ }
  flushOut();
  const alive = checkGuiAlive();
  if (!alive) stopIdle();
  post({ type: 'live-stopped', alive });
}

// -------------------------------------------------------------- messages
self.onmessage = async (ev) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init': boot(msg); break;
    case 'run': doRun(msg); break;
    case 'gui-events': dispatchEvents(msg.events); if (!syncAvailable) scheduleFallbackTick(); break;
    case 'stop-live': stopLive(); break;
    default: break;
  }
};
