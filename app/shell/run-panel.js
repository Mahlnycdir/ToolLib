// Running a snippet on this device (app/services/python.js). "Try it" opens the panel with the snippet's code,
// "Run check" opens it on the check and runs it. Both can be edited; what you change stays on this device (until
// "reset"), the node itself never changes. The output appears below the code it came from.
import { h } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { loadPref, removePref, savePref } from '../services/prefs.js';
import { t, getLang } from '../i18n/i18n.js';
import { fillPlaceholders, getNode, needsOf, resolveNeeds, runParts } from '../services/nodes.js';
import { indexState, nodeBySlug, onIndexChange } from '../services/search.js';
import { detachSink, isBusy, isSink, onPythonChange, pythonState, runPython, stopPython } from '../services/python.js';
import { ConsoleView } from './console.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const GUI_IMPORT = /^\s*(?:import|from)\s+(?:tkinter|PyQt[56]|PySide[26])\b/m;
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
// Right after a start the index may still be building; the needed snippets are looked up once it is there.
function indexReady() {
  if (indexState().ready) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = onIndexChange((s) => { if (s.ready) { stop(); resolve(); } });
  });
}
const loadBySlug = async (slug) => {
  await indexReady();
  const d = nodeBySlug(slug);
  return d ? getNode(d.path) : null;
};
const trimEnd = (s) => s.replace(/\s+$/, '');

function button(name, key, cls = '') {
  return h('button', { type: 'button', class: `btn small ${cls}` }, iconEl(name), h('span', { text: t(key) }));
}
function iconButton(name, key) {
  return h('button', { type: 'button', class: 'icon-btn small', title: t(key), 'aria-label': t(key), html: icon(name) });
}

// Keys of a code field: Tab indents by four spaces (Esc, then Tab leaves the field); Ctrl/⌘+Enter runs.
export function enableCodeKeys(editor, { onRun } = {}) {
  let escaped = false;
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { escaped = true; return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onRun) { e.preventDefault(); onRun(); return; }
    if (e.key === 'Tab' && !escaped && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (!document.execCommand?.('insertText', false, '    ')) {
        editor.setRangeText('    ', editor.selectionStart, editor.selectionEnd, 'end');
        editor.dispatchEvent(new Event('input'));
      }
    }
    escaped = false;
  });
}

// Forgets what you changed in the panel of a node (both tabs, or one), e.g. after it went into the node.
export function forgetEdits(path, which = null) {
  const key = `run.edit.${path}`;
  const saved = loadPref(key, null);
  const next = which && saved ? { ...saved, [which]: undefined } : null;
  if (next && (typeof next.code === 'string' || typeof next.check === 'string')) savePref(key, next);
  else removePref(key);
  kept.get(path)?.dispose();
  kept.delete(path);
}

// The panels of the last few nodes: a view drawn again (after Sync, after "Mark as checked", or when you come back)
// gets the same panel, with its output and a program that may still run.
const kept = new Map();   // path -> { code, check, lang, opts, controls, dispose }
const KEEP = 5;

