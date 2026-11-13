// Kobra – Python-IDE fuer das iPhone. Hauptsteuerung.
// Seit 0.22.0 ein Werkzeug in Toollib: app/shell/kobra-view.js legt die Wurzel einmal an (markup.js) und ruft
// mountKobra(root); beim Wechsel zu einem anderen Werkzeug bleibt Kobra stehen (Dateien, Konsole, laufendes Python)
// und ist nur ausgeblendet. Tasten wirken nur, solange Kobra zu sehen ist.
import { h, esc, toast, modal, promptDialog, confirmDialog, actionSheet, openSheet, tapKeepFocus, debounce,
  loadPref, savePref, shareOrDownload, pickFiles, formatBytes, closeTopModal } from './ui.js';
import { icon } from './icons.js';
import * as store from './storage.js';
import { CodeEditor } from './editor.js';
import { ConsoleView, Runner } from './runner.js';
import { GuiManager } from './gui.js';
import { PackagePanel } from './packages.js';
import { GitService, GitPanel, explainGitError } from './git.js';
import { MAIN, accounts, account, accountLabel, saveAccount, removeAccount, newAccountId, checkToken, repos, repoKey, forgetRepo } from './accounts.js';
import { SNIPPET_GROUPS } from './snippets.js';
import { renderSpickzettel } from './spickzettel.js';

const VERSION = '1.0.0';
let root = null;       // Kobras Wurzel in Toollibs Arbeitsfläche
let active = false;    // gerade zu sehen
const $ = (sel) => root?.querySelector(sel) || document.querySelector(sel);

const state = {
  project: null,
  tree: [],
  tabs: [],
  active: null,
  view: 'code',
  side: 'files',
  expanded: new Set(loadPref('expanded', [])),
  runnerState: 'off',
  guiOpen: false,
  diagnostics: [],
};

const settings = {
  theme: loadPref('theme', 'auto'),
  fontSize: loadPref('fontSize', 15),
  wrap: loadPref('wrap', false),
  autosave: loadPref('autosave', true),
};

let editor, consoleView, runner, gui, packages, gitPanel;
const gitService = new GitService();
const isWide = () => window.matchMedia('(min-width: 900px)').matches;

// ============================================================== Start
async function main(host) {
  root = host;
  buildShell();
  applyTheme();
  setupViewport();
  // Toollib hat den Service Worker schon angemeldet; Hell und Dunkel kommen von Toollib
  new MutationObserver(() => applyTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  store.requestPersist();

  consoleView = new ConsoleView($('#console-body'), {
    onOpenFile: (file, line) => openFile(file, { line }),
    onInstall: (pkg) => { packages.install([pkg]); showView('packages'); },
    onRepl: (code) => runRepl(code),
  });

  gui = new GuiManager($('#gui-layer'), {
    sendEvent: (ev) => runner.sendGuiEvent(ev),
    onWindowsChanged: (count, visible) => {
      state.guiOpen = count > 0;
      const pill = $('#gui-pill');
      pill.hidden = !(count > 0 && !visible);
      pill.querySelector('span').textContent = count === 1 ? '1 Fenster' : `${count} Fenster`;
      updateRunButton();
    },
    fileProvider: () => state.tree,
    onStop: () => stopProgram(),
  });

  runner = new Runner({
    console: consoleView,
    gui,
    onStatus: onRunnerStatus,
    onFiles: onProgramFiles,
    onTools: (t) => { if (t.jedi || t.relint) editor?.relint(); },
    onRestart: () => { syncProjectToWorker(true); },
    onRunDone: () => { refreshTree(); },
  });

  editor = new CodeEditor($('#editor'), {
    lsp: (method, params, timeout) => runner.lsp(method, params, timeout),
    onDocChange: onDocChange,
    onSave: () => saveAll(true),
    onRun: () => runCurrent(),
    onSignature: renderSignature,
    getContext: () => ({ project: state.project, file: state.active }),
  });
  editor.onDiagnostics = (n, list) => { state.diagnostics = list; updateProblemsBadge(n, list); };
  editor.configure({ dark: isDark(), size: settings.fontSize, wrap: settings.wrap });

  window.kobra = { get gui() { return gui; }, get runner() { return runner; }, get editor() { return editor; }, state };
  packages = new PackagePanel($('#packages-body'), runner);
  packages.onRequirements = installRequirements;
  gitPanel = new GitPanel($('#git-body'), {
    service: gitService,
    getProject: () => state.project,
    onFilesChanged: async () => { await refreshTree(); await reloadOpenFiles(); syncProjectToWorker(true); },
    openSettings: (section) => openSettings(section),
    onProjectsChanged: async (name) => { await openProject(name); showView('files'); },
  });

  // Erstes Projekt
  const projects = await store.listProjects();
  if (!projects.length) await createWelcomeProject();
  const last = loadPref('project', null);
  const list = await store.listProjects();
  const pick = list.find(p => p.name === last) ? last : list[0]?.name;
  await openProject(pick);
  showView(loadPref('view', 'code'));
  openRequested();

  await waitForController(4000);
  runner.start({ packages: PackagePanel.wanted(), version: VERSION });
  syncProjectToWorker(true);
}

async function waitForController(ms) {
  if (!('serviceWorker' in navigator)) return;
  if (navigator.serviceWorker.controller) return;
  await Promise.race([
    new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true })),
    new Promise(r => setTimeout(r, ms)),
  ]);
}



// ============================================================ Grundgeruest
function buildShell() {
  const nav = [
    ['files', 'files', 'Dateien'], ['code', 'code', 'Code'], ['console', 'terminal', 'Konsole'],
    ['packages', 'package', 'Pakete'], ['git', 'git', 'Git'],
  ];
  const navEl = $('#nav');
  for (const [view, ic, label] of nav) {
    const b = h('button', { class: 'nav-btn', type: 'button', dataset: { view }, html: `${icon(ic)}<span>${label}</span><i class="badge-dot" hidden></i>` });
    b.addEventListener('click', () => showView(view));
    navEl.append(b);
  }
  $('#btn-projects').innerHTML = icon('folder');
  $('#btn-projects').addEventListener('click', () => openProjectsSheet());
  $('#btn-blocks').innerHTML = icon('blocks');
  $('#btn-blocks').addEventListener('click', () => openSnippets());
  $('#btn-more').innerHTML = icon('more');
  $('#btn-more').addEventListener('click', () => moreMenu());
  $('#btn-run').addEventListener('click', () => {
    if (state.runnerState === 'running' || (state.runnerState === 'gui')) stopProgram();
    else runCurrent();
  });
  $('#btn-run').addEventListener('contextmenu', (e) => { e.preventDefault(); runMenu(); });
  let pressTimer;
  $('#btn-run').addEventListener('touchstart', () => { pressTimer = setTimeout(() => { pressTimer = null; runMenu(); }, 550); }, { passive: true });
  $('#btn-run').addEventListener('touchend', (e) => { if (pressTimer === null) e.preventDefault(); clearTimeout(pressTimer); });
  $('#gui-pill').innerHTML = `${icon('window')}<span>Fenster</span>`;
  $('#gui-pill').addEventListener('click', () => gui.show());
  updateRunButton();
  buildFilesToolbar();
  buildConsoleToolbar();
  buildKeybar();
  window.addEventListener('beforeunload', () => { saveAll(false); });
  window.addEventListener('pagehide', () => { saveAll(false).then(() => store.flush()); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveAll(false).then(() => store.flush()); });
  window.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.key === 'Escape' && closeTopModal()) e.preventDefault();
    if (e.key.toLowerCase() === 'j' && (e.metaKey || e.ctrlKey) && !e.altKey) { e.preventDefault(); openSnippets(); }
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
  window.matchMedia('(min-width: 900px)').addEventListener?.('change', () => showView(state.view));
}

function showView(view) {
  const app = root;
  if (isWide() && ['files', 'packages', 'git'].includes(view)) {
    state.side = view;
    app.dataset.side = view;
  }
  if (!isWide() || ['code', 'console'].includes(view)) {
    state.view = view;
    app.dataset.view = view;
  } else {
    state.view = 'code';
    app.dataset.view = 'code';
  }
  if (!app.dataset.side) app.dataset.side = 'files';
  savePref('view', state.view);
  for (const b of root.querySelectorAll('.nav-btn')) {
    const v = b.dataset.view;
    b.classList.toggle('on', isWide() ? v === state.side : v === view);
  }
  if (view === 'packages') packages.refresh();
  if (view === 'git') gitPanel.refresh();
  if (view === 'console') setTimeout(() => consoleView.scroll(true), 30);
  if (view === 'code') setTimeout(() => editor?.view.requestMeasure(), 30);
  if (view === 'console' || (isWide())) $('#nav [data-view="console"] .badge-dot').hidden = true;
}

