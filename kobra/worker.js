// Kobra – Python-Worker (Modul-Worker). Laedt Pyodide, fuehrt Programme aus,
// beantwortet IntelliSense-Anfragen und verwaltet Pakete.
// Seit 0.23.0 der eine Python-Worker für ganz Toollib (app/services/python-host.js): Kobras Programme ("run",
// "repl") und Toollibs Snippets und Checks ("run-spec", aus app/services/python-worker.js übernommen) laufen
// im selben Pyodide. Nachrichten eines Laufs tragen owner: "kobra" oder "toollib"; ohne owner gehen sie an beide.
const PYODIDE_VERSION = '314.0.7';
// In Toollib: Python von Toollibs eigener Adresse (vendor/pyodide), kein fremder Server
let INDEX_URL = new URL('../vendor/pyodide/', self.location).href;
const HOME = '/home/pyodide';
const LIB = `${HOME}/.pyide/lib`;
const PROJECTS = `${HOME}/projects`;

let pyodide = null;
let rt = null;            // pyide_runtime
let gui = null;           // pyide_gui
let token = '';
let syncBase = '';
let syncAvailable = false;
let running = false;
let guiAlive = false;
let idleAbort = null;
let idleLooping = false;
let fallbackTimer = null;
let lockPackages = {};     // name -> true (im Pyodide-Repo vorhanden)
let importToPackage = {};  // Importname -> Paketname
let readyResolve;
const ready = new Promise(r => (readyResolve = r));
let toolsResolve;
const toolsReady = new Promise(r => (toolsResolve = r));
let currentProject = null;
let owner = 'kobra';       // wem der laufende oder letzte Lauf gehört
let guiOwner = 'kobra';    // wem die offenen Fenster und Animationen gehören
let snippets = null;      // toollib_snippets (Toollibs Snippets mit ihren Definitionen)
let bundled = new Set();  // Pakete, die Toollib in vendor/pyodide mitliefert
const TOOLLIB_RUN = `${HOME}/.toollib-run`;   // Arbeitsordner der Snippets, außerhalb von Kobras Projekten

// Nachrichten eines Laufs bekommen ihren owner; "result", "files" gehören immer Kobra; wer owner selbst setzt
// (auch ''), behält ihn.
const OWNED = new Set(['stdout', 'stderr', 'gui', 'notify', 'sync-req', 'run-done', 'gui-ended', 'live-stopped', 'status', 'progress']);
function post(msg, transfer) {
  if (!('owner' in msg)) {
    if (msg.type === 'result' || msg.type === 'files') msg = { ...msg, owner: 'kobra' };
    else if (OWNED.has(msg.type)) msg = { ...msg, owner };
  }
  self.postMessage(msg, transfer || []);
}

// ------------------------------------------------------------ Ausgabe
const decoderOut = new TextDecoder();
const decoderErr = new TextDecoder();
let outBuf = '', errBuf = '', lastFlush = 0;
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

// ------------------------------------------------- Synchroner Kanal (Service Worker)
let syncCounter = 0;
function busyWait(ms) { const end = Date.now() + ms; while (Date.now() < end) { /* warten */ } }

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
    try { xhr = syncXhr(`${syncBase}sync/${token}/${id}`); }
    catch (e) { busyWait(100); continue; }
    if (xhr.status === 200) return xhr.responseText;
    if (xhr.status === 204) continue;           // Zeitlimit, erneut warten
    if (xhr.status === 0) { busyWait(100); continue; }
    syncAvailable = false;                      // Kanal funktioniert nicht
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
  } catch (e) { /* ignorieren */ }
  return '[]';
}

function testSync() {
  try {
    const xhr = syncXhr(`${syncBase}ping/${token}`);
    return xhr.status === 200 && xhr.responseText === 'pong';
  } catch (e) { return false; }
}

// -------------------------------------------------------------- JS-Modul fuer Python
const jsModule = {
  send(opsJson) { flushOut(); post({ type: 'gui', ops: opsJson }); },
  has_sync() { return syncAvailable; },
  sync(kind, payload) {
    const res = syncRequest(kind, payload);
    if (res == null) return null;
    try { const v = JSON.parse(res); return v.v === undefined ? null : JSON.stringify(v.v); }
    catch (e) { return null; }
  },
  poll(waitMs) { return pollEvents(waitMs); },
  wake() { wakeIdle(); },
  notify(json) {
    let data = {};
    try { data = JSON.parse(json); } catch (e) { return; }
    if (data.type === 'files-maybe-changed') { if (owner === 'kobra') syncBackFiles(); return; }
    post({ type: 'notify', data });
  },
};

