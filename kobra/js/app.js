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
import { snippetGroups } from './snippets.js';
import { relabelRoot } from './markup.js';
import { renderSpickzettel } from './spickzettel.js';
import { t as tr, getLang, onLangChange } from '../../app/i18n/i18n.js';

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
  onLangChange(() => relabel());   // 0.24.0: Sprache in Toollib gewechselt
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
      pill.querySelector('span').textContent = count === 1 ? tr('kobra.gui.oneWindow') : tr('kobra.gui.windows', { count });
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
const NAV = [['files', 'files', 'kobra.nav.files'], ['code', 'code', ''], ['console', 'terminal', 'kobra.nav.console'], ['packages', 'package', 'kobra.nav.packages'], ['git', 'git', '']];
const navLabel = (view) => { const n = NAV.find((x) => x[0] === view); return n?.[2] ? tr(n[2]) : { code: 'Code', git: 'Git' }[view]; };

function buildShell() {
  const navEl = $('#nav');
  for (const [view, ic] of NAV) {
    const b = h('button', { class: 'nav-btn', type: 'button', dataset: { view }, html: `${icon(ic)}<span>${esc(navLabel(view))}</span><i class="badge-dot" hidden></i>` });
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
  $('#gui-pill').innerHTML = `${icon('window')}<span>${esc(tr('kobra.gui.window'))}</span>`;
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
  // 0.24.0: Name und Beispiele in Toollibs Sprache (bestehende Projekte bleiben, wie sie sind)
  const de = getLang() === 'de';
  const name = tr('kobra.welcome.name');
  const dir = await store.createProject(name, 'hallo');
  const files = {
    'README.md': tr('kobra.welcome.readme'),
    'tk_demo.py': store.TEMPLATES.tkinter.files['main.py'],
    'qt_demo.py': store.TEMPLATES.pyqt.files['main.py'],
    'plot_demo.py': de
      ? `import numpy as np\nimport matplotlib.pyplot as plt\n\nx = np.linspace(0, 4 * np.pi, 400)\nfor n in range(1, 4):\n    plt.plot(x, np.sin(n * x) / n, label=f"sin({n}x)/{n}")\nplt.legend()\nplt.title("Ein paar Obertöne")\nplt.grid(alpha=0.3)\nplt.show()\n`
      : `import numpy as np\nimport matplotlib.pyplot as plt\n\nx = np.linspace(0, 4 * np.pi, 400)\nfor n in range(1, 4):\n    plt.plot(x, np.sin(n * x) / n, label=f"sin({n}x)/{n}")\nplt.legend()\nplt.title("A few overtones")\nplt.grid(alpha=0.3)\nplt.show()\n`,
    'animation_demo.py': de
      ? `import tkinter as tk\n\nroot = tk.Tk()\nroot.title("Ball")\ncanvas = tk.Canvas(root, width=320, height=220, bg="white")\ncanvas.pack()\nball = canvas.create_oval(10, 10, 40, 40, fill="tomato", outline="")\ndx, dy = 4, 3\n\n\ndef schritt():\n    global dx, dy\n    x1, y1, x2, y2 = canvas.coords(ball)\n    if x1 + dx < 0 or x2 + dx > 320:\n        dx = -dx\n    if y1 + dy < 0 or y2 + dy > 220:\n        dy = -dy\n    canvas.move(ball, dx, dy)\n    root.after(16, schritt)\n\n\ndef ziehen(event):\n    canvas.coords(ball, event.x - 15, event.y - 15, event.x + 15, event.y + 15)\n\n\ncanvas.bind("<B1-Motion>", ziehen)\nschritt()\nroot.mainloop()\n`
      : `import tkinter as tk\n\nroot = tk.Tk()\nroot.title("Ball")\ncanvas = tk.Canvas(root, width=320, height=220, bg="white")\ncanvas.pack()\nball = canvas.create_oval(10, 10, 40, 40, fill="tomato", outline="")\ndx, dy = 4, 3\n\n\ndef step():\n    global dx, dy\n    x1, y1, x2, y2 = canvas.coords(ball)\n    if x1 + dx < 0 or x2 + dx > 320:\n        dx = -dx\n    if y1 + dy < 0 or y2 + dy > 220:\n        dy = -dy\n    canvas.move(ball, dx, dy)\n    root.after(16, step)\n\n\ndef drag(event):\n    canvas.coords(ball, event.x - 15, event.y - 15, event.x + 15, event.y + 15)\n\n\ncanvas.bind("<B1-Motion>", drag)\nstep()\nroot.mainloop()\n`,
  };
  for (const [p, c] of Object.entries(files)) await store.writeFile(`${dir}/${p}`, c);
  savePref(`tabs.${name}`, ['main.py', 'README.md']);
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
    if (changed.length) consoleView.info(changed.length > 3 ? tr('kobra.files.savedMore', { names, n: changed.length - 3 }) : tr('kobra.files.saved', { names }), 'ok');
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
    btn('plus', tr('kobra.file.new'), () => newFile('')),
    btn('folder', tr('kobra.folder.new'), () => newFolder('')),
    btn('upload', tr('kobra.file.import'), () => importFiles('')),
    btn('search', tr('kobra.find.inFiles'), () => findInFiles()),
    btn('more', tr('kobra.project'), () => projectMenu()),
  );
}