// --------------------------------------------------------- Theme / Viewport
// Hell oder dunkel bestimmt Toollib (Einstellungen › Aussehen); Kobra folgt (0.22.0).
function isDark() {
  return document.documentElement.dataset.theme === 'dark';
}

function applyTheme() {
  editor?.configure({ dark: isDark() });
}

function setupViewport() {
  const vv = window.visualViewport;
  // In Toollib setzt der Rahmen --app-h und schiebt die App mit der Tastatur; Kobra merkt sich nur, ob sie offen ist
  // (body.kb-open für die Leiste unten). Nur bei einer Änderung setzen: die Ereignisse kommen beim Gleiten des
  // iPhones viele Male in der Sekunde (0.23.1).
  let was = null;
  const sync = () => {
    const kb = vv ? window.innerHeight - vv.height > 140 : false;
    if (kb !== was) document.body.classList.toggle('kb-open', kb);
    was = kb;
  };
  sync();
  vv?.addEventListener('resize', sync);
  vv?.addEventListener('scroll', sync);
  window.addEventListener('resize', sync);
  // iOS: Seite nicht verschieben
  window.addEventListener('scroll', () => { if (active && window.scrollY && !document.body.classList.contains('kb-open')) window.scrollTo(0, 0); });
}

// ============================================================== Projekte
async function createWelcomeProject() {
  const dir = await store.createProject('Erste Schritte', 'hallo');
  const files = {
    'README.md': `# Willkommen bei Kobra\n\nEine Python-IDE, die komplett auf deinem iPhone läuft.\n\n- **▶** führt die geöffnete Datei aus (lange drücken für mehr Optionen)\n- **Bausteine** (Leiste über der Tastatur) fügen if/for/def/class & Co. ein\n- Vervollständigung erscheint beim Tippen, Signaturen beim Öffnen einer Klammer\n- \`tk_demo.py\` und \`qt_demo.py\` zeigen den GUI-Emulator\n- \`plot_demo.py\` zeichnet mit numpy und matplotlib\n- Im Bereich **Git** speicherst du Stände und gleichst mit GitHub ab\n`,
    'tk_demo.py': store.TEMPLATES.tkinter.files['main.py'],
    'qt_demo.py': store.TEMPLATES.pyqt.files['main.py'],
    'plot_demo.py': `import numpy as np\nimport matplotlib.pyplot as plt\n\nx = np.linspace(0, 4 * np.pi, 400)\nfor n in range(1, 4):\n    plt.plot(x, np.sin(n * x) / n, label=f"sin({n}x)/{n}")\nplt.legend()\nplt.title("Ein paar Obertöne")\nplt.grid(alpha=0.3)\nplt.show()\n`,
    'animation_demo.py': store.TEMPLATES.tkinter ? `import tkinter as tk\n\nroot = tk.Tk()\nroot.title("Ball")\ncanvas = tk.Canvas(root, width=320, height=220, bg="white")\ncanvas.pack()\nball = canvas.create_oval(10, 10, 40, 40, fill="tomato", outline="")\ndx, dy = 4, 3\n\n\ndef schritt():\n    global dx, dy\n    x1, y1, x2, y2 = canvas.coords(ball)\n    if x1 + dx < 0 or x2 + dx > 320:\n        dx = -dx\n    if y1 + dy < 0 or y2 + dy > 220:\n        dy = -dy\n    canvas.move(ball, dx, dy)\n    root.after(16, schritt)\n\n\ndef ziehen(event):\n    canvas.coords(ball, event.x - 15, event.y - 15, event.x + 15, event.y + 15)\n\n\ncanvas.bind("<B1-Motion>", ziehen)\nschritt()\nroot.mainloop()\n` : '',
  };
  for (const [p, c] of Object.entries(files)) await store.writeFile(`${dir}/${p}`, c);
  savePref('tabs.Erste Schritte', ['main.py', 'README.md']);
}

async function openProject(name) {
  if (!name) return;
  await saveAll(false);
  for (const t of state.tabs) editor?.close(t);
  state.project = name;
  savePref('project', name);
  $('#proj-name').textContent = name;
  await refreshTree();
  state.tabs = loadPref(`tabs.${name}`, []).filter(p => state.tree.some(f => f.path === p && f.type === 'file'));
  const active = loadPref(`active.${name}`, null);
  state.active = null;
  renderTabs();
  const first = state.tabs.includes(active) ? active : (state.tabs[0] || state.tree.find(f => f.path === 'main.py')?.path || state.tree.find(f => f.type === 'file' && f.path.endsWith('.py'))?.path);
  if (first) await openFile(first, { noView: true });
  else showEmptyEditor();
  syncProjectToWorker(true);
  if (state.side === 'git') gitPanel.refresh();
}

async function refreshTree() {
  if (!state.project) return;
  state.tree = await store.listTree(store.projectPath(state.project));
  renderTree();
}

function projectDir() { return store.projectPath(state.project); }

async function syncProjectToWorker(reset) {
  // Der Worker puffert Nachrichten, bis Python bereit ist – daher kein Warten noetig.
  if (!runner?.worker || !state.project) return;
  const files = [];
  for (const f of state.tree) {
    if (f.type !== 'file' || f.size > 30 * 1024 * 1024) continue;
    const content = editor?.has(f.path) && editor.isDirty(f.path) ? editor.content(f.path) : await store.readBytes(`${projectDir()}/${f.path}`);
    files.push({ path: f.path, data: content });
  }
  runner.syncFiles(state.project, files, [], reset);
}

// Dateien, die das Programm geschrieben hat
async function onProgramFiles(project, changed, deleted) {
  if (project !== state.project) return;
  const dir = projectDir();
  for (const f of changed) {
    await store.writeFile(`${dir}/${f.path}`, f.data, { noFlush: true });
    if (editor.has(f.path) && !editor.isDirty(f.path) && store.isTextFile(f.path)) {
      editor.replaceContent(f.path, new TextDecoder().decode(f.data));
    }
  }
  for (const p of deleted) await store.rmrf(`${dir}/${p}`);
  await store.flush();
  if (changed.length || deleted.length) {
    await refreshTree();
    const names = changed.map(f => f.path).slice(0, 3).join(', ');
    if (changed.length) consoleView.info(`Gespeichert: ${names}${changed.length > 3 ? ` und ${changed.length - 3} weitere` : ''}`, 'ok');
  }
}

// ============================================================== Dateibaum
function buildFilesToolbar() {
  const bar = $('#files-toolbar');
  const btn = (ic, label, fn) => {
    const b = h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, html: icon(ic) });
    b.addEventListener('click', fn);
    return b;
  };
  bar.append(
    btn('plus', 'Neue Datei', () => newFile('')),
    btn('folder', 'Neuer Ordner', () => newFolder('')),
    btn('upload', 'Dateien importieren', () => importFiles('')),
    btn('search', 'In Dateien suchen', () => findInFiles()),
    btn('more', 'Projekt', () => projectMenu()),
  );
}

function renderTree() {
  const el = $('#tree');
  el.textContent = '';
  if (!state.tree.length) {
    el.append(h('p', { class: 'empty', text: 'Leeres Projekt. Lege mit + eine Datei an.' }));
    return;
  }
  const byDir = new Map();
  for (const f of state.tree) {
    const d = store.dirname(f.path);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(f);
  }
  const startFile = loadPref(`main.${state.project}`, 'main.py');
  const render = (dir, depth, container) => {
    const items = (byDir.get(dir) || []).slice().sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path, 'de', { numeric: true }) : a.type === 'dir' ? -1 : 1));
    for (const f of items) {
      const name = store.basename(f.path);
      const row = h('div', { class: `tree-row${f.path === state.active ? ' on' : ''}`, role: 'treeitem', style: { paddingLeft: `${10 + depth * 16}px` } });
      if (f.type === 'dir') {
        const open = state.expanded.has(f.path);
        row.innerHTML = `${icon(open ? 'chevronDown' : 'chevronRight', 'tree-chev')}${icon(open ? 'folderOpen' : 'folder', 'tree-ic dir')}<span class="tree-name"></span>`;
        row.querySelector('.tree-name').textContent = name;
        row.addEventListener('click', () => {
          if (open) state.expanded.delete(f.path); else state.expanded.add(f.path);
          savePref('expanded', [...state.expanded]);
          renderTree();
        });
      } else {
        const py = name.endsWith('.py');
        row.innerHTML = `<span class="tree-chev-space"></span>${icon(py ? 'py' : 'file', `tree-ic ${py ? 'py' : ''}`)}<span class="tree-name"></span>${f.path === startFile ? '<span class="tree-tag">Start</span>' : ''}<span class="tree-size"></span>`;
        row.querySelector('.tree-name').textContent = name;
        row.querySelector('.tree-size').textContent = formatBytes(f.size || 0);
        row.addEventListener('click', () => openFile(f.path));
      }
      const more = h('button', { class: 'icon-btn small tree-more', type: 'button', 'aria-label': `Aktionen für ${name}`, html: icon('more') });
      more.addEventListener('click', (e) => { e.stopPropagation(); fileMenu(f); });
      row.append(more);
      let pt;
      row.addEventListener('touchstart', () => { pt = setTimeout(() => { pt = null; fileMenu(f); }, 550); }, { passive: true });
      row.addEventListener('touchmove', () => clearTimeout(pt), { passive: true });
      row.addEventListener('touchend', (e) => { if (pt === null) e.preventDefault(); clearTimeout(pt); });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); fileMenu(f); });
      container.append(row);
      if (f.type === 'dir' && state.expanded.has(f.path)) render(f.path, depth + 1, container);
    }
  };
  render('', 0, el);
}