// ------------------------------------------------------------------- Start
async function boot(msg) {
  token = msg.token;
  syncBase = msg.syncBase;
  if (msg.indexURL) INDEX_URL = msg.indexURL;
  post({ type: 'status', state: 'loading', msg: 'Python wird geladen …', code: 'python.loading', owner: '' });
  let loadPyodide;
  try {
    ({ loadPyodide } = await import(`${INDEX_URL}pyodide.mjs`));
  } catch (e) {
    post({ type: 'fatal', msg: 'Python konnte nicht geladen werden. Beim ersten Start braucht die App Internet; danach läuft sie offline.', code: 'python.err.load', detail: String(e) });
    return;
  }
  try {
    pyodide = await loadPyodide({ indexURL: INDEX_URL, env: { HOME, PYTHONIOENCODING: 'utf-8' } });
  } catch (e) {
    post({ type: 'fatal', msg: 'Python konnte nicht gestartet werden.', code: 'python.err.load', detail: String(e) });
    return;
  }
  pyodide.setStdout(stdoutWriter);
  pyodide.setStderr(stderrWriter);
  syncAvailable = msg.useSync !== false && testSync();
  pyodide.setStdin({
    stdin: () => {
      if (!syncAvailable) {
        if (owner === 'toollib') { post({ type: 'notify', data: { type: 'no-input' } }); return null; }
        errBuf += '\n[input() braucht den Hintergrunddienst der App. Bitte die App einmal neu laden.]\n';
        flushOut();
        return null;
      }
      const res = syncRequest('stdin', '{}');
      if (res == null) return null;
      try { const v = JSON.parse(res).v; return v === null ? null : String(v); } catch (e) { return null; }
    },
  });
  pyodide.registerJsModule('pyide_js', jsModule);

  // Paketliste aus dem Lockfile
  try {
    const lock = pyodide._api?.lockfile_packages || pyodide.lockfile?.packages;
    const pkgs = lock || (await (await fetch(`${INDEX_URL}pyodide-lock.json`)).json()).packages;
    for (const [name, info] of Object.entries(pkgs)) {
      lockPackages[name.toLowerCase()] = true;
      for (const imp of info.imports || []) importToPackage[imp] = name;
    }
  } catch (e) { /* ohne Liste weiter */ }

  // eigene Python-Bibliothek (tkinter-/Qt-Nachbau, Laufzeit) und Toollibs Snippet-Helfer
  bundled = new Set(msg.bundled || []);
  try {
    const res = await fetch(msg.pyBundleURL);
    const bundle = await res.json();
    for (const [rel, content] of Object.entries(bundle.files)) {
      const path = `${LIB}/${rel}`;
      pyodide.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      pyodide.FS.writeFile(path, content);
    }
    if (msg.snippetsURL) pyodide.FS.writeFile(`${LIB}/toollib_snippets.py`, await (await fetch(msg.snippetsURL)).text());
  } catch (e) {
    post({ type: 'fatal', msg: 'Die Python-Hilfsdateien fehlen.', code: 'python.err.bundle', detail: String(e) });
    return;
  }
  pyodide.FS.mkdirTree(PROJECTS);
  pyodide.runPython(`import sys\nsys.path.insert(0, ${JSON.stringify(LIB)})\nimport pyide_runtime\npyide_runtime.setup()`);
  rt = pyodide.pyimport('pyide_runtime');
  gui = pyodide.pyimport('pyide_gui');
  if (msg.snippetsURL) snippets = pyodide.pyimport('toollib_snippets');
  pyodide.runPython(`import pyide_gui\npyide_gui._S.screen = (${msg.screen[0] | 0}, ${msg.screen[1] | 0})`);

  // vom Nutzer installierte Pakete wiederherstellen
  if (msg.packages && msg.packages.length) {
    post({ type: 'status', state: 'loading', msg: 'Pakete werden geladen …', code: 'python.loading', owner: '' });
    await installPackages(msg.packages, true);
  }
  readyResolve();
  post({ type: 'status', state: 'ready', sync: syncAvailable, version: pyodide.version, python: pyodide.runPython('import sys; sys.version.split()[0]'), owner: '' });
  loadTools();
}