function renderTree() {
  const el = $('#tree');
  el.textContent = '';
  if (!state.tree.length) {
    el.append(h('p', { class: 'empty', text: tr('kobra.tree.empty') }));
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
      // deep folders indent at most six steps, so a name keeps room on a phone (0.27.2)
      const row = h('div', { class: `tree-row${f.path === state.active ? ' on' : ''}`, role: 'treeitem', title: f.path, style: { paddingLeft: `${10 + Math.min(depth, 6) * 16}px` } });
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
        row.innerHTML = `<span class="tree-chev-space"></span>${icon(py ? 'py' : 'file', `tree-ic ${py ? 'py' : ''}`)}<span class="tree-name"></span>${f.path === startFile ? `<span class="tree-tag">${esc(tr('kobra.start'))}</span>` : ''}<span class="tree-size"></span>`;
        row.querySelector('.tree-name').textContent = name;
        row.querySelector('.tree-size').textContent = formatBytes(f.size || 0);
        row.addEventListener('click', () => openFile(f.path));
      }
      const more = h('button', { class: 'icon-btn small tree-more', type: 'button', 'aria-label': tr('kobra.file.actions', { name }), html: icon('more') });
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
    ? [{ label: tr('kobra.file.newHere'), icon: 'plus', value: 'newfile' }, { label: tr('kobra.folder.newHere'), icon: 'folder', value: 'newdir' }, { label: tr('kobra.file.importHere'), icon: 'upload', value: 'import' }, '-',
      { label: tr('kobra.file.rename'), icon: 'edit', value: 'rename' }, { label: tr('kobra.delete'), icon: 'trash', value: 'delete', danger: true }]
    : [{ label: tr('kobra.open'), icon: 'code', value: 'open' }, ...(f.path.endsWith('.py') ? [{ label: tr('kobra.run'), icon: 'play', value: 'run' }, { label: tr('kobra.file.setMain'), icon: 'check', value: 'main' }] : []), '-',
      { label: tr('kobra.file.rename'), icon: 'edit', value: 'rename' }, { label: tr('kobra.file.duplicate'), icon: 'copy', value: 'dup' }, { label: tr('kobra.file.share'), icon: 'download', value: 'share' },
      { label: tr('kobra.delete'), icon: 'trash', value: 'delete', danger: true }];
  const v = await actionSheet(f.path, items);
  if (!v) return;
  const dir = projectDir();
  try {
    if (v === 'open') openFile(f.path);
    else if (v === 'run') { await openFile(f.path, { noView: true }); runCurrent(); }
    else if (v === 'main') { savePref(`main.${state.project}`, f.path); renderTree(); toast(tr('kobra.file.isMain', { path: f.path }), 'ok'); }
    else if (v === 'newfile') newFile(f.path);
    else if (v === 'newdir') newFolder(f.path);
    else if (v === 'import') importFiles(f.path);
    else if (v === 'rename') {
      const to = await promptDialog(isDir ? tr('kobra.folder.rename') : tr('kobra.file.renameTitle'), { label: tr('kobra.file.newPath'), value: f.path, validate: (s) => validPath(s, f.path) });
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
      let to = tr('kobra.file.copyName', { base, ext });
      for (let i = 2; await store.exists(`${dir}/${to}`); i++) to = tr('kobra.file.copyNameN', { base, i, ext });
      await store.writeFile(`${dir}/${to}`, await store.readBytes(`${dir}/${f.path}`));
      await refreshTree();
      syncFile(to);
    } else if (v === 'share') {
      const data = await store.readBytes(`${dir}/${f.path}`);
      shareOrDownload(new Blob([data]), store.basename(f.path));
    } else if (v === 'delete') {
      if (!(await confirmDialog(tr('kobra.delete'), tr(isDir ? 'kobra.file.deleteDirConfirm' : 'kobra.file.deleteConfirm', { path: f.path }), { okLabel: tr('kobra.delete'), danger: true }))) return;
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
  if (!v) return tr('kobra.name.empty');
  if (v.startsWith('/') || v.includes('..') || /[\\:*?"<>|]/.test(v)) return tr('kobra.file.badPath');
  if (v !== original && state.tree.some(f => f.path === v)) return tr('kobra.file.exists');
  return null;
}

async function newFile(inDir) {
  const name = await promptDialog(tr('kobra.file.new'), { label: tr('kobra.file.name'), value: inDir ? `${inDir}/` : '', placeholder: tr('kobra.file.nameExample'), validate: (s) => validPath(s), hint: tr('kobra.file.nameHint') });
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
  const name = await promptDialog(tr('kobra.folder.new'), { label: tr('kobra.folder.name'), value: inDir ? `${inDir}/` : '', validate: (s) => validPath(s), hint: tr('kobra.folder.hint') });
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
    if (f.name.toLowerCase().endsWith('.zip') && files.length === 1 && await confirmDialog('ZIP-Archiv', tr('kobra.zip.asProject', { name: f.name }), { okLabel: tr('kobra.zip.project'), cancelLabel: tr('kobra.zip.file') })) {
      const name = await store.importZip(f, f.name.replace(/\.zip$/i, ''));
      toast(tr('kobra.zip.imported', { name }), 'ok');
      await openProject(name);
      return;
    }
    const rel = inDir ? `${inDir}/${f.name}` : f.name;
    await store.writeFile(`${dir}/${rel}`, new Uint8Array(await f.arrayBuffer()), { noFlush: true });
  }
  await store.flush();
  toast(files.length > 1 ? tr('kobra.file.importedN', { n: files.length }) : tr('kobra.file.importedOne'), 'ok');
  await refreshTree();
  syncProjectToWorker(false);
}

async function projectMenu() {
  const v = await actionSheet(tr('kobra.project.title', { project: state.project }), [
    { label: tr('kobra.project.switch'), icon: 'folder', value: 'switch' },
    { label: tr('kobra.project.zip'), icon: 'zip', value: 'zip' },
    { label: tr('kobra.rename'), icon: 'edit', value: 'rename' },
    { label: tr('kobra.file.duplicate'), icon: 'copy', value: 'dup' },
    '-',
    { label: tr('kobra.project.delete'), icon: 'trash', value: 'delete', danger: true },
  ]);
  if (!v) return;
  try {
    if (v === 'switch') openProjectsSheet();
    else if (v === 'zip') {
      await saveAll(false);
      const blob = await store.exportZip(state.project);
      shareOrDownload(blob, `${state.project}.zip`);
    } else if (v === 'rename') {
      const name = await promptDialog(tr('kobra.project.rename'), { value: state.project, validate: store.validName });
      if (!name || name === state.project) return;
      await saveAll(false);
      const old = state.project;
      await store.renameProject(old, name.trim());
      savePref(`tabs.${name.trim()}`, state.tabs);
      await openProject(name.trim());
    } else if (v === 'dup') {
      const name = await promptDialog(tr('kobra.project.duplicate'), { value: tr('kobra.project.copyName', { project: state.project }), validate: store.validName });
      if (!name) return;
      await saveAll(false);
      await store.duplicateProject(state.project, name.trim());
      await openProject(name.trim());
    } else if (v === 'delete') {
      if (!(await confirmDialog(tr('kobra.project.delete'), tr('kobra.project.deleteConfirm', { project: state.project }), { okLabel: tr('kobra.project.deleteOk'), danger: true }))) return;
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
  const sheet = openSheet(tr('kobra.projects'), body);
  const here = new Set();
  for (const p of list) {
    const row = h('button', { class: `project-row${p.name === state.project ? ' on' : ''}`, type: 'button', title: p.name, html: `${icon('folder')}<span class="pname"></span>${p.git ? `<span class="tree-tag">Git</span>` : ''}` });
    row.querySelector('.pname').textContent = p.name;
    row.addEventListener('click', async () => { sheet.close(); await openProject(p.name); showView(isWide() ? 'code' : 'files'); });
    body.append(row);
    if (p.git) { const url = await gitService.originUrl(p.name); if (url) here.add(repoKey(url)); }
  }
  // Deine Repositorys, die auf diesem Gerät noch fehlen (die Liste kommt mit der verschlüsselten Einstellungsdatei)
  const missing = repos().filter((r) => !here.has(repoKey(r.url)));
  if (missing.length) {
    body.append(h('h4', { class: 'project-sub', text: tr('kobra.projects.notHere') }));
    for (const r of missing) {
      const acc = r.account && account(r.account);
      const row = h('div', { class: 'project-row remote' },
        h('span', { class: 'muted', html: icon('cloudDown') }),
        h('span', { class: 'pname' }, h('span', { text: r.name || r.url.replace(/^https:\/\//, '') }), h('small', { class: 'muted', text: ` ${r.url.replace(/^https:\/\//, '')}${acc ? ` · ${accountLabel(acc)}` : ''}` })));
      const get = h('button', { class: 'btn small primary', type: 'button', text: tr('kobra.git.pull'), 'aria-label': tr('kobra.projects.fetchHere', { v: r.name || r.url }) });
      get.addEventListener('click', () => { sheet.close(); gitPanel.cloneDialog(r.url, r.name); });
      const drop = h('button', { class: 'icon-btn small', type: 'button', html: icon('close'), 'aria-label': tr('kobra.projects.forget'), title: tr('kobra.projects.forget') });
      drop.addEventListener('click', async () => {
        if (!(await confirmDialog(tr('kobra.projects.forget'), tr('kobra.projects.forgetConfirm', { v: r.name || r.url }), { okLabel: tr('kobra.projects.forgetOk') }))) return;
        forgetRepo(r.url); row.remove();
      });
      row.append(get, drop);
      body.append(row);
    }
  }
  const actions = h('div', { class: 'btn-col' });
  const newBtn = h('button', { class: 'btn primary', type: 'button', html: `${icon('plus')}<span>${esc(tr('kobra.project.new'))}</span>` });
  newBtn.addEventListener('click', async () => { sheet.close(); newProjectDialog(); });
  const zipBtn = h('button', { class: 'btn', type: 'button', html: `${icon('zip')}<span>${esc(tr('kobra.zip.import'))}</span>` });
  zipBtn.addEventListener('click', async () => {
    const files = await pickFiles({ accept: '.zip,application/zip', multiple: false });
    if (!files[0]) return;
    try {
      const name = await store.importZip(files[0], files[0].name.replace(/\.zip$/i, ''));
      sheet.close();
      toast(tr('kobra.zip.imported', { name }), 'ok');
      await openProject(name);
    } catch (e) { toast(e.message, 'error'); }
  });
  const cloneBtn = h('button', { class: 'btn', type: 'button', html: `${icon('cloudDown')}<span>${esc(tr('kobra.git.cloneFromGithub'))}</span>` });
  cloneBtn.addEventListener('click', () => { sheet.close(); gitPanel.cloneDialog(); });
  actions.append(newBtn, zipBtn, cloneBtn);
  if (here.size) {
    const allBtn = h('button', { class: 'btn', type: 'button', id: 'pull-all', html: `${icon('refresh')}<span>${esc(tr('kobra.projects.pullAll'))}</span>` });
    allBtn.addEventListener('click', () => { sheet.close(); pullAll(); });
    actions.append(allBtn);
  }
  body.append(actions);
}

// Holt jedes Projekt, das mit GitHub verbunden ist. Projekte mit Änderungen, die noch nicht committet sind, bleiben
// unberührt; hochgeladen wird nichts.
async function pullAll() {
  if (!loadPref('git.proxy', '')) { toast(tr('kobra.git.pullNeedsProxy'), 'error', 5000); openSettings('git'); return; }
  await saveAll(false);
  const rows = [];
  const box = h('div', { class: 'pull-all' });
  const sheet = openSheet(tr('kobra.projects.pullAll'), box);
  const line = (name) => { const st = h('span', { class: 'muted', text: tr('kobra.projects.waiting') }); box.append(h('div', { class: 'pull-row' }, h('span', { class: 'pname', text: name }), st)); return st; };
  const list = (await store.listProjects()).filter((p) => p.git);
  const jobs = [];
  for (const p of list) if (await gitService.originUrl(p.name)) jobs.push({ name: p.name, st: line(p.name) });
  let changed = false;
  for (const j of jobs) {
    j.st.textContent = tr('kobra.projects.pulling');
    try {
      const status = await gitService.status(j.name);
      if (status.some((x) => x.kind !== '?')) { j.st.textContent = tr('kobra.projects.skipped'); j.st.className = 'warn'; continue; }
      const before = (await gitService.log(j.name, 1))[0]?.oid;
      await gitService.pull(j.name);
      const after = (await gitService.log(j.name, 1))[0]?.oid;
      const ahead = await gitService.ahead(j.name);
      j.st.textContent = before === after ? 'schon aktuell' : 'aktualisiert';
      if (ahead) j.st.textContent += tr('kobra.projects.ahead', { ahead });
      j.st.className = 'ok';
      if (before !== after && j.name === state.project) changed = true;
    } catch (e) { j.st.textContent = explainGitError(e); j.st.className = 'error'; }
    rows.push(j);
  }
  if (!jobs.length) box.append(h('p', { class: 'empty', text: tr('kobra.projects.noRemote') }));
  if (changed) { await refreshTree(); await reloadOpenFiles(); syncProjectToWorker(true); }
  gitPanel.refresh();
  return sheet;
}

async function newProjectDialog() {
  const nameInput = h('input', { class: 'field', type: 'text', placeholder: tr('kobra.project.name'), autocapitalize: 'off', autocorrect: 'off', id: 'new-project-name' });
  const tplWrap = h('div', { class: 'tpl-list' });
  let tpl = 'hallo';
  for (const [key, t] of Object.entries(store.TEMPLATES)) {
    const b = h('button', { class: `tpl${key === tpl ? ' on' : ''}`, type: 'button', text: t.label });
    b.addEventListener('click', () => { tpl = key; tplWrap.querySelectorAll('.tpl').forEach(x => x.classList.toggle('on', x === b)); });
    tplWrap.append(b);
  }
  const err = h('div', { class: 'field-error' });
  const body = h('div', { class: 'form' }, h('label', { class: 'field-label', text: tr('kobra.name') }), nameInput, h('label', { class: 'field-label', text: tr('kobra.project.template') }), tplWrap, err);
  const name = await modal({
    title: tr('kobra.project.new'),
    body,
    actions: [{ label: tr('kobra.cancel'), value: null }, { label: tr('kobra.create'), kind: 'primary', value: () => {
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
  const input = h('input', { class: 'field', type: 'search', placeholder: tr('kobra.find.term'), autocapitalize: 'off', autocorrect: 'off', id: 'find-input' });
  const results = h('div', { class: 'find-results' });
  const body = h('div', { class: 'form' }, input, results);
  const sheet = openSheet(tr('kobra.find.inFiles'), body, { full: true });
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
    if (!count) results.append(h('p', { class: 'empty', text: tr('kobra.nothingFound') }));
  }, 250);
  input.addEventListener('input', run);
  setTimeout(() => input.focus(), 80);
}

// ================================================================ Editor-Tabs
async function openFile(path, { line, col, noView } = {}) {
  const full = `${projectDir()}/${path}`;
  if (!(await store.exists(full))) { toast(tr('kobra.file.notFound', { path }), 'error'); return; }
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
  // a file in folders shows as …/name (the full path as a tooltip), so a long path never hides the file's name (0.27.2)
  $('#file-name').textContent = path.includes('/') ? `…/${store.basename(path)}` : path;
  $('#file-name').title = path;
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
    body.append(h('p', { class: 'hint', text: tr('kobra.file.binary', { v: formatBytes(data.length) }) }));
  }
  const share = h('button', { class: 'btn', type: 'button', html: `${icon('download')}<span>${esc(tr('kobra.file.share'))}</span>` });
  share.addEventListener('click', () => shareOrDownload(new Blob([data]), store.basename(path)));
  body.append(share);
  openSheet(path, body);
}

function showEmptyEditor() {
  $('#editor-empty').hidden = false;
  $('#file-name').textContent = '';
  $('#file-name').title = '';
}

function persistTabs() { savePref(`tabs.${state.project}`, state.tabs); }

function renderTabs() {
  const el = $('#tabs');
  el.textContent = '';
  for (const p of state.tabs) {
    const t = h('div', { class: `tab${p === state.active ? ' on' : ''}${editor?.isDirty(p) ? ' dirty' : ''}`, role: 'tab', dataset: { path: p } });
    const label = h('button', { class: 'tab-label', type: 'button', title: p }, h('span', { class: 'tab-text', text: store.basename(p) }));
    label.addEventListener('click', () => openFile(p));
    const close = h('button', { class: 'tab-close', type: 'button', 'aria-label': tr('kobra.tab.close', { p }), html: icon('close') });
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
    toast(tr('kobra.file.saveFailed', { message: e.message }), 'error');
  }
}

async function saveAll(showToast) {
  autosave.cancel?.();
  for (const p of state.tabs) await saveFile(p);
  if (showToast) toast(tr('kobra.saved'), 'ok', 1200);
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
    tapKeepFocus(b, () => { if (!(b.parentElement === mid && mid.dataset.swiped)) fn(); });   // a key you swiped over does not type
    return b;
  };
  left.append(key(icon('tab'), () => editor.key('tab'), 'wide', 'Tab'), key(icon('blocks'), () => openSnippets(), 'accent', tr('kobra.blocks')));
  mid.append(
    key(icon('dedent'), () => editor.key('dedent'), '', tr('kobra.key.outdent')),
    key(icon('arrowLeft'), () => editor.key('left'), '', tr('kobra.key.left')), key(icon('arrowRight'), () => editor.key('right'), '', tr('kobra.key.right')),
    key(icon('arrowUp'), () => editor.key('up'), '', tr('kobra.key.up')), key(icon('arrowDown'), () => editor.key('down'), '', tr('kobra.key.down')),
  );
  for (const ch of ['(', ')', ':', '=', '"', "'", '[', ']', '{', '}', '.', ',', '_', '#', '+', '-', '*', '/', '<', '>', '!', '%', '&', '|', '\\', '@', '~', '^']) {
    mid.append(key(ch, () => editor.insertText(ch), 'char'));
  }
  mid.append(
    key(icon('undo'), () => editor.key('undo'), '', tr('kobra.key.undo')), key(icon('redo'), () => editor.key('redo'), '', tr('kobra.key.redo')),
    key(icon('comment'), () => editor.key('comment'), '', tr('kobra.key.comment')),
    key(icon('sparkle'), () => editor.key('complete'), '', tr('kobra.key.suggest')),
    key(icon('book'), () => showDocs(), '', tr('kobra.key.docs')),
  );
  right.append(key(icon('keyboardDown'), () => editor.blur(), '', tr('kobra.key.hideKeyboard')));
  bar.append(left, mid, right);
  swipeScroll(mid);
  const host = $('#editor');
  if (host.dataset.kbWired) return;   // nach einem Sprachwechsel nur die Tasten neu
  host.dataset.kbWired = '1';
  host.addEventListener('focusin', () => document.body.classList.add('editing'));
  host.addEventListener('focusout', () => setTimeout(() => {
    if (!host.contains(document.activeElement)) document.body.classList.remove('editing');
  }, 100));
}

// The middle of the key bar scrolls sideways with the finger (0.27.2, ENTE: "I can't scroll in the symbols").
// Every key swallows its touch (tapKeepFocus, so the keyboard stays open), which also stopped the browser from
// scrolling the strip. So the strip scrolls itself: it follows the finger, glides on a little after a swipe, and
// marks the touch as a swipe so the key under the finger does not type.
// For Python readers: touchstart/touchmove/touchend are the finger going down, moving and lifting; scrollLeft is
// how far the strip is scrolled, in pixels.
function swipeScroll(strip) {
  let x0 = 0; let s0 = 0; let lastX = 0; let lastT = 0; let speed = 0; let raf = 0;
  strip.addEventListener('touchstart', (e) => {
    cancelAnimationFrame(raf);
    const t = e.touches[0];
    x0 = lastX = t.clientX; s0 = strip.scrollLeft; lastT = performance.now(); speed = 0;
    strip.dataset.swiped = '';
  }, { passive: true, capture: true });
  strip.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    const dx = t.clientX - x0;
    if (!strip.dataset.swiped && Math.abs(dx) < 8) return;
    if (!strip.dataset.swiped) strip.querySelectorAll('.kb-key.pressed').forEach((k) => k.classList.remove('pressed'));
    strip.dataset.swiped = '1';
    strip.scrollLeft = s0 - dx;
    const now = performance.now();
    speed = (t.clientX - lastX) / Math.max(1, now - lastT);   // pixels per millisecond
    lastX = t.clientX; lastT = now;
  }, { passive: true });
  strip.addEventListener('touchend', () => {
    if (!strip.dataset.swiped) return;
    let step = -speed * 16;   // pixels per frame
    const glide = () => {
      if (Math.abs(step) < 0.5) return;
      strip.scrollLeft += step;
      step *= 0.94;
      raf = requestAnimationFrame(glide);
    };
    raf = requestAnimationFrame(glide);
  }, { passive: true });
}

function openSnippets() {
  const search = h('input', { class: 'field', type: 'search', placeholder: tr('kobra.blocks.searchOne'), autocapitalize: 'off', autocorrect: 'off', id: 'snippet-search' });
  const list = h('div', { class: 'snippet-groups' });
  const body = h('div', {}, search, list);
  const sheet = openSheet(tr('kobra.blocks'), body, { full: false });
  // Bausteine aus Toollibs Spickzettel; ohne abgeglichenes Wissen Kobras eigene (render)
  const insert = (code) => {
    sheet.close();
    if (!state.active) { toast(tr('kobra.file.openFirst'), 'error'); return; }
    showView('code');
    setTimeout(() => editor.insertBody(code), 30);
  };
  renderSpickzettel(search, list, insert).then((ok) => { if (!ok) { search.addEventListener('input', render); render(); } });
  const render = () => {
    const q = search.value.trim().toLowerCase();
    list.textContent = '';
    for (const g of snippetGroups()) {
      const items = g.items.filter(i => !q || i.label.toLowerCase().includes(q) || (i.detail || '').toLowerCase().includes(q) || i.body.toLowerCase().includes(q));
      if (!items.length) continue;
      const grid = h('div', { class: 'snippet-grid' });
      for (const it of items) {
        const b = h('button', { class: 'snippet', type: 'button' }, h('code', { text: it.label }), h('span', { text: it.detail || '' }));
        b.addEventListener('click', () => {
          sheet.close();
          if (!state.active) { toast(tr('kobra.file.openFirst'), 'error'); return; }
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
  if (!info || !info.name) { toast(runner.state === 'ready' || runner.state === 'gui' ? tr('kobra.docs.none') : tr('kobra.python.stillLoading')); return; }
  const body = h('div', { class: 'docs' });
  body.append(h('div', { class: 'docs-full', text: `${info.full} · ${info.type}` }));
  for (const s of info.sig || []) body.append(h('pre', { class: 'docs-sig', text: s }));
  body.append(h('pre', { class: 'docs-text', text: info.doc || tr('kobra.docs.noDescription') }));
  openSheet(info.name, body, { full: true });
}

// ============================================================== Ausfuehren
function onRunnerStatus(st, msg) {
  state.runnerState = st;
  const dot = $('#py-status');
  dot.className = `py-status s-${st}`;
  dot.title = { loading: msg || tr('kobra.status.loading'), ready: tr('kobra.status.ready', { v: runner.python || '' }), running: tr('kobra.status.running'), gui: tr('kobra.status.gui'), error: msg || tr('kobra.error') }[st] || '';
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
  b.innerHTML = running ? `${icon('stop')}<span>${esc(tr('kobra.stop'))}</span>` : `${icon('play')}<span>${esc(tr('kobra.start'))}</span>`;
  b.disabled = state.runnerState === 'loading' && !running ? false : false;
}

async function runCurrent(argv = [], entryOverride) {
  if (!state.project) return;
  if (state.runnerState === 'loading') { toast(tr('kobra.python.stillLoadingRun')); return; }
  if (state.runnerState === 'error' || state.runnerState === 'off') { runner.restart({ packages: PackagePanel.wanted(), version: VERSION }); toast(tr('kobra.python.restarting')); return; }
  if (state.runnerState === 'running') return;
  await saveAll(false);
  let entry = entryOverride;
  if (!entry) {
    entry = state.active && state.active.endsWith('.py') ? state.active : loadPref(`main.${state.project}`, 'main.py');
    if (!state.tree.some(f => f.path === entry)) entry = state.tree.find(f => f.type === 'file' && f.path.endsWith('.py'))?.path;
  }
  if (!entry) { toast(tr('kobra.run.noFile'), 'error'); return; }
  if (loadPref('clearOnRun', true)) consoleView.clear();
  runner.run(state.project, entry, argv);
  if (!isWide()) showView('console');
  else $('#nav [data-view="console"] .badge-dot').hidden = true;
}

async function runMenu() {
  const startFile = loadPref(`main.${state.project}`, 'main.py');
  const v = await actionSheet(tr('kobra.run'), [
    { label: tr('kobra.run.current', { v: state.active ? ` (${store.basename(state.active)})` : '' }), icon: 'play', value: 'cur', disabled: !state.active?.endsWith('.py') },
    { label: tr('kobra.run.main', { startFile }), icon: 'play', value: 'main' },
    { label: tr('kobra.run.withArgs'), icon: 'terminal', value: 'args' },
    '-',
    { label: tr('kobra.python.restart'), icon: 'refresh', value: 'restart' },
  ]);
  if (v === 'cur') runCurrent();
  else if (v === 'main') runCurrent([], startFile);
  else if (v === 'args') {
    const a = await promptDialog(tr('kobra.run.args'), { value: loadPref(`args.${state.project}`, ''), placeholder: '--zahl 5 datei.txt' });
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
  consoleView.info(tr('kobra.python.restarting'));
  runner.restart({ packages: PackagePanel.wanted(), version: VERSION });
}

async function runRepl(code) {
  if (state.runnerState === 'running') { consoleView.info(tr('kobra.repl.busy'), 'warn'); return; }
  if (state.runnerState === 'loading') { consoleView.info(tr('kobra.python.stillLoading'), 'warn'); return; }
  try { await runner.call('repl', { code, project: state.project }, 0); } catch (e) { /* Ausgabe kam ueber stderr */ }
}

async function installRequirements() {
  const path = `${projectDir()}/requirements.txt`;
  if (!(await store.exists(path))) { toast(tr('kobra.pkg.noRequirements'), 'error'); return; }
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
    btn('eraser', tr('kobra.console.clear'), () => consoleView.clear()),
    btn('vars', tr('kobra.vars'), () => showVariables()),
    btn('refresh', tr('kobra.python.restartShort'), () => restartPython()),
  );
}

async function showVariables() {
  let vars = [];
  try { vars = await runner.call('vars', {}, 8000); } catch (e) { toast(tr('kobra.vars.unavailable'), 'error'); return; }
  const body = h('div', { class: 'vars' });
  if (!vars.length) body.append(h('p', { class: 'empty', text: tr('kobra.vars.none') }));
  else {
    const table = h('table', { class: 'vars-table' }, h('thead', {}, h('tr', {}, h('th', { text: tr('kobra.name') }), h('th', { text: tr('kobra.vars.type') }), h('th', { text: tr('kobra.vars.value') }))));
    const tb = h('tbody');
    for (const v of vars) tb.append(h('tr', {}, h('td', { class: 'mono', text: v.n }), h('td', { text: v.t }), h('td', { class: 'mono', text: v.v })));
    table.append(tb);
    body.append(h('div', { class: 'table-scroll' }, table));
  }
  openSheet(tr('kobra.vars'), body, { full: true });
}

// ============================================================ Mehr-Menue
async function moreMenu() {
  const py = state.active?.endsWith('.py');
  const v = await actionSheet(null, [
    { label: tr('kobra.menu.search'), icon: 'search', value: 'search', disabled: !state.active },
    { label: tr('kobra.menu.line'), icon: 'arrowDown', value: 'line', disabled: !state.active },
    { label: tr('kobra.menu.outline'), icon: 'outline', value: 'outline', disabled: !py },
    { label: tr('kobra.menu.problems'), icon: 'warn', value: 'problems', disabled: !py, detail: state.diagnostics.length ? String(state.diagnostics.length) : '' },
    { label: tr('kobra.menu.goto'), icon: 'arrowRight', value: 'goto', disabled: !py },
    { label: tr('kobra.menu.rename'), icon: 'edit', value: 'rename', disabled: !py },
    { label: tr('kobra.menu.format'), icon: 'format', value: 'format', disabled: !py },
    { label: tr('kobra.menu.docs'), icon: 'book', value: 'docs', disabled: !py },
    '-',
    { label: tr('kobra.find.inFiles'), icon: 'search', value: 'find' },
    { label: tr('kobra.toSnippet'), icon: 'copy', value: 'snippet', disabled: !state.active },
    { label: tr('kobra.settings'), icon: 'settings', value: 'settings' },
  ]);
  if (!v) return;
  if (v === 'search') { showView('code'); editor.search(); }
  else if (v === 'line') {
    const n = await promptDialog(tr('kobra.menu.lineTitle'), { type: 'number', validate: (s) => /^\d+$/.test(s) ? null : tr('kobra.menu.needNumber') });
    if (n) { showView('code'); editor.gotoLine(parseInt(n, 10)); }
  } else if (v === 'outline') showOutline();
  else if (v === 'problems') showProblems();
  else if (v === 'goto') gotoDefinition();
  else if (v === 'rename') renameSymbol();
  else if (v === 'format') formatCode();
  else if (v === 'docs') showDocs();
  else if (v === 'find') findInFiles();
  else if (v === 'snippet') toSnippet();
  else if (v === 'settings') openSettings();
}

async function showOutline() {
  let items = [];
  try { items = await runner.lsp('outline', { code: editor.content(), project: state.project, file: state.active }, 5000) || []; } catch (e) { items = []; }
  const body = h('div', { class: 'outline' });
  if (!items.length) body.append(h('p', { class: 'empty', text: tr('kobra.outline.none') }));
  const sheet = openSheet(tr('kobra.menu.outline'), body);
  for (const it of items) {
    const b = h('button', { class: `outline-row k-${it.k}`, type: 'button', style: { paddingLeft: `${12 + it.d * 18}px` } },
      h('span', { class: 'outline-kind', text: { class: 'K', def: 'ƒ', const: 'C', main: '▶' }[it.k] || '·' }), h('span', { text: it.n }), h('span', { class: 'muted', text: String(it.l) }));
    b.addEventListener('click', () => { sheet.close(); showView('code'); editor.gotoLine(it.l); });
    body.append(b);
  }
}

function showProblems() {
  const body = h('div', { class: 'outline' });
  const sheet = openSheet(tr('kobra.menu.problems'), body);
  if (!state.diagnostics.length) body.append(h('p', { class: 'empty', text: tr('kobra.problems.none') }));
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
  if (!res || (!res.line && !res.external)) { toast(tr('kobra.goto.none')); return; }
  if (res.external) { toast(tr('kobra.goto.external', { external: res.external })); return; }
  if (res.path) openFile(res.path, { line: res.line, col: res.col });
  else editor.gotoLine(res.line, res.col);
}

async function renameSymbol() {
  const word = editor.selectionText() || '';
  const name = await promptDialog(tr('kobra.rename.title'), { label: tr('kobra.rename.prompt'), value: word, validate: (s) => /^[A-Za-z_À-ɏ][\wÀ-ɏ]*$/.test(s) ? null : tr('kobra.rename.invalid') });
  if (!name) return;
  const n = await editor.renameSymbol(name).catch(() => 0);
  toast(n ? tr('kobra.rename.done', { n }) : tr('kobra.rename.cursor'), n ? 'ok' : 'error');
}

async function formatCode() {
  toast(tr('kobra.format.running'), 'info', 1200);
  try {
    const res = await runner.lsp('format', { code: editor.content(), project: state.project, file: state.active }, 120000);
    if (res?.code != null) { editor.replaceAll(res.code); toast(tr('kobra.format.done'), 'ok'); }
    else if (res?.error === 'missing') toast(tr('kobra.format.unavailable'), 'error');
    else if (res?.error) toast(tr('kobra.format.failed', { error: res.error }), 'error', 5000);
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
          h('small', { class: 'muted', text: [a.name, a.email].filter(Boolean).join(' · ') || tr('kobra.acc.noIdentity') })),
        h('span', { class: `acc-token ${a.token ? 'ok' : 'warn'}`, text: a.token ? tr('kobra.acc.token') : tr('kobra.acc.tokenNone') }));
      row.addEventListener('click', async () => { if (await editAccount(a)) draw(); });
      box.append(row);
    }
    const add = h('button', { class: 'btn small', type: 'button', id: 'account-add', html: `${icon('plus')}<span>${esc(tr('kobra.acc.add'))}</span>` });
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
  const label = f('label', tr('kobra.acc.label'), { placeholder: tr('kobra.acc.labelExample') }, a.label);
  const login = f('login', 'GitHub-Name', { placeholder: 'dein-name' }, a.login);
  const name = f('name', tr('kobra.acc.name'), { autocomplete: 'name', placeholder: tr('kobra.acc.nameExample') }, a.name);
  const email = f('email', tr('kobra.acc.email'), { type: 'email', autocomplete: 'email', placeholder: '123+name@users.noreply.github.com' }, a.email);
  const token = f('token', 'GitHub-Token', { type: 'password', autocomplete: 'off', placeholder: 'github_pat_…' }, a.token);
  const host = f('host', tr('kobra.acc.host'), { placeholder: 'github.com' }, a.host === 'github.com' ? '' : a.host);
  const note = h('p', { class: 'hint', id: 'acc-check-result', role: 'status' });
  const check = h('button', { class: 'btn small', type: 'button', id: 'acc-check', html: `${icon('check')}<span>${esc(tr('kobra.acc.check'))}</span>` });
  check.addEventListener('click', async () => {
    note.textContent = tr('kobra.acc.asking');
    const r = await checkToken({ token: token.input.value.trim(), host: host.input.value.trim().toLowerCase() || 'github.com' });
    if (!r.ok) { note.textContent = r.reason; note.className = 'hint error'; return; }
    note.className = 'hint ok';
    note.textContent = tr('kobra.acc.valid', { login: r.login });
    if (!login.input.value.trim()) login.input.value = r.login;
    if (!name.input.value.trim() && r.name) name.input.value = r.name;
    if (!email.input.value.trim()) { email.input.value = r.email; note.textContent += tr('kobra.acc.noreply'); }
  });
  const body = h('div', { class: 'form' }, label.row, login.row, name.row, email.row, token.row,
    h('span', { class: 'set-hint', text: tr('kobra.acc.tokenHint') }),
    h('div', { class: 'btn-row' }, check), note,
    h('details', {}, h('summary', { text: tr('kobra.acc.otherHost') }), host.row));
  const actions = [{ label: tr('kobra.cancel'), value: null }];
  if (!isNew && a.id !== MAIN) actions.unshift({ label: tr('kobra.delete'), kind: 'danger', value: 'delete' });
  actions.push({ label: tr('kobra.save'), kind: 'primary', value: 'save' });
  const v = await modal({ title: isNew ? tr('kobra.acc.new') : accountLabel(a), body, actions, wide: true });
  if (v === 'delete') {
    if (!(await confirmDialog(tr('kobra.acc.delete'), tr('kobra.acc.deleteConfirm', { v: accountLabel(a) }), { okLabel: tr('kobra.delete'), danger: true }))) return false;
    removeAccount(a.id);
    toast(tr('kobra.acc.deleted'), 'ok');
    return true;
  }
  if (v !== 'save') return false;
  const h0 = host.input.value.trim().toLowerCase();
  if (h0 && !/^[a-z0-9.-]{1,100}(:\d{1,5})?$/.test(h0)) { toast(tr('kobra.acc.badHost'), 'error'); return false; }
  try {
    saveAccount({ id: a.id, label: label.input.value, login: login.input.value.replace(/^@/, ''), name: name.input.value, email: email.input.value, token: token.input.value, host: h0 });
  } catch (e) { toast(e.message, 'error'); return false; }
  toast(tr('kobra.acc.saved'), 'ok');
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
    h('section', { class: 'card' }, h('h3', { text: tr('kobra.set.look') }),
      h('label', { class: 'set-field' }, h('span', { class: 'set-label', text: tr('kobra.set.fontSize') }), h('div', { class: 'row-input' }, size, sizeVal)),
      h('label', { class: 'set-switch' }, wrap, h('span', { text: tr('kobra.set.wrap') })),
    ),
    h('section', { class: 'card' }, h('h3', { text: tr('kobra.set.editor') }),
      h('label', { class: 'set-switch' }, autos, h('span', { text: tr('kobra.set.autosave') })),
      h('label', { class: 'set-switch' }, clear, h('span', { text: tr('kobra.set.clearOnRun') })),
    ),
    h('section', { class: 'card', id: 'settings-git' }, h('h3', { text: 'Git & GitHub' }),
      h('p', { class: 'hint', text: tr('kobra.set.accountsHint') }),
      accountsList(),
      field('Git-Proxy', proxy, tr('kobra.set.proxyHint')),
      h('p', { class: 'hint', text: tr('kobra.set.privateHint') }),
    ),
    h('section', { class: 'card' }, h('h3', { text: tr('kobra.set.storage') }),
      h('p', { class: 'hint', text: `${info.quota ? tr('kobra.set.usedOf', { used: formatBytes(info.usage), quota: formatBytes(info.quota) }) : tr('kobra.set.used', { used: formatBytes(info.usage) })} ${tr(info.persisted ? 'kobra.set.persisted' : 'kobra.set.notPersisted')}` }),
    ),
    h('section', { class: 'card' }, h('h3', { text: tr('kobra.set.about') }),
      h('p', { class: 'hint', text: tr('kobra.set.aboutLine', { version: VERSION, python: runner.python || tr('kobra.set.pyLoading'), channel: tr(runner.sync ? 'kobra.set.channelOn' : 'kobra.set.channelOff') }) }),
    ),
  );
  size.addEventListener('input', () => { sizeVal.textContent = `${size.value} px`; editor.configure({ size: +size.value }); });
  const sheet = openSheet(tr('kobra.settings'), body, {
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

// Sprache gewechselt (0.24.0): Kobra bleibt stehen, nur die Texte kommen neu (Gerüst, Leiste, Werkzeugleisten,
// Zusatztasten, Startknopf und was gerade gezeichnet ist). Offene Blätter und alte Konsolenzeilen bleiben, wie sie sind.
function relabel() {
  if (!root || !editor) return;
  relabelRoot(root);
  for (const b of root.querySelectorAll('.nav-btn')) { const sp = b.querySelector('span'); if (sp) sp.textContent = navLabel(b.dataset.view); }
  $('#files-toolbar').textContent = ''; buildFilesToolbar();
  $('#console-toolbar').textContent = ''; buildConsoleToolbar();
  $('#keybar').textContent = ''; buildKeybar();
  if ($('#gui-pill').hidden) $('#gui-pill span').textContent = tr('kobra.gui.window');
  onRunnerStatus(state.runnerState);
  renderTree();
  renderTabs();
  if (packages && !packages.busy) { packages.render(); packages.refresh(); }
  gitPanel?.refresh();
}

// ================================================================== in Toollib (0.22.0)
let started = null;

// Einmal starten; danach nur zeigen und ausblenden.
export function mountKobra(host) {
  if (!started) {
    started = main(host).catch((e) => {
      console.error(e);
      host.append(h('pre', { class: 'fatal', text: tr('kobra.fatal', { v: e.stack || e }) }));
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
  else if (want && typeof want === 'object' && want.project) openFromToollib(want.project).catch((e) => toast(String(e.message || e), 'error'));
}

// „In Kobra öffnen“ in einem Toollib-Projekt (0.24.0): das Projekt zu diesem Repository öffnen; ist es noch nicht
// auf diesem Gerät, kommt der Dialog zum Klonen mit Adresse und Konto.
async function openFromToollib({ url, name }) {
  const key = repoKey(url);
  if (!key) return;
  const known = repos().find((r) => repoKey(r.url) === key);
  const local = (await store.listProjects()).map((p) => p.name);
  const here = known && local.includes(known.name) ? known.name : '';
  if (here) {
    if (state.project !== here) await openProject(here);
    showView(isWide() ? 'code' : 'files');
    return;
  }
  gitPanel.cloneDialog(url, known?.name || String(name || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 60));
}

// Code als Snippet in Toollibs Spickzettel (0.24.0): die Auswahl, sonst die ganze Datei, kommt ins Formular
function toSnippet() {
  if (!state.active || !editor) return;
  const code = (editor.selection?.() || editor.content(state.active) || '').replace(/\s+$/, '');
  if (!code) { toast(tr('kobra.toSnippet.empty'), 'error'); return; }
  const lang = state.active.endsWith('.py') ? 'python' : '';
  try {
    localStorage.setItem('toollib.snippet.draft', JSON.stringify({ title: '', code, check: '', links: [], group: '', ...(lang ? { language: lang } : {}) }));
  } catch { /* voll */ }
  location.hash = '#/new';
}

// Ein Snippet aus Toollib: als Datei im Projekt „Snippets“ („Spickzettel“) ablegen, öffnen und ausführen.
// 0.24.0: Der Name folgt Toollibs Sprache; ein „Spickzettel“ aus 0.23.0 wird weiter benutzt.
async function snippetProject() {
  const name = tr('kobra.snippetProject');
  if (!(await store.exists(store.projectPath(name))) && (await store.exists(store.projectPath('Spickzettel')))) return 'Spickzettel';
  return name;
}
async function runFromToollib({ name, code }) {
  const file = `${String(name || 'snippet').replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(0, 60) || 'snippet'}.py`;
  const SNIPPET_PROJECT = await snippetProject();
  const dir = store.projectPath(SNIPPET_PROJECT);
  if (!(await store.exists(dir))) {
    await store.createProject(SNIPPET_PROJECT, 'leer');
    await store.writeFile(`${dir}/README.md`, tr('kobra.snippetProject.readme'));
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