async function fileMenu(f) {
  const isDir = f.type === 'dir';
  const items = isDir
    ? [{ label: 'Neue Datei hier', icon: 'plus', value: 'newfile' }, { label: 'Neuer Ordner hier', icon: 'folder', value: 'newdir' }, { label: 'Dateien hierher importieren', icon: 'upload', value: 'import' }, '-',
      { label: 'Umbenennen / verschieben', icon: 'edit', value: 'rename' }, { label: 'Löschen', icon: 'trash', value: 'delete', danger: true }]
    : [{ label: 'Öffnen', icon: 'code', value: 'open' }, ...(f.path.endsWith('.py') ? [{ label: 'Ausführen', icon: 'play', value: 'run' }, { label: 'Als Startdatei festlegen', icon: 'check', value: 'main' }] : []), '-',
      { label: 'Umbenennen / verschieben', icon: 'edit', value: 'rename' }, { label: 'Duplizieren', icon: 'copy', value: 'dup' }, { label: 'Teilen / sichern', icon: 'download', value: 'share' },
      { label: 'Löschen', icon: 'trash', value: 'delete', danger: true }];
  const v = await actionSheet(f.path, items);
  if (!v) return;
  const dir = projectDir();
  try {
    if (v === 'open') openFile(f.path);
    else if (v === 'run') { await openFile(f.path, { noView: true }); runCurrent(); }
    else if (v === 'main') { savePref(`main.${state.project}`, f.path); renderTree(); toast(`${f.path} ist jetzt die Startdatei`, 'ok'); }
    else if (v === 'newfile') newFile(f.path);
    else if (v === 'newdir') newFolder(f.path);
    else if (v === 'import') importFiles(f.path);
    else if (v === 'rename') {
      const to = await promptDialog(isDir ? 'Ordner umbenennen' : 'Datei umbenennen', { label: 'Neuer Pfad im Projekt', value: f.path, validate: (s) => validPath(s, f.path) });
      if (!to || to === f.path) return;
      await saveAll(false);
      await store.move(`${dir}/${f.path}`, `${dir}/${to}`);
      for (const t of [...state.tabs]) {
        if (t === f.path || t.startsWith(f.path + '/')) {
          const nt = to + t.slice(f.path.length);
          editor.rename(t, nt);
          state.tabs[state.tabs.indexOf(t)] = nt;
          if (state.active === t) state.active = nt;
        }
      }
      persistTabs();
      runner.syncFiles(state.project, [], [f.path]);
      await refreshTree();
      renderTabs();
      syncProjectToWorker(false);
    } else if (v === 'dup') {
      const ext = f.path.match(/(\.[^./]+)$/)?.[1] || '';
      const base = ext ? f.path.slice(0, -ext.length) : f.path;
      let to = `${base} Kopie${ext}`;
      for (let i = 2; await store.exists(`${dir}/${to}`); i++) to = `${base} Kopie ${i}${ext}`;
      await store.writeFile(`${dir}/${to}`, await store.readBytes(`${dir}/${f.path}`));
      await refreshTree();
      syncFile(to);
    } else if (v === 'share') {
      const data = await store.readBytes(`${dir}/${f.path}`);
      shareOrDownload(new Blob([data]), store.basename(f.path));
    } else if (v === 'delete') {
      if (!(await confirmDialog('Löschen', `„${f.path}“${isDir ? ' mit allem Inhalt' : ''} löschen? Das lässt sich nur über Git wiederherstellen.`, { okLabel: 'Löschen', danger: true }))) return;
      await store.rmrf(`${dir}/${f.path}`);
      for (const t of [...state.tabs]) if (t === f.path || t.startsWith(f.path + '/')) closeTab(t, true);
      runner.syncFiles(state.project, [], [f.path]);
      await refreshTree();
    }
  } catch (e) {
    toast(e.message || String(e), 'error');
  }
}