// Pakete, die Kobra selbst nachlaedt (Pruefung, Formatierer) – nicht in der Paketliste zeigen
const toolPkgs = new Set();
async function installTool(name) {
  const before = new Set(Object.keys(listPackages()));
  const micropip = pyodide.pyimport('micropip');
  try { await micropip.install(name); }
  finally { for (const k of Object.keys(listPackages())) if (!before.has(k)) toolPkgs.add(k); }
}

async function loadTools() {
  try { await pyodide.loadPackage(['micropip', 'jedi'], { messageCallback: () => {}, errorCallback: () => {} }); }
  catch (e) { /* offline beim ersten Start */ }
  toolsResolve();
  post({ type: 'tools', jedi: hasModule('jedi'), owner: '' });
  try {
    if (!hasModule('pyflakes')) await installTool('pyflakes');
  } catch (e) { /* Pruefung ohne pyflakes: nur Syntaxfehler */ }
  post({ type: 'tools', jedi: hasModule('jedi'), pyflakes: hasModule('pyflakes'), relint: true, owner: '' });
}

function hasModule(name) {
  if (pyodide.loadedPackages[name]) return true;
  if (importToPackage[name] && !pyodide.loadedPackages[importToPackage[name]]) return false;
  try { return pyodide.runPython(`import importlib.util as u; u.find_spec(${JSON.stringify(name)}) is not None`); }
  catch (e) { return false; }
}

// ------------------------------------------------------------ Dateien
function projDir(project) { return `${PROJECTS}/${project}`; }

function writeProjectFiles(msg) {
  const dir = projDir(msg.project);
  if (msg.reset) {
    try { removeTree(dir); } catch (e) { /* neu */ }
  }
  pyodide.FS.mkdirTree(dir);
  const written = [];
  for (const f of msg.files || []) {
    const path = `${dir}/${f.path}`;
    pyodide.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    pyodide.FS.writeFile(path, f.data);
    written.push(f.path);
  }
  for (const p of msg.deleted || []) {
    try {
      const path = `${dir}/${p}`;
      const st = pyodide.FS.stat(path);
      if (pyodide.FS.isDir(st.mode)) removeTree(path); else pyodide.FS.unlink(path);
      written.push(p);
    } catch (e) { /* schon weg */ }
  }
  currentProject = msg.project;
  if (rt && written.length) {
    try { rt.note_written(JSON.stringify(written)); } catch (e) { /* egal */ }
  }
}

function removeTree(path) {
  const FS = pyodide.FS;
  const st = FS.stat(path);
  if (!FS.isDir(st.mode)) { FS.unlink(path); return; }
  for (const name of FS.readdir(path)) {
    if (name === '.' || name === '..') continue;
    removeTree(`${path}/${name}`);
  }
  FS.rmdir(path);
}

function syncBackFiles() {
  if (!rt || !currentProject) return;
  let res;
  try { res = JSON.parse(rt.changed_files()); } catch (e) { return; }
  if (!res.changed.length && !res.deleted.length) return;
  const dir = projDir(currentProject);
  const changed = [];
  const transfer = [];
  for (const p of res.changed) {
    try {
      const data = pyodide.FS.readFile(`${dir}/${p}`);
      changed.push({ path: p, data });
      transfer.push(data.buffer);
    } catch (e) { /* uebersprungen */ }
  }
  post({ type: 'files', project: currentProject, changed, deleted: res.deleted }, transfer);
}

// ------------------------------------------------------------ Pakete
function normName(n) { return String(n).trim().toLowerCase().replace(/_/g, '-'); }