// Returns { buttons, panel }: buttons for the row under the title and the panel that opens below it,
// or null when the node has no Python code.
//   canVerify(): whether "Mark as checked" may be offered; onVerify(): marks it, resolves to true on success
//   nodeLink(slug): { href, label } of another node or null
//   canChange(): whether your version may go into the node; onTakeOver(which, text): writes it, true on success
//   onSaveAs({ code, check }): opens the form for a new snippet with this code; redraw(): draws the view again
export function runControls(node, options) {
  const parts = runParts(node);
  // Instead of "Try it": a short line why this one does not run here (copying works as always)
  const elsewhere = (name, key) => ({ buttons: [], panel: h('p', { class: 'run-later muted small' }, iconEl(name), h('span', { text: t(key) })) });
  if (!parts.code) return String(node.meta.language || '') === 'shell' ? elsewhere('terminal', 'run.terminal') : null;
  if (String(node.meta.runs || '') === 'desktop') return elsewhere('server', 'run.desktopOnly');
  if (GUI_IMPORT.test(parts.code)) return elsewhere('window', 'run.guiLater');
  const prev = kept.get(node.path);
  if (prev && prev.code === parts.code && prev.check === parts.check && prev.lang === getLang()) {
    prev.opts = options;
    kept.delete(node.path);
    kept.set(node.path, prev);
    return prev.controls;
  }
  prev?.dispose();
  const entry = { code: parts.code, check: parts.check, lang: getLang(), opts: options };
  const opts = () => entry.opts;

  // The texts of both tabs: the node's own, and yours if you changed them (kept per node on this device).
  const original = { code: trimEnd(fillPlaceholders(parts.code)), check: parts.check ? trimEnd(parts.check) : null };
  const storeKey = `run.edit.${node.path}`;
  const saved = loadPref(storeKey, null) || {};
  const text = {
    code: typeof saved.code === 'string' ? saved.code : original.code,
    check: original.check === null ? null : typeof saved.check === 'string' ? saved.check : original.check,
  };
  const changed = (which) => text[which] !== null && text[which] !== original[which];
  let tab = 'code';
  let lastRun = null;       // { which, edited } of the run shown in the output

  // ------------------------------------------------------------------ elements
  const tryBtn = button('terminal', 'run.try');
  tryBtn.setAttribute('aria-expanded', 'false');
  const checkBtn = parts.check ? button('check', 'run.check') : null;

  const tabs = {};
  const tabRow = h('div', { class: 'run-tabs', role: 'tablist' });
  for (const which of ['code', 'check']) {
    if (which === 'check' && original.check === null) continue;
    tabs[which] = h('button', { type: 'button', role: 'tab', class: 'run-tab', dataset: { tab: which } },
      h('span', { text: t(`run.tab.${which}`) }), h('span', { class: 'run-dot', title: t('run.changed'), 'aria-label': t('run.changed') }));
    tabs[which].addEventListener('click', () => { showTab(which); editor.focus(); });
    tabRow.append(tabs[which]);
  }
  const hint = matchMedia('(pointer: coarse)').matches ? null
    : h('span', { class: 'run-hint muted small', text: t('run.shortcut', { key: IS_MAC ? '⌘' : t('run.key.ctrl') }) });
  const editor = h('textarea', {
    class: 'code-edit', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', wrap: 'off', rows: '4',
  });
  const uses = h('p', { class: 'muted small run-uses', hidden: true });

  const runBtn = button('play', 'run.run', 'primary');
  const stopBtn = button('stop', 'run.stop');
  const takeBtn = button('upload', 'run.takeOver');
  const saveAsBtn = iconButton('plus', 'run.saveAs');
  const resetBtn = iconButton('undo', 'run.reset');
  const clearBtn = iconButton('eraser', 'run.clear');
  const stateEl = h('span', { class: 'run-state muted small', 'aria-live': 'polite' });
  const bar = h('div', { class: 'run-bar' }, runBtn, stopBtn, takeBtn, stateEl, saveAsBtn, resetBtn, clearBtn);
  const con = new ConsoleView({ onFinished: finished });
  const panel = h('section', { class: 'run-panel', hidden: true, 'aria-label': t('run.panel') },
    h('div', { class: 'run-head' }, tabRow, hint), editor, uses, bar, con.root);

  // ------------------------------------------------------------------ tabs and editing
  function persist() {
    if (!changed('code') && !changed('check')) { removePref(storeKey); return; }
    savePref(storeKey, { code: changed('code') ? text.code : undefined, check: changed('check') ? text.check : undefined });
  }

  function markTabs() {
    for (const [which, el] of Object.entries(tabs)) {
      el.classList.toggle('on', which === tab);
      el.setAttribute('aria-selected', String(which === tab));
      el.classList.toggle('changed', changed(which));
    }
    resetBtn.disabled = !changed(tab);
    takeBtn.hidden = !changed(tab) || !opts().canChange?.();
    tryBtn.classList.toggle('changed', changed('code') || changed('check'));
  }

  function showTab(which) {
    tab = which;
    editor.value = text[which];
    editor.setAttribute('aria-label', t(`run.tab.${which}`));
    autosize();
    markTabs();
    showUses();
  }

  function autosize() {
    const lines = editor.value.split('\n').length;
    editor.rows = Math.max(3, Math.min(lines + 1, 30));
  }

  function open(which) {
    panel.hidden = false;
    if (which !== tab) showTab(which);
    tryBtn.setAttribute('aria-expanded', 'true');
    tryBtn.classList.add('on');
  }

  function close() {
    panel.hidden = true;
    tryBtn.setAttribute('aria-expanded', 'false');
    tryBtn.classList.remove('on');
  }

  editor.addEventListener('input', () => {
    text[tab] = editor.value;
    autosize();
    markTabs();
    persist();
  });

  enableCodeKeys(editor, { onRun: () => { if (!runBtn.disabled) run(tab); } });

  // ------------------------------------------------------------------ what the code needs
  const needsCache = new Map();   // "a, b" -> { deps, missing }
  async function needsFor(list) {
    const key = list.join(',');
    if (needsCache.has(key)) return needsCache.get(key);
    const found = await resolveNeeds(list, loadBySlug);
    if (!found.missing.length) needsCache.set(key, found);   // a missing snippet may come with the next Sync
    return found;
  }
  // The snippets a run needs come from the check's "# needs:" line, also when you run the code.
  const currentNeeds = () => needsOf(text.check ?? '');

  async function showUses() {
    const { deps } = await needsFor(currentNeeds());
    uses.hidden = !deps.length;
    uses.replaceChildren(h('span', { text: `${t('run.uses')} ` }));
    deps.forEach(([slug], i) => {
      const link = opts().nodeLink(slug);
      if (i) uses.append(', ');
      uses.append(link ? h('a', { href: link.href, text: link.label }) : h('code', { text: slug }));
    });
  }

  // ------------------------------------------------------------------ running
  const sink = {
    started: () => con.started(),
    write: (s, kind) => con.write(s, kind),
    figure: (...a) => con.figure(...a),
    figureClosed: (key) => con.figureClosed(key),
    progress: (code, vars) => con.progress(code, vars),
    note: (code, vars, kind) => con.note(code, vars, kind),
    requestInput: () => con.requestInput(),
    cancelInput: () => con.cancelInput(),
    done: (result, ms) => con.done(result, ms),
    liveEnded: () => con.liveEnded(),
  };

  async function run(which) {
    open(which);
    const { deps, missing } = await needsFor(currentNeeds());
    lastRun = { which, edited: changed('code') || (which === 'check' && changed('check')) };
    const spec = which === 'check'
      ? { name: node.slug, code: text.code, deps, check: text.check }
      : { name: node.slug, code: text.code, deps, check: null };
    watch();
    await runPython(spec, sink);
    if (missing.length) con.note('run.missing', { names: missing.join(', ') }, 'warn');
  }

  function finished(result) {
    if (!lastRun || lastRun.which !== 'check' || result.failed) return;
    if (result.exit !== 0) { con.note(lastRun.edited ? 'run.checkFailedEdited' : 'run.checkFailed', {}, 'warn'); return; }
    if (lastRun.edited) { con.note('run.checkEdited', {}, 'ok'); return; }
    const row = con.note('run.checkPassed', {}, 'ok');
    if (opts().canVerify()) {
      const mark = button('check', 'run.markVerified');
      mark.addEventListener('click', async () => {
        mark.disabled = true;
        if (await opts().onVerify()) mark.remove();
        else mark.disabled = false;
      });
      row.append(mark);
    }
  }

  // A program whose panel stays away (you went to another view) is stopped; a view that is just drawn again puts
  // the panel back at once.
  let watcher = null;
  function watch() {
    clearInterval(watcher);
    let away = 0;
    watcher = setInterval(() => {
      const s = pythonState();
      if (!isSink(sink) || !isBusy()) { clearInterval(watcher); return; }
      if (s.status === 'loading') return;   // let Python finish loading; it is needed again anyway
      away = panel.isConnected ? 0 : away + 1;
      if (away >= 2) {
        clearInterval(watcher);
        stopPython({ quiet: true });
      }
    }, 600);
  }

  // ------------------------------------------------------------------ buttons
  tryBtn.addEventListener('click', () => {
    if (!panel.hidden && tab === 'code') { close(); return; }
    open('code');
    showTab('code');
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  checkBtn?.addEventListener('click', () => run('check'));
  runBtn.addEventListener('click', () => run(tab));
  stopBtn.addEventListener('click', () => stopPython());
  resetBtn.addEventListener('click', () => {
    text[tab] = original[tab];
    editor.value = text[tab];
    autosize();
    markTabs();
    persist();
    showUses();
    editor.focus();
  });
  clearBtn.addEventListener('click', () => con.clear());
  takeBtn.addEventListener('click', async () => {
    const which = tab;
    takeBtn.disabled = true;
    const ok = await opts().onTakeOver?.(which, text[which]);
    takeBtn.disabled = false;
    if (!ok) return;
    forgetEdits(node.path, which);   // the node holds your version now; the view draws a fresh panel
    opts().redraw?.();
  });
  saveAsBtn.addEventListener('click', () => opts().onSaveAs?.({ code: text.code, check: text.check }));

  const update = (s) => {
    const mine = isSink(sink);
    const busy = mine && isBusy();
    const working = mine && (s.status === 'loading' || s.status === 'running');
    stopBtn.disabled = !busy;
    runBtn.disabled = working;
    if (checkBtn) checkBtn.disabled = working;
    stateEl.textContent = busy ? t(`run.state.${s.status === 'running' && s.animating ? 'live' : s.status}`) : '';
  };
  const unlisten = onPythonChange(update);
  showTab('code');
  update(pythonState());

  entry.controls = { buttons: [tryBtn, checkBtn].filter(Boolean), panel };
  entry.dispose = () => {
    unlisten();
    clearInterval(watcher);
    if (isSink(sink)) { if (isBusy()) stopPython({ quiet: true }); detachSink(sink); }
  };
  kept.set(node.path, entry);
  while (kept.size > KEEP) {
    const [oldest, e] = kept.entries().next().value;
    kept.delete(oldest);
    e.dispose();
  }
  return entry.controls;
}