function validPath(s, original) {
  const v = s.trim();
  if (!v) return 'Bitte einen Namen eingeben.';
  if (v.startsWith('/') || v.includes('..') || /[\\:*?"<>|]/.test(v)) return 'Ungültiger Pfad.';
  if (v !== original && state.tree.some(f => f.path === v)) return 'Diesen Namen gibt es schon.';
  return null;
}

async function newFile(inDir) {
  const name = await promptDialog('Neue Datei', { label: 'Dateiname', value: inDir ? `${inDir}/` : '', placeholder: 'z. B. modul.py', validate: (s) => validPath(s), hint: 'Ohne Endung wird .py angehängt. Unterordner mit / angeben.' });
  if (!name) return;
  let path = name.trim();
  if (!/\.[^/]+$/.test(path)) path += '.py';
  const initial = path.endsWith('.py') ? '' : '';
  await store.writeFile(`${projectDir()}/${path}`, initial);
  if (store.dirname(path)) state.expanded.add(store.dirname(path));
  await refreshTree();
  syncFile(path);
  openFile(path);
}

async function newFolder(inDir) {
  const name = await promptDialog('Neuer Ordner', { label: 'Ordnername', value: inDir ? `${inDir}/` : '', validate: (s) => validPath(s), hint: 'Für ein Python-Paket wird automatisch __init__.py angelegt.' });
  if (!name) return;
  const path = name.trim().replace(/\/+$/, '');
  await store.mkdirp(`${projectDir()}/${path}`);
  if (/^[A-Za-z_]\w*$/.test(store.basename(path))) await store.writeFile(`${projectDir()}/${path}/__init__.py`, '');
  state.expanded.add(path);
  await refreshTree();
  syncProjectToWorker(false);
}

async function importFiles(inDir) {
  const files = await pickFiles({ multiple: true });
  if (!files.length) return;
  const dir = projectDir();
  for (const f of files) {
    if (f.name.toLowerCase().endsWith('.zip') && files.length === 1 && await confirmDialog('ZIP-Archiv', `„${f.name}“ als neues Projekt öffnen? (Sonst wird es als Datei abgelegt.)`, { okLabel: 'Als Projekt', cancelLabel: 'Als Datei' })) {
      const name = await store.importZip(f, f.name.replace(/\.zip$/i, ''));
      toast(`Projekt „${name}“ importiert`, 'ok');
      await openProject(name);
      return;
    }
    const rel = inDir ? `${inDir}/${f.name}` : f.name;
    await store.writeFile(`${dir}/${rel}`, new Uint8Array(await f.arrayBuffer()), { noFlush: true });
  }
  await store.flush();
  toast(`${files.length} Datei${files.length > 1 ? 'en' : ''} importiert`, 'ok');
  await refreshTree();
  syncProjectToWorker(false);
}

async function projectMenu() {
  const v = await actionSheet(`Projekt „${state.project}“`, [
    { label: 'Projekte wechseln …', icon: 'folder', value: 'switch' },
    { label: 'Als ZIP exportieren', icon: 'zip', value: 'zip' },
    { label: 'Umbenennen', icon: 'edit', value: 'rename' },
    { label: 'Duplizieren', icon: 'copy', value: 'dup' },
    '-',
    { label: 'Projekt löschen', icon: 'trash', value: 'delete', danger: true },
  ]);
  if (!v) return;
  try {
    if (v === 'switch') openProjectsSheet();
    else if (v === 'zip') {
      await saveAll(false);
      const blob = await store.exportZip(state.project);
      shareOrDownload(blob, `${state.project}.zip`);
    } else if (v === 'rename') {
      const name = await promptDialog('Projekt umbenennen', { value: state.project, validate: store.validName });
      if (!name || name === state.project) return;
      await saveAll(false);
      const old = state.project;
      await store.renameProject(old, name.trim());
      savePref(`tabs.${name.trim()}`, state.tabs);
      await openProject(name.trim());
    } else if (v === 'dup') {
      const name = await promptDialog('Projekt duplizieren', { value: `${state.project} Kopie`, validate: store.validName });
      if (!name) return;
      await saveAll(false);
      await store.duplicateProject(state.project, name.trim());
      await openProject(name.trim());
    } else if (v === 'delete') {
      if (!(await confirmDialog('Projekt löschen', `„${state.project}“ mit allen Dateien und dem Git-Verlauf endgültig löschen?`, { okLabel: 'Endgültig löschen', danger: true }))) return;
      await store.deleteProject(state.project);
      const list = await store.listProjects();
      if (!list.length) await createWelcomeProject();
      await openProject((await store.listProjects())[0].name);
    }
  } catch (e) { toast(e.message || String(e), 'error'); }
}

async function openProjectsSheet() {
  const list = await store.listProjects();
  const body = h('div', { class: 'project-list' });
  const sheet = openSheet('Projekte', body);
  const here = new Set();
  for (const p of list) {
    const row = h('button', { class: `project-row${p.name === state.project ? ' on' : ''}`, type: 'button', html: `${icon('folder')}<span class="pname"></span>${p.git ? `<span class="tree-tag">Git</span>` : ''}` });
    row.querySelector('.pname').textContent = p.name;
    row.addEventListener('click', async () => { sheet.close(); await openProject(p.name); showView(isWide() ? 'code' : 'files'); });
    body.append(row);
    if (p.git) { const url = await gitService.originUrl(p.name); if (url) here.add(repoKey(url)); }
  }
  // Deine Repositorys, die auf diesem Gerät noch fehlen (die Liste kommt mit der verschlüsselten Einstellungsdatei)
  const missing = repos().filter((r) => !here.has(repoKey(r.url)));
  if (missing.length) {
    body.append(h('h4', { class: 'project-sub', text: 'Noch nicht auf diesem Gerät' }));
    for (const r of missing) {
      const acc = r.account && account(r.account);
      const row = h('div', { class: 'project-row remote' },
        h('span', { class: 'muted', html: icon('cloudDown') }),
        h('span', { class: 'pname' }, h('span', { text: r.name || r.url.replace(/^https:\/\//, '') }), h('small', { class: 'muted', text: ` ${r.url.replace(/^https:\/\//, '')}${acc ? ` · ${accountLabel(acc)}` : ''}` })));
      const get = h('button', { class: 'btn small primary', type: 'button', text: 'Holen', 'aria-label': `${r.name || r.url} auf dieses Gerät holen` });
      get.addEventListener('click', () => { sheet.close(); gitPanel.cloneDialog(r.url, r.name); });
      const drop = h('button', { class: 'icon-btn small', type: 'button', html: icon('close'), 'aria-label': 'Aus der Liste nehmen', title: 'Aus der Liste nehmen' });
      drop.addEventListener('click', async () => {
        if (!(await confirmDialog('Aus der Liste nehmen', `„${r.name || r.url}“ aus deiner Liste nehmen? Auf GitHub und auf anderen Geräten bleibt alles, wie es ist.`, { okLabel: 'Herausnehmen' }))) return;
        forgetRepo(r.url); row.remove();
      });
      row.append(get, drop);
      body.append(row);
    }
  }
  const actions = h('div', { class: 'btn-col' });
  const newBtn = h('button', { class: 'btn primary', type: 'button', html: `${icon('plus')}<span>Neues Projekt</span>` });
  newBtn.addEventListener('click', async () => { sheet.close(); newProjectDialog(); });
  const zipBtn = h('button', { class: 'btn', type: 'button', html: `${icon('zip')}<span>ZIP importieren</span>` });
  zipBtn.addEventListener('click', async () => {
    const files = await pickFiles({ accept: '.zip,application/zip', multiple: false });
    if (!files[0]) return;
    try {
      const name = await store.importZip(files[0], files[0].name.replace(/\.zip$/i, ''));
      sheet.close();
      toast(`Projekt „${name}“ importiert`, 'ok');
      await openProject(name);
    } catch (e) { toast(e.message, 'error'); }
  });
  const cloneBtn = h('button', { class: 'btn', type: 'button', html: `${icon('cloudDown')}<span>Von GitHub klonen</span>` });
  cloneBtn.addEventListener('click', () => { sheet.close(); gitPanel.cloneDialog(); });
  actions.append(newBtn, zipBtn, cloneBtn);
  if (here.size) {
    const allBtn = h('button', { class: 'btn', type: 'button', id: 'pull-all', html: `${icon('refresh')}<span>Alle auf den neuesten Stand</span>` });
    allBtn.addEventListener('click', () => { sheet.close(); pullAll(); });
    actions.append(allBtn);
  }
  body.append(actions);
}

// Holt jedes Projekt, das mit GitHub verbunden ist. Projekte mit Änderungen, die noch nicht committet sind, bleiben
// unberührt; hochgeladen wird nichts.
async function pullAll() {
  if (!loadPref('git.proxy', '')) { toast('Zum Holen ist ein Git-Proxy nötig (Einstellungen).', 'error', 5000); openSettings('git'); return; }
  await saveAll(false);
  const rows = [];
  const box = h('div', { class: 'pull-all' });
  const sheet = openSheet('Alle auf den neuesten Stand', box);
  const line = (name) => { const st = h('span', { class: 'muted', text: 'wartet …' }); box.append(h('div', { class: 'pull-row' }, h('span', { class: 'pname', text: name }), st)); return st; };
  const list = (await store.listProjects()).filter((p) => p.git);
  const jobs = [];
  for (const p of list) if (await gitService.originUrl(p.name)) jobs.push({ name: p.name, st: line(p.name) });
  let changed = false;
  for (const j of jobs) {
    j.st.textContent = 'holt …';
    try {
      const status = await gitService.status(j.name);
      if (status.some((x) => x.kind !== '?')) { j.st.textContent = 'übersprungen: erst committen'; j.st.className = 'warn'; continue; }
      const before = (await gitService.log(j.name, 1))[0]?.oid;
      await gitService.pull(j.name);
      const after = (await gitService.log(j.name, 1))[0]?.oid;
      const ahead = await gitService.ahead(j.name);
      j.st.textContent = before === after ? 'schon aktuell' : 'aktualisiert';
      if (ahead) j.st.textContent += ` · ${ahead} noch hochzuladen`;
      j.st.className = 'ok';
      if (before !== after && j.name === state.project) changed = true;
    } catch (e) { j.st.textContent = explainGitError(e); j.st.className = 'error'; }
    rows.push(j);
  }
  if (!jobs.length) box.append(h('p', { class: 'empty', text: 'Kein Projekt ist mit GitHub verbunden.' }));
  if (changed) { await refreshTree(); await reloadOpenFiles(); syncProjectToWorker(true); }
  gitPanel.refresh();
  return sheet;
}

async function newProjectDialog() {
  const nameInput = h('input', { class: 'field', type: 'text', placeholder: 'Projektname', autocapitalize: 'off', autocorrect: 'off', id: 'new-project-name' });
  const tplWrap = h('div', { class: 'tpl-list' });
  let tpl = 'hallo';
  for (const [key, t] of Object.entries(store.TEMPLATES)) {
    const b = h('button', { class: `tpl${key === tpl ? ' on' : ''}`, type: 'button', text: t.label });
    b.addEventListener('click', () => { tpl = key; tplWrap.querySelectorAll('.tpl').forEach(x => x.classList.toggle('on', x === b)); });
    tplWrap.append(b);
  }
  const err = h('div', { class: 'field-error' });
  const body = h('div', { class: 'form' }, h('label', { class: 'field-label', text: 'Name' }), nameInput, h('label', { class: 'field-label', text: 'Vorlage' }), tplWrap, err);
  const name = await modal({
    title: 'Neues Projekt',
    body,
    actions: [{ label: 'Abbrechen', value: null }, { label: 'Anlegen', kind: 'primary', value: () => {
      const n = nameInput.value.trim();
      const p = store.validName(n);
      if (p) { err.textContent = p; return undefined; }
      return n;
    } }],
    onOpen: () => setTimeout(() => nameInput.focus(), 60),
  });
  if (!name) return;
  try {
    await store.createProject(name, tpl);
    await openProject(name);
    showView('code');
  } catch (e) { toast(e.message, 'error'); }
}

async function findInFiles() {
  const input = h('input', { class: 'field', type: 'search', placeholder: 'Suchbegriff', autocapitalize: 'off', autocorrect: 'off', id: 'find-input' });
  const results = h('div', { class: 'find-results' });
  const body = h('div', { class: 'form' }, input, results);
  const sheet = openSheet('In Dateien suchen', body, { full: true });
  const run = debounce(async () => {
    const q = input.value;
    results.textContent = '';
    if (q.length < 2) return;
    let count = 0;
    const lower = q.toLowerCase();
    for (const f of state.tree) {
      if (f.type !== 'file' || !store.isTextFile(f.path) || f.size > 2_000_000) continue;
      const text = editor.has(f.path) ? editor.content(f.path) : await store.readText(`${projectDir()}/${f.path}`);
      const lines = text.split('\n');
      lines.forEach((ln, i) => {
        if (count > 300 || !ln.toLowerCase().includes(lower)) return;
        count++;
        const b = h('button', { class: 'find-hit', type: 'button' }, h('span', { class: 'find-loc', text: `${f.path}:${i + 1}` }), h('span', { class: 'find-line', text: ln.trim().slice(0, 160) }));
        b.addEventListener('click', () => { sheet.close(); openFile(f.path, { line: i + 1, col: ln.toLowerCase().indexOf(lower) }); });
        results.append(b);
      });
    }
    if (!count) results.append(h('p', { class: 'empty', text: 'Nichts gefunden.' }));
  }, 250);
  input.addEventListener('input', run);
  setTimeout(() => input.focus(), 80);
}

// ================================================================ Editor-Tabs
async function openFile(path, { line, col, noView } = {}) {
  const full = `${projectDir()}/${path}`;
  if (!(await store.exists(full))) { toast(`Datei nicht gefunden: ${path}`, 'error'); return; }
  if (!store.isTextFile(path)) {
    previewFile(path);
    return;
  }
  if (state.active && state.active !== path) await saveFile(state.active);
  if (!editor.has(path)) {
    const content = await store.readText(full);
    editor.open(path, content);
  } else {
    editor.open(path, editor.content(path));
  }
  if (!state.tabs.includes(path)) state.tabs.push(path);
  state.active = path;
  savePref(`active.${state.project}`, path);
  persistTabs();
  renderTabs();
  renderTree();
  $('#file-name').textContent = path;
  $('#editor-empty').hidden = true;
  if (!noView) showView('code');
  if (line) setTimeout(() => editor.gotoLine(line, col || 0), 40);
}

async function previewFile(path) {
  const data = await store.readBytes(`${projectDir()}/${path}`);
  const body = h('div', { class: 'preview' });
  if (store.isImageFile(path)) {
    const ext = path.split('.').pop().toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    body.append(h('img', { src: URL.createObjectURL(new Blob([data], { type: mime })), alt: path }));
  } else {
    body.append(h('p', { class: 'hint', text: `Binärdatei, ${formatBytes(data.length)}. Sie lässt sich nicht im Editor öffnen, aber dein Programm kann sie lesen.` }));
  }
  const share = h('button', { class: 'btn', type: 'button', html: `${icon('download')}<span>Teilen / sichern</span>` });
  share.addEventListener('click', () => shareOrDownload(new Blob([data]), store.basename(path)));
  body.append(share);
  openSheet(path, body);
}

function showEmptyEditor() {
  $('#editor-empty').hidden = false;
  $('#file-name').textContent = '';
}

function persistTabs() { savePref(`tabs.${state.project}`, state.tabs); }

function renderTabs() {
  const el = $('#tabs');
  el.textContent = '';
  for (const p of state.tabs) {
    const t = h('div', { class: `tab${p === state.active ? ' on' : ''}${editor?.isDirty(p) ? ' dirty' : ''}`, role: 'tab', dataset: { path: p } });
    const label = h('button', { class: 'tab-label', type: 'button', text: store.basename(p), title: p });
    label.addEventListener('click', () => openFile(p));
    const close = h('button', { class: 'tab-close', type: 'button', 'aria-label': `${p} schließen`, html: icon('close') });
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(p); });
    t.append(label, close);
    el.append(t);
  }
  el.querySelector('.tab.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

async function closeTab(path, skipSave) {
  if (!skipSave) await saveFile(path);
  const i = state.tabs.indexOf(path);
  if (i < 0) return;
  state.tabs.splice(i, 1);
  editor.close(path);
  persistTabs();
  if (state.active === path) {
    state.active = null;
    const next = state.tabs[Math.min(i, state.tabs.length - 1)];
    if (next) await openFile(next, { noView: true });
    else showEmptyEditor();
  }
  renderTabs();
}

const autosave = debounce(() => saveFile(state.active), 700);

function onDocChange(path) {
  const tab = root.querySelector(`.tab[data-path="${CSS.escape(path || '')}"]`);
  tab?.classList.add('dirty');
  if (settings.autosave) autosave();
}

async function saveFile(path) {
  if (!path || !editor?.has(path) || !editor.isDirty(path)) return;
  const content = editor.content(path);
  try {
    await store.writeFile(`${projectDir()}/${path}`, content);
    editor.markSaved(path, content);
    root.querySelector(`.tab[data-path="${CSS.escape(path)}"]`)?.classList.remove('dirty');
    runner?.syncFiles(state.project, [{ path, data: content }]);
  } catch (e) {
    toast(`Speichern fehlgeschlagen: ${e.message}`, 'error');
  }
}

async function saveAll(showToast) {
  autosave.cancel?.();
  for (const p of state.tabs) await saveFile(p);
  if (showToast) toast('Gespeichert', 'ok', 1200);
}

async function syncFile(path) {
  const data = await store.readBytes(`${projectDir()}/${path}`);
  runner.syncFiles(state.project, [{ path, data }]);
}

async function reloadOpenFiles() {
  for (const p of [...state.tabs]) {
    const full = `${projectDir()}/${p}`;
    if (!(await store.exists(full))) { closeTab(p, true); continue; }
    editor.replaceContent(p, await store.readText(full));
  }
}

function renderSignature(sig) {
  const bar = $('#sig-bar');
  if (!sig) { bar.hidden = true; return; }
  const params = sig.params.map((p, i) => i === sig.index ? `<b>${esc(p)}</b>` : esc(p)).join(', ');
  const doc = (sig.doc || '').split('\n').find(l => l.trim() && !l.includes(sig.name + '(')) || '';
  bar.innerHTML = `<div class="sig-main"><span class="sig-name">${esc(sig.name)}</span>(${params})</div>${doc ? `<div class="sig-doc">${esc(doc.trim())}</div>` : ''}`;
  bar.hidden = false;
}

function updateProblemsBadge(n, list) {
  const errors = list.filter(d => d.severity === 'error').length;
  const dot = $('#nav [data-view="code"] .badge-dot');
  dot.hidden = !errors;
}

// ============================================================ Tastenleiste
function buildKeybar() {
  const bar = $('#keybar');
  const left = h('div', { class: 'kb-fixed' });
  const mid = h('div', { class: 'kb-scroll' });
  const right = h('div', { class: 'kb-fixed' });
  const key = (content, fn, cls = '', label = '') => {
    const b = h('button', { class: `kb-key ${cls}`, type: 'button', 'aria-label': label || (typeof content === 'string' ? content : '') });
    if (content.startsWith('<svg')) b.innerHTML = content; else b.textContent = content;
    tapKeepFocus(b, fn);
    return b;
  };
  left.append(key(icon('tab'), () => editor.key('tab'), 'wide', 'Tab'), key(icon('blocks'), () => openSnippets(), 'accent', 'Bausteine'));
  mid.append(
    key(icon('dedent'), () => editor.key('dedent'), '', 'Ausrücken'),
    key(icon('arrowLeft'), () => editor.key('left'), '', 'links'), key(icon('arrowRight'), () => editor.key('right'), '', 'rechts'),
    key(icon('arrowUp'), () => editor.key('up'), '', 'hoch'), key(icon('arrowDown'), () => editor.key('down'), '', 'runter'),
  );
  for (const ch of ['(', ')', ':', '=', '"', "'", '[', ']', '{', '}', '.', ',', '_', '#', '+', '-', '*', '/', '<', '>', '!', '%', '&', '|', '\\', '@', '~', '^']) {
    mid.append(key(ch, () => editor.insertText(ch), 'char'));
  }
  mid.append(
    key(icon('undo'), () => editor.key('undo'), '', 'Rückgängig'), key(icon('redo'), () => editor.key('redo'), '', 'Wiederholen'),
    key(icon('comment'), () => editor.key('comment'), '', 'Kommentar umschalten'),
    key(icon('sparkle'), () => editor.key('complete'), '', 'Vorschläge'),
    key(icon('book'), () => showDocs(), '', 'Dokumentation'),
  );
  right.append(key(icon('keyboardDown'), () => editor.blur(), '', 'Tastatur ausblenden'));
  bar.append(left, mid, right);
  const host = $('#editor');
  host.addEventListener('focusin', () => document.body.classList.add('editing'));
  host.addEventListener('focusout', () => setTimeout(() => {
    if (!host.contains(document.activeElement)) document.body.classList.remove('editing');
  }, 100));
}

function openSnippets() {
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Baustein suchen …', autocapitalize: 'off', autocorrect: 'off', id: 'snippet-search' });
  const list = h('div', { class: 'snippet-groups' });
  const body = h('div', {}, search, list);
  const sheet = openSheet('Bausteine', body, { full: false });
  // Bausteine aus Toollibs Spickzettel; ohne abgeglichenes Wissen Kobras eigene (render)
  const insert = (code) => {
    sheet.close();
    if (!state.active) { toast('Erst eine Datei öffnen.', 'error'); return; }
    showView('code');
    setTimeout(() => editor.insertBody(code), 30);
  };
  renderSpickzettel(search, list, insert).then((ok) => { if (!ok) { search.addEventListener('input', render); render(); } });
  const render = () => {
    const q = search.value.trim().toLowerCase();
    list.textContent = '';
    for (const g of SNIPPET_GROUPS) {
      const items = g.items.filter(i => !q || i.label.toLowerCase().includes(q) || (i.detail || '').toLowerCase().includes(q) || i.body.toLowerCase().includes(q));
      if (!items.length) continue;
      const grid = h('div', { class: 'snippet-grid' });
      for (const it of items) {
        const b = h('button', { class: 'snippet', type: 'button' }, h('code', { text: it.label }), h('span', { text: it.detail || '' }));
        b.addEventListener('click', () => {
          sheet.close();
          if (!state.active) { toast('Erst eine Datei öffnen.', 'error'); return; }
          showView('code');
          setTimeout(() => editor.insertSnippet(it.key), 30);
        });
        grid.append(b);
      }
      list.append(h('h4', { text: g.title }), grid);
    }
  };
}

async function showDocs() {
  if (!state.active) return;
  let info = null;
  try { info = await editor.help(); } catch (e) { info = null; }
  if (!info || !info.name) { toast(runner.state === 'ready' || runner.state === 'gui' ? 'Keine Dokumentation zum Wort unter dem Cursor.' : 'Python lädt noch …'); return; }
  const body = h('div', { class: 'docs' });
  body.append(h('div', { class: 'docs-full', text: `${info.full} · ${info.type}` }));
  for (const s of info.sig || []) body.append(h('pre', { class: 'docs-sig', text: s }));
  body.append(h('pre', { class: 'docs-text', text: info.doc || '(keine Beschreibung)' }));
  openSheet(info.name, body, { full: true });
}

// ============================================================== Ausfuehren
function onRunnerStatus(st, msg) {
  state.runnerState = st;
  const dot = $('#py-status');
  dot.className = `py-status s-${st}`;
  dot.title = { loading: msg || 'Python lädt …', ready: `Python ${runner.python || ''} bereit`, running: 'Programm läuft', gui: 'Fenster offen', error: msg || 'Fehler' }[st] || '';
  dot.setAttribute('aria-label', dot.title);
  updateRunButton();
  if (st === 'ready' && !state.readyOnce) {
    state.readyOnce = true;
    editor.relint();
    if (state.view === 'packages') packages.refresh();
  }
}

function updateRunButton() {
  const b = $('#btn-run');
  const running = state.runnerState === 'running' || state.runnerState === 'gui';
  b.classList.toggle('stop', running);
  b.innerHTML = running ? `${icon('stop')}<span>Stopp</span>` : `${icon('play')}<span>Start</span>`;
  b.disabled = state.runnerState === 'loading' && !running ? false : false;
}

async function runCurrent(argv = [], entryOverride) {
  if (!state.project) return;
  if (state.runnerState === 'loading') { toast('Python wird noch geladen …'); return; }
  if (state.runnerState === 'error' || state.runnerState === 'off') { runner.restart({ packages: PackagePanel.wanted(), version: VERSION }); toast('Python wird neu gestartet …'); return; }
  if (state.runnerState === 'running') return;
  await saveAll(false);
  let entry = entryOverride;
  if (!entry) {
    entry = state.active && state.active.endsWith('.py') ? state.active : loadPref(`main.${state.project}`, 'main.py');
    if (!state.tree.some(f => f.path === entry)) entry = state.tree.find(f => f.type === 'file' && f.path.endsWith('.py'))?.path;
  }
  if (!entry) { toast('Keine Python-Datei zum Ausführen.', 'error'); return; }
  if (loadPref('clearOnRun', true)) consoleView.clear();
  runner.run(state.project, entry, argv);
  if (!isWide()) showView('console');
  else $('#nav [data-view="console"] .badge-dot').hidden = true;
}

async function runMenu() {
  const startFile = loadPref(`main.${state.project}`, 'main.py');
  const v = await actionSheet('Ausführen', [
    { label: `Aktuelle Datei${state.active ? ` (${store.basename(state.active)})` : ''}`, icon: 'play', value: 'cur', disabled: !state.active?.endsWith('.py') },
    { label: `Startdatei (${startFile})`, icon: 'play', value: 'main' },
    { label: 'Mit Argumenten …', icon: 'terminal', value: 'args' },
    '-',
    { label: 'Python neu starten', icon: 'refresh', value: 'restart' },
  ]);
  if (v === 'cur') runCurrent();
  else if (v === 'main') runCurrent([], startFile);
  else if (v === 'args') {
    const a = await promptDialog('Argumente (sys.argv)', { value: loadPref(`args.${state.project}`, ''), placeholder: '--zahl 5 datei.txt' });
    if (a == null) return;
    savePref(`args.${state.project}`, a);
    runCurrent(a.match(/"[^"]*"|'[^']*'|\S+/g)?.map(s => s.replace(/^["']|["']$/g, '')) || []);
  } else if (v === 'restart') restartPython();
}

function stopProgram() {
  runner.stop();
  gui.reset();
}

function restartPython() {
  consoleView.info('Python wird neu gestartet …');
  runner.restart({ packages: PackagePanel.wanted(), version: VERSION });
}

async function runRepl(code) {
  if (state.runnerState === 'running') { consoleView.info('Ein Programm läuft gerade. Erst stoppen oder warten.', 'warn'); return; }
  if (state.runnerState === 'loading') { consoleView.info('Python lädt noch …', 'warn'); return; }
  try { await runner.call('repl', { code, project: state.project }, 0); } catch (e) { /* Ausgabe kam ueber stderr */ }
}

async function installRequirements() {
  const path = `${projectDir()}/requirements.txt`;
  if (!(await store.exists(path))) { toast('Keine requirements.txt im Projekt.', 'error'); return; }
  const names = (await store.readText(path)).split('\n').map(l => l.replace(/#.*/, '').trim()).filter(l => l && !l.startsWith('-'));
  if (names.length) packages.install(names);
}

// ================================================================ Konsole
function buildConsoleToolbar() {
  const bar = $('#console-toolbar');
  const btn = (ic, label, fn) => {
    const b = h('button', { class: 'btn small ghost', type: 'button', html: `${icon(ic)}<span>${label}</span>` });
    b.addEventListener('click', fn);
    return b;
  };
  bar.append(
    btn('eraser', 'Leeren', () => consoleView.clear()),
    btn('vars', 'Variablen', () => showVariables()),
    btn('refresh', 'Neustart', () => restartPython()),
  );
}

async function showVariables() {
  let vars = [];
  try { vars = await runner.call('vars', {}, 8000); } catch (e) { toast('Variablen sind gerade nicht abrufbar.', 'error'); return; }
  const body = h('div', { class: 'vars' });
  if (!vars.length) body.append(h('p', { class: 'empty', text: 'Noch keine Variablen. Führe ein Programm aus oder tippe Befehle in die Konsole.' }));
  else {
    const table = h('table', { class: 'vars-table' }, h('thead', {}, h('tr', {}, h('th', { text: 'Name' }), h('th', { text: 'Typ' }), h('th', { text: 'Wert' }))));
    const tb = h('tbody');
    for (const v of vars) tb.append(h('tr', {}, h('td', { class: 'mono', text: v.n }), h('td', { text: v.t }), h('td', { class: 'mono', text: v.v })));
    table.append(tb);
    body.append(h('div', { class: 'table-scroll' }, table));
  }
  openSheet('Variablen', body, { full: true });
}

// ============================================================ Mehr-Menue
async function moreMenu() {
  const py = state.active?.endsWith('.py');
  const v = await actionSheet(null, [
    { label: 'Suchen & Ersetzen', icon: 'search', value: 'search', disabled: !state.active },
    { label: 'Gehe zu Zeile …', icon: 'arrowDown', value: 'line', disabled: !state.active },
    { label: 'Gliederung', icon: 'outline', value: 'outline', disabled: !py },
    { label: 'Probleme', icon: 'warn', value: 'problems', disabled: !py, detail: state.diagnostics.length ? String(state.diagnostics.length) : '' },
    { label: 'Gehe zu Definition', icon: 'arrowRight', value: 'goto', disabled: !py },
    { label: 'Symbol umbenennen …', icon: 'edit', value: 'rename', disabled: !py },
    { label: 'Code formatieren (black)', icon: 'format', value: 'format', disabled: !py },
    { label: 'Dokumentation zum Wort', icon: 'book', value: 'docs', disabled: !py },
    '-',
    { label: 'In Dateien suchen', icon: 'search', value: 'find' },
    { label: 'Einstellungen', icon: 'settings', value: 'settings' },
  ]);
  if (!v) return;
  if (v === 'search') { showView('code'); editor.search(); }
  else if (v === 'line') {
    const n = await promptDialog('Gehe zu Zeile', { type: 'number', validate: (s) => /^\d+$/.test(s) ? null : 'Bitte eine Zahl eingeben.' });
    if (n) { showView('code'); editor.gotoLine(parseInt(n, 10)); }
  } else if (v === 'outline') showOutline();
  else if (v === 'problems') showProblems();
  else if (v === 'goto') gotoDefinition();
  else if (v === 'rename') renameSymbol();
  else if (v === 'format') formatCode();
  else if (v === 'docs') showDocs();
  else if (v === 'find') findInFiles();
  else if (v === 'settings') openSettings();
}

async function showOutline() {
  let items = [];
  try { items = await runner.lsp('outline', { code: editor.content(), project: state.project, file: state.active }, 5000) || []; } catch (e) { items = []; }
  const body = h('div', { class: 'outline' });
  if (!items.length) body.append(h('p', { class: 'empty', text: 'Keine Klassen oder Funktionen gefunden.' }));
  const sheet = openSheet('Gliederung', body);
  for (const it of items) {
    const b = h('button', { class: `outline-row k-${it.k}`, type: 'button', style: { paddingLeft: `${12 + it.d * 18}px` } },
      h('span', { class: 'outline-kind', text: { class: 'K', def: 'ƒ', const: 'C', main: '▶' }[it.k] || '·' }), h('span', { text: it.n }), h('span', { class: 'muted', text: String(it.l) }));
    b.addEventListener('click', () => { sheet.close(); showView('code'); editor.gotoLine(it.l); });
    body.append(b);
  }
}

function showProblems() {
  const body = h('div', { class: 'outline' });
  const sheet = openSheet('Probleme', body);
  if (!state.diagnostics.length) body.append(h('p', { class: 'empty', text: 'Keine Probleme gefunden.' }));
  const doc = editor.view.state.doc;
  for (const d of state.diagnostics) {
    const line = doc.lineAt(Math.min(d.from, doc.length)).number;
    const b = h('button', { class: `outline-row sev-${d.severity}`, type: 'button' }, h('span', { class: 'outline-kind', html: icon(d.severity === 'error' ? 'warn' : 'info') }), h('span', { text: d.message }), h('span', { class: 'muted', text: `Z. ${line}` }));
    b.addEventListener('click', () => { sheet.close(); showView('code'); editor.gotoLine(line); });
    body.append(b);
  }
}

async function gotoDefinition() {
  let res = null;
  try { res = await editor.gotoDefinition(); } catch (e) { res = null; }
  if (!res || (!res.line && !res.external)) { toast('Keine Definition gefunden.'); return; }
  if (res.external) { toast(`Definiert in ${res.external} (Bibliothek)`); return; }
  if (res.path) openFile(res.path, { line: res.line, col: res.col });
  else editor.gotoLine(res.line, res.col);
}

async function renameSymbol() {
  const word = editor.selectionText() || '';
  const name = await promptDialog('Symbol umbenennen', { label: 'Neuer Name (in dieser Datei)', value: word, validate: (s) => /^[A-Za-z_À-ɏ][\wÀ-ɏ]*$/.test(s) ? null : 'Kein gültiger Python-Name.' });
  if (!name) return;
  const n = await editor.renameSymbol(name).catch(() => 0);
  toast(n ? `${n} Stellen umbenannt` : 'Cursor auf einen Namen setzen und erneut versuchen.', n ? 'ok' : 'error');
}

async function formatCode() {
  toast('Formatiere …', 'info', 1200);
  try {
    const res = await runner.lsp('format', { code: editor.content(), project: state.project, file: state.active }, 120000);
    if (res?.code != null) { editor.replaceAll(res.code); toast('Formatiert', 'ok'); }
    else if (res?.error === 'missing') toast('Formatierer nicht verfügbar (Internet nötig).', 'error');
    else if (res?.error) toast(`Nicht formatierbar: ${res.error}`, 'error', 5000);
  } catch (e) { toast(e.message, 'error'); }
}

// ============================================================ Einstellungen
// ------------------------------------------------------------------ Konten (0.20.0)
function accountsList() {
  const box = h('div', { class: 'accounts', id: 'git-accounts' });
  const draw = () => {
    box.textContent = '';
    for (const a of accounts()) {
      const row = h('button', { class: 'account-row', type: 'button', dataset: { account: a.id } },
        h('span', { class: 'acc-icon', html: icon('user') }),
        h('span', { class: 'acc-text' }, h('span', { class: 'acc-name', text: accountLabel(a) }),
          h('small', { class: 'muted', text: [a.name, a.email].filter(Boolean).join(' · ') || 'Name und E-Mail fehlen' })),
        h('span', { class: `acc-token ${a.token ? 'ok' : 'warn'}`, text: a.token ? 'Token' : 'kein Token' }));
      row.addEventListener('click', async () => { if (await editAccount(a)) draw(); });
      box.append(row);
    }
    const add = h('button', { class: 'btn small', type: 'button', id: 'account-add', html: `${icon('plus')}<span>Konto hinzufügen</span>` });
    add.addEventListener('click', async () => { if (await editAccount({ id: newAccountId(), label: '', login: '', name: '', email: '', token: '', host: 'github.com' }, true)) draw(); });
    box.append(add);
  };
  draw();
  return box;
}

async function editAccount(a, isNew = false) {
  const f = (id, label, attrs, value) => {
    const input = h('input', { class: 'field', id: `acc-${id}`, value: value || '', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', ...attrs });
    return { input, row: h('label', { class: 'set-field', for: `acc-${id}` }, h('span', { class: 'set-label', text: label }), input) };
  };
  const label = f('label', 'Bezeichnung', { placeholder: 'z. B. Privat, Uni, Arbeit' }, a.label);
  const login = f('login', 'GitHub-Name', { placeholder: 'dein-name' }, a.login);
  const name = f('name', 'Name für Commits', { autocomplete: 'name', placeholder: 'Max Mustermann' }, a.name);
  const email = f('email', 'E-Mail für Commits', { type: 'email', autocomplete: 'email', placeholder: '123+name@users.noreply.github.com' }, a.email);
  const token = f('token', 'GitHub-Token', { type: 'password', autocomplete: 'off', placeholder: 'github_pat_…' }, a.token);
  const host = f('host', 'Rechner', { placeholder: 'github.com' }, a.host === 'github.com' ? '' : a.host);
  const note = h('p', { class: 'hint', id: 'acc-check-result', role: 'status' });
  const check = h('button', { class: 'btn small', type: 'button', id: 'acc-check', html: `${icon('check')}<span>Token prüfen</span>` });
  check.addEventListener('click', async () => {
    note.textContent = 'Frage GitHub …';
    const r = await checkToken({ token: token.input.value.trim(), host: host.input.value.trim().toLowerCase() || 'github.com' });
    if (!r.ok) { note.textContent = r.reason; note.className = 'hint error'; return; }
    note.className = 'hint ok';
    note.textContent = `Gültig: gehört @${r.login}.`;
    if (!login.input.value.trim()) login.input.value = r.login;
    if (!name.input.value.trim() && r.name) name.input.value = r.name;
    if (!email.input.value.trim()) { email.input.value = r.email; note.textContent += ' Als E-Mail steht die Adresse ohne Antwort von GitHub drin; damit bleibt deine echte Adresse privat.'; }
  });
  const body = h('div', { class: 'form' }, label.row, login.row, name.row, email.row, token.row,
    h('span', { class: 'set-hint', text: 'Fein-granulares Token mit „Contents: Read and write“ für die Repositorys dieses Kontos. Es geht nur an seinen Rechner, über deinen Git-Proxy.' }),
    h('div', { class: 'btn-row' }, check), note,
    h('details', {}, h('summary', { text: 'Anderer Rechner als github.com' }), host.row));
  const actions = [{ label: 'Abbrechen', value: null }];
  if (!isNew && a.id !== MAIN) actions.unshift({ label: 'Löschen', kind: 'danger', value: 'delete' });
  actions.push({ label: 'Sichern', kind: 'primary', value: 'save' });
  const v = await modal({ title: isNew ? 'Neues Konto' : accountLabel(a), body, actions, wide: true });
  if (v === 'delete') {
    if (!(await confirmDialog('Konto löschen', `„${accountLabel(a)}“ auf diesem Gerät löschen? Projekte, die es nahmen, nehmen dann das passende oder das erste Konto.`, { okLabel: 'Löschen', danger: true }))) return false;
    removeAccount(a.id);
    toast('Konto gelöscht', 'ok');
    return true;
  }
  if (v !== 'save') return false;
  const h0 = host.input.value.trim().toLowerCase();
  if (h0 && !/^[a-z0-9.-]{1,100}(:\d{1,5})?$/.test(h0)) { toast('Der Rechner ist ungültig (z. B. github.com).', 'error'); return false; }
  try {
    saveAccount({ id: a.id, label: label.input.value, login: login.input.value.replace(/^@/, ''), name: name.input.value, email: email.input.value, token: token.input.value, host: h0 });
  } catch (e) { toast(e.message, 'error'); return false; }
  toast('Konto gesichert', 'ok');
  gitPanel?.refresh();
  return true;
}

async function openSettings(section) {
  const info = await store.storageInfo();
  const field = (label, input, hint) => h('label', { class: 'set-field' }, h('span', { class: 'set-label', text: label }), input, hint ? h('span', { class: 'set-hint', html: hint }) : null);
  const select = (id, value, opts) => {
    const el = h('select', { class: 'field', id });
    for (const [v, l] of opts) el.append(h('option', { value: v, text: l, selected: v === value || null }));
    return el;
  };
  const size = h('input', { type: 'range', min: '11', max: '22', step: '1', value: String(settings.fontSize), id: 'set-size' });
  const sizeVal = h('span', { class: 'set-val', text: `${settings.fontSize} px` });
  const wrap = h('input', { type: 'checkbox', checked: settings.wrap || null, id: 'set-wrap' });
  const autos = h('input', { type: 'checkbox', checked: settings.autosave || null, id: 'set-autosave' });
  const clear = h('input', { type: 'checkbox', checked: loadPref('clearOnRun', true) || null, id: 'set-clear' });
  const proxy = h('input', { class: 'field', type: 'url', value: loadPref('git.proxy', ''), placeholder: 'https://git-proxy.dein-name.workers.dev', autocapitalize: 'off', id: 'set-git-proxy' });

  const body = h('div', { class: 'settings' },
    h('section', { class: 'card' }, h('h3', { text: 'Darstellung' }),
      h('label', { class: 'set-field' }, h('span', { class: 'set-label', text: 'Schriftgröße im Editor' }), h('div', { class: 'row-input' }, size, sizeVal)),
      h('label', { class: 'set-switch' }, wrap, h('span', { text: 'Lange Zeilen umbrechen' })),
    ),
    h('section', { class: 'card' }, h('h3', { text: 'Editor & Ausführen' }),
      h('label', { class: 'set-switch' }, autos, h('span', { text: 'Automatisch speichern' })),
      h('label', { class: 'set-switch' }, clear, h('span', { text: 'Konsole vor jedem Start leeren' })),
    ),
    h('section', { class: 'card', id: 'settings-git' }, h('h3', { text: 'Git & GitHub' }),
      h('p', { class: 'hint', text: 'Jedes Projekt committet und lädt mit seinem Konto hoch. Welches, wählst du im Bereich Git oben beim Projekt; sonst nimmt Kobra das Konto, dem das Repository auf GitHub gehört, und sonst das erste.' }),
      accountsList(),
      field('Git-Proxy', proxy, 'Browser dürfen nicht direkt mit GitHub-Git sprechen. Ein kleiner eigener Proxy (Cloudflare Worker, kostenlos) leitet weiter – Anleitung in der README. Er gilt für alle Konten.'),
      h('p', { class: 'hint', text: 'Konten, Tokens und die Liste deiner Repositorys bleiben auf diesem Gerät. Auf andere Geräte bringst du sie in Toollib › Einstellungen › Sichern & Laden als verschlüsselte Datei.' }),
    ),
    h('section', { class: 'card' }, h('h3', { text: 'Speicher' }),
      h('p', { class: 'hint', text: `Belegt: ${formatBytes(info.usage)}${info.quota ? ` von ${formatBytes(info.quota)}` : ''}. ${info.persisted ? 'Dauerhafte Speicherung ist aktiv.' : 'Dauerhafte Speicherung ist nicht bestätigt – als App zum Home-Bildschirm hinzufügen und regelmäßig per Git oder ZIP sichern.'}` }),
    ),
    h('section', { class: 'card' }, h('h3', { text: 'Über Kobra' }),
      h('p', { class: 'hint', text: `Version ${VERSION} · Python ${runner.python || '(lädt)'} über Pyodide · tkinter- und PyQt-Nachbau · ${runner.sync ? 'Eingabe-Kanal aktiv' : 'Eingabe-Kanal inaktiv (App neu laden)'}` }),
    ),
  );
  size.addEventListener('input', () => { sizeVal.textContent = `${size.value} px`; editor.configure({ size: +size.value }); });
  const sheet = openSheet('Einstellungen', body, {
    full: true,
    onClose: () => {
      settings.fontSize = +size.value; savePref('fontSize', settings.fontSize);
      settings.wrap = wrap.checked; savePref('wrap', settings.wrap);
      settings.autosave = autos.checked; savePref('autosave', settings.autosave);
      savePref('clearOnRun', clear.checked);
      savePref('git.proxy', proxy.value.trim());
      applyTheme();
      editor.configure({ size: settings.fontSize, wrap: settings.wrap });
    },
  });
  if (section === 'git') setTimeout(() => body.querySelector('#settings-git')?.scrollIntoView({ block: 'start' }), 100);
  return sheet;
}

// ================================================================== in Toollib (0.22.0)
let started = null;

// Einmal starten; danach nur zeigen und ausblenden.
export function mountKobra(host) {
  if (!started) {
    started = main(host).catch((e) => {
      console.error(e);
      host.append(h('pre', { class: 'fatal', text: `Kobra konnte nicht starten:\n${e.stack || e}` }));
    });
  }
  return started;
}

// Toollib zeigt Kobra (true) oder wechselt zu einem anderen Werkzeug (false).
export function setActive(on) {
  active = !!on;
  if (!root) return;
  if (active) {
    applyTheme();
    showView(state.view || 'code');
    openRequested();
  } else {
    saveAll(false).then(() => store.flush());
    gui?.hide?.();
  }
}

// Wunsch von außen: „In Kobra verwalten“ in Toollibs Einstellungen (kobra.open = "settings") oder „In Kobra
// ausführen“ bei einem Snippet mit Fenstern (kobra.open = { run: { name, code } }, seit 0.23.0).
function openRequested() {
  const want = loadPref('open', '');
  if (!want || !editor) return;
  savePref('open', '');
  if (want === 'settings') openSettings('git');
  else if (want && typeof want === 'object' && want.run) runFromToollib(want.run).catch((e) => toast(String(e.message || e), 'error'));
}

// Ein Snippet aus Toollib: als Datei im Projekt „Spickzettel“ ablegen, öffnen und ausführen.
const SNIPPET_PROJECT = 'Spickzettel';
async function runFromToollib({ name, code }) {
  const file = `${String(name || 'snippet').replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(0, 60) || 'snippet'}.py`;
  const dir = store.projectPath(SNIPPET_PROJECT);
  if (!(await store.exists(dir))) {
    await store.createProject(SNIPPET_PROJECT, 'leer');
    await store.writeFile(`${dir}/README.md`, '# Spickzettel\n\nSnippets aus Toollib, die Fenster öffnen (tkinter, Qt), landen hier und laufen in Kobra.\n');
  }
  await store.writeFile(`${dir}/${file}`, String(code || ''));
  if (state.project !== SNIPPET_PROJECT) await openProject(SNIPPET_PROJECT);
  else { await refreshTree(); syncProjectToWorker(false); }
  await openFile(file);
  // Python lädt vielleicht noch: warten; die Dateien des Projekts müssen drin sein, dann wie mit ▶
  for (let i = 0; i < 600 && state.runnerState === 'loading'; i++) await new Promise((r) => setTimeout(r, 100));
  await syncProjectToWorker(true);
  await runCurrent([], file);
}