async function installPackages(names, quiet) {
  const results = [];
  let micropip = null;
  for (const raw of names) {
    const name = String(raw).trim();
    if (!name) continue;
    const bare = normName(name.split(/[<>=!~\[ ]/)[0]);
    try {
      if (lockPackages[bare] || lockPackages[bare.replace(/-/g, '_')]) {
        await pyodide.loadPackage([bare], {
          messageCallback: m => { if (!quiet) post({ type: 'progress', msg: m, owner: 'kobra' }); },
          errorCallback: m => { if (!quiet) post({ type: 'progress', msg: m, owner: 'kobra' }); },
        });
      } else {
        if (!micropip) {
          await pyodide.loadPackage('micropip', { messageCallback: () => {} });
          micropip = pyodide.pyimport('micropip');
        }
        if (!quiet) post({ type: 'progress', msg: `Installiere ${name} von PyPI …`, owner: 'kobra' });
        await micropip.install(name);
      }
      results.push({ name, ok: true });
    } catch (e) {
      console.warn('pip', name, String(e));
      results.push({ name, ok: false, error: explainPipError(name, String(e)) });
    }
  }
  return results;
}

function explainPipError(name, msg) {
  if (/Can't find a pure Python 3 wheel|No matching distribution|wheel for/i.test(msg)) {
    return `„${name}“ enthält kompilierten Code und ist nicht für den Browser gebaut. Nur reine Python-Pakete und die vorkompilierten Pyodide-Pakete lassen sich installieren.`;
  }
  if (/No known package|404|Not Found|Can't fetch metadata/i.test(msg)) {
    return `Kein Paket namens „${name}“ auf PyPI gefunden. Schreibweise prüfen.`;
  }
  if (/NetworkError|Failed to fetch|Load failed/i.test(msg)) {
    return 'Keine Internetverbindung. Pakete lassen sich nur online installieren.';
  }
  const last = msg.trim().split('\n').pop();
  return last.length > 300 ? last.slice(0, 300) + '…' : last;
}

function listPackages() {
  try {
    return JSON.parse(pyodide.runPython(`
import json
try:
    import micropip
    _d = {k: {"v": str(v.version), "s": str(getattr(v, "source", ""))} for k, v in micropip.list().items()}
except Exception as _e:
    _d = {}
json.dumps(_d)`));
  } catch (e) { return {}; }
}

// ------------------------------------------------------------ Ausfuehren
async function loadImportsFor(project, entry) {
  let imports = [];
  try { imports = JSON.parse(rt.needed_imports(projDir(project), entry)); } catch (e) { imports = []; }
  const missing = [];
  for (const imp of imports) {
    const pkg = importToPackage[imp];
    if (pkg && !pyodide.loadedPackages[pkg] && !missing.includes(pkg)) missing.push(pkg);
  }
  if (!missing.length) return;
  post({ type: 'progress', msg: `Lade ${missing.join(', ')} …` });
  const failed = [];
  await pyodide.loadPackage(missing, {
    messageCallback: m => post({ type: 'progress', msg: m }),
    errorCallback: m => { failed.push(m); },
  }).catch(e => failed.push(String(e)));
  if (failed.length) {
    post({ type: 'stderr', text: `Einige Pakete konnten nicht geladen werden (${missing.filter(p => !pyodide.loadedPackages[p]).join(', ')}). Beim ersten Laden ist Internet nötig.\n` });
  }
}

// Ein neuer Lauf des anderen: dessen Fenster oder Animation endet (es gibt nur ein Python)
function takeOver(next) {
  if (guiAlive && guiOwner !== next) {
    post({ type: 'gui-ended', owner: guiOwner });
    post({ type: 'status', state: 'ready', owner: guiOwner });
  }
  owner = next;
}

async function doRun(msg) {
  await ready;
  stopIdle();
  takeOver('kobra');
  running = true;
  guiAlive = false;
  post({ type: 'status', state: 'running' });
  try {
    await loadImportsFor(msg.project, msg.entry);
  } catch (e) { /* weiter */ }
  let result = { gui: false, exit: 1 };
  try {
    result = JSON.parse(rt.run_file(projDir(msg.project), msg.entry, JSON.stringify(msg.argv || [])));
  } catch (e) {
    errBuf += String(e) + '\n';
  }
  flushOut();
  syncBackFiles();
  running = false;
  guiAlive = !!result.gui;
  guiOwner = 'kobra';
  post({ type: 'run-done', id: msg.id, result });
  post({ type: 'status', state: guiAlive ? 'gui' : 'ready' });
  if (guiAlive) startIdle();
}

// --------------------------------------------------- Toollibs Snippets (aus app/services/python-worker.js)
// spec: { name, code, deps: [[name, code], ...], check }. main.py in einem frischen Ordner ist genau der gezeigte
// Code (bearbeitet oder der Check); die nötigen Definitionen bietet toollib_snippets.py vorher an.
async function loadSnippetImports() {
  let imports = [];
  try { imports = JSON.parse(snippets.needed_imports()); } catch (e) { imports = []; }
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

async function doRunSpec(msg) {
  await ready;
  stopIdle();
  takeOver('toollib');
  running = true;
  guiAlive = false;
  post({ type: 'status', state: 'running' });
  let result = { gui: false, exit: 1 };
  try {
    pyodide.FS.chdir(HOME);   // der letzte Lauf ließ Python im Ordner, dann ließe er sich nicht entfernen
    try { removeTree(TOOLLIB_RUN); } catch (e) { /* noch nicht da */ }
    pyodide.FS.mkdirTree(TOOLLIB_RUN);
    snippets.prepare(JSON.stringify(msg.spec), TOOLLIB_RUN);
    const autos = JSON.parse(snippets.auto_imports());
    if (autos.length) post({ type: 'notify', data: { type: 'auto-imports', lines: autos } });
    await loadSnippetImports();
    if (snippets.define()) result = JSON.parse(rt.run_file(TOOLLIB_RUN, 'main.py', '[]'));
  } catch (e) {
    errBuf += `${e?.message || (e?.errno ? `file system error ${e.errno}` : e)}\n`;
  }
  flushOut();
  running = false;
  guiAlive = !!result.gui;
  guiOwner = 'toollib';
  post({ type: 'run-done', id: msg.id, result });
  post({ type: 'status', state: guiAlive ? 'live' : 'ready' });
  if (guiAlive) startIdle();
}

// Stopp, während eine Animation von Toollib läuft: alle offenen Abbildungen schließen, Python bleibt bereit.
function stopLive() {
  if (running || !pyodide) return;
  owner = guiOwner;
  try {
    pyodide.runPython('import pyide_mpl\nfor _f in list(pyide_mpl._live.values()):\n    pyide_mpl.close_figure(_f)\ndel _f');
  } catch (e) { /* nichts offen */ }
  flushOut();
  const alive = checkGuiAlive();
  if (!alive) stopIdle();
  post({ type: 'live-stopped', alive });
}

// Ereignisschleife, wenn das Skript fertig ist, aber Fenster offen sind
function stopIdle() {
  if (idleAbort) { idleAbort.abort(); idleAbort = null; }
  if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
}

function wakeIdle() {
  if (running) return;
  if (syncAvailable) { if (idleAbort) idleAbort.abort(); }
  else scheduleFallbackTick();
}

function startIdle() {
  if (syncAvailable) { if (!idleLooping) idleLoop(); }
  else scheduleFallbackTick();
}

async function idleLoop() {
  idleLooping = true;
  try {
    while (guiAlive && !running) {
      owner = guiOwner;
      let delay = -1;
      try { delay = gui.process_idle(); } catch (e) { /* weiter */ }
      flushOut();
      if (!checkGuiAlive()) break;
      const wait = delay < 0 ? 20000 : Math.min(delay, 20000);
      idleAbort = new AbortController();
      let evs = '[]';
      try {
        const res = await fetch(`${syncBase}events/${token}?wait=${wait}`, { signal: idleAbort.signal });
        evs = await res.text();
      } catch (e) { /* abgebrochen */ }
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
  try { alive = rt.gui_alive(); } catch (e) { alive = false; }
  if (!alive && guiAlive) {
    guiAlive = false;
    if (guiOwner === 'kobra') syncBackFiles();
    post({ type: 'status', state: 'ready', owner: guiOwner });
    post({ type: 'gui-ended', owner: guiOwner });
  }
  return alive;
}

function dispatchEvents(json) {
  if (!running) owner = guiOwner;
  try { gui.dispatch(json); } catch (e) { errBuf += String(e) + '\n'; }
  flushOut();
}

function scheduleFallbackTick() {
  if (fallbackTimer) clearTimeout(fallbackTimer);
  if (!running) owner = guiOwner;
  let delay = -1;
  try { delay = gui.process_idle(); } catch (e) { /* egal */ }
  flushOut();
  if (!checkGuiAlive()) return;
  if (delay >= 0) fallbackTimer = setTimeout(scheduleFallbackTick, delay);
}

// ---------------------------------------------------------- IntelliSense
const LSP = {
  complete: p => rt.complete(p.code, p.line, p.col, p.path, p.projectDir),
  info: p => rt.completion_info(p.index),
  signatures: p => rt.signatures(p.code, p.line, p.col, p.path, p.projectDir),
  help: p => rt.help_at(p.code, p.line, p.col, p.path, p.projectDir),
  goto: p => rt.goto(p.code, p.line, p.col, p.path, p.projectDir),
  references: p => rt.references(p.code, p.line, p.col, p.path, p.projectDir),
  lint: p => rt.lint(p.code, p.path),
  outline: p => rt.outline(p.code),
  format: p => rt.format_code(p.code),
};

async function handleLsp(msg) {
  await ready;
  const p = msg.params || {};
  if (p.project) {
    p.projectDir = projDir(p.project);
    p.path = `${p.projectDir}/${p.file || 'main.py'}`;
  }
  if (['complete', 'info', 'signatures', 'help', 'goto', 'references'].includes(msg.method)) {
    await Promise.race([toolsReady, new Promise(r => setTimeout(r, 50))]);
    if (!hasModuleCached('jedi')) { post({ type: 'result', id: msg.id, ok: true, value: msg.method === 'complete' ? [] : null }); return; }
  }
  if (msg.method === 'format' && !hasModuleCached('black')) {
    post({ type: 'progress', msg: 'Lade Formatierer (black) …', owner: 'kobra' });
    try {
      await installTool('black');
      moduleCache.black = true;
    } catch (e) {
      post({ type: 'result', id: msg.id, ok: false, error: 'Der Formatierer konnte nicht geladen werden (Internet nötig).' });
      return;
    }
  }
  try {
    const raw = LSP[msg.method](p);
    post({ type: 'result', id: msg.id, ok: true, value: raw == null ? null : JSON.parse(raw) });
  } catch (e) {
    post({ type: 'result', id: msg.id, ok: false, error: String(e) });
  }
}

const moduleCache = {};
function hasModuleCached(name) {
  if (moduleCache[name]) return true;
  const ok = hasModule(name);
  if (ok) moduleCache[name] = true;
  return ok;
}

// -------------------------------------------------------------- Nachrichten
self.onmessage = async (ev) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init': boot(msg); break;
    case 'sync-files': await ready; writeProjectFiles(msg); break;
    case 'run': doRun(msg); break;
    case 'run-spec': doRunSpec(msg); break;
    case 'stop-live': stopLive(); break;
    case 'repl': {
      await ready;
      if (running) { post({ type: 'result', id: msg.id, ok: false, error: 'busy' }); break; }
      takeOver('kobra');
      currentProject = msg.project || currentProject;
      try {
        if (msg.project) pyodide.runPython(`import os\nos.chdir(${JSON.stringify(projDir(msg.project))})`);
        await pyodide.loadPackagesFromImports(msg.code, { messageCallback: m => post({ type: 'progress', msg: m }), errorCallback: m => post({ type: 'progress', msg: m }) });
      } catch (e) { /* weiter */ }
      try {
        const r = rt.repl(msg.code);
        if (r && typeof r.then === 'function') { await r; r.destroy?.(); }
      } catch (e) { errBuf += String(e) + '\n'; }
      flushOut();
      syncBackFiles();
      post({ type: 'result', id: msg.id, ok: true });
      if (!guiAlive && rt.gui_alive()) { guiAlive = true; guiOwner = 'kobra'; post({ type: 'status', state: 'gui' }); startIdle(); }
      break;
    }
    case 'vars': {
      await ready;
      try { post({ type: 'result', id: msg.id, ok: true, value: JSON.parse(rt.variables()) }); }
      catch (e) { post({ type: 'result', id: msg.id, ok: false, error: String(e) }); }
      break;
    }
    case 'lsp': handleLsp(msg); break;
    case 'pip-install': {
      await ready;
      const res = await installPackages(msg.names, false);
      post({ type: 'result', id: msg.id, ok: true, value: res });
      break;
    }
    case 'pip-uninstall': {
      await ready;
      try {
        const micropip = pyodide.pyimport('micropip');
        micropip.uninstall(msg.name);
        post({ type: 'result', id: msg.id, ok: true });
      } catch (e) { post({ type: 'result', id: msg.id, ok: false, error: String(e) }); }
      break;
    }
    case 'pip-list': {
      await ready;
      await toolsReady;
      post({ type: 'result', id: msg.id, ok: true, value: { installed: listPackages(), tools: [...toolPkgs], available: Object.keys(lockPackages) } });
      break;
    }
    case 'gui-events': dispatchEvents(msg.events); if (!syncAvailable) scheduleFallbackTick(); break;
    case 'flush-files': syncBackFiles(); post({ type: 'result', id: msg.id, ok: true }); break;
    default: break;
  }
};
