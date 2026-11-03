// Running a snippet: "Try it" opens an editable copy of its code, "Run check" runs its check. Both run in Python on
// this device (app/services/python.js); the output appears in a console below. Editing never changes the node.
import { h } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { fillPlaceholders, getNode, resolveNeeds, runParts } from '../services/nodes.js';
import { nodeBySlug } from '../services/search.js';
import { detachSink, isBusy, isSink, onPythonChange, pythonState, runPython, stopPython } from '../services/python.js';
import { ConsoleView } from './console.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const GUI_IMPORT = /^\s*(?:import|from)\s+(?:tkinter|PyQt[56]|PySide[26])\b/m;
const loadBySlug = async (slug) => {
  const d = nodeBySlug(slug);
  return d ? getNode(d.path) : null;
};

function button(name, key, cls = '') {
  return h('button', { type: 'button', class: `btn small ${cls}` }, iconEl(name), h('span', { text: t(key) }));
}

// The panels of the last few nodes: a view drawn again (after Sync, after "Mark as checked", or when you come back)
// gets the same panel, with its code, its output and a program that may still run.
const kept = new Map();   // path -> { code, check, lang, opts, controls, dispose }
const KEEP = 5;

// Returns { buttons, panel }: buttons for the row under the title and the panel that opens below it,
// or null when the node has no Python code.
//   canVerify(): whether "Mark as checked" may be offered; onVerify(): marks it, resolves to true on success
//   nodeLink(slug): { href, label } of another node or null
export function runControls(node, options) {
  const parts = runParts(node);
  if (!parts.code) return null;
  if (GUI_IMPORT.test(parts.code)) {
    return { buttons: [], panel: h('p', { class: 'run-later muted small' }, iconEl('window'), h('span', { text: t('run.guiLater') })) };
  }
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

  const original = fillPlaceholders(parts.code).replace(/\s+$/, '');
  let mode = 'code';        // what ran last: 'code' or 'check'
  let needs = null;         // { deps, missing }, read when first needed

  const tryBtn = button('edit', 'run.try');
  tryBtn.setAttribute('aria-expanded', 'false');
  const checkBtn = parts.check ? button('check', 'run.check') : null;

  const editor = h('textarea', {
    class: 'code-edit', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', wrap: 'off',
    'aria-label': t('run.editor'), rows: '4',
  });
  editor.value = original;
  const uses = h('p', { class: 'muted small run-uses', hidden: true });
  const editBox = h('div', { class: 'run-edit', hidden: true },
    h('div', { class: 'run-edit-head' }, h('span', { class: 'run-label', text: t('run.editor') }), h('span', { class: 'muted small', text: t('run.editor.hint') })),
    editor, uses);

  const runBtn = button('play', 'run.run', 'primary');
  const stopBtn = button('stop', 'run.stop');
  const resetBtn = button('undo', 'run.reset');
  const clearBtn = button('eraser', 'run.clear');
  const stateEl = h('span', { class: 'run-state muted small', 'aria-live': 'polite' });
  const bar = h('div', { class: 'run-bar' }, runBtn, stopBtn, resetBtn, clearBtn, stateEl);
  const con = new ConsoleView({ onFinished: finished });
  const panel = h('section', { class: 'run-panel', hidden: true, 'aria-label': t('run.panel') }, editBox, bar, con.root);

  // The console receives the run. A view that is drawn again puts the panel back at once; when the panel stays away
  // (you went to another view) while the program runs, the program is stopped.
  const sink = {
    started: () => con.started(),
    write: (text, kind) => con.write(text, kind),
    figure: (...a) => con.figure(...a),
    figureClosed: (key) => con.figureClosed(key),
    progress: (code, vars) => con.progress(code, vars),
    note: (code, vars, kind) => con.note(code, vars, kind),
    requestInput: () => con.requestInput(),
    cancelInput: () => con.cancelInput(),
    done: (result, ms) => con.done(result, ms),
    liveEnded: () => con.liveEnded(),
  };
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

  function finished(result) {
    if (mode !== 'check' || result.failed) return;
    if (result.exit !== 0) { con.note('run.checkFailed', {}, 'warn'); return; }
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

  async function loadNeeds() {
    if (needs) return needs;
    needs = await resolveNeeds(parts.needs, loadBySlug);
    if (needs.deps.length) {
      uses.hidden = false;
      uses.replaceChildren(h('span', { text: `${t('run.uses')} ` }));
      needs.deps.forEach(([slug], i) => {
        const link = opts().nodeLink(slug);
        if (i) uses.append(', ');
        uses.append(link ? h('a', { href: link.href, text: link.label }) : h('code', { text: slug }));
      });
    }
    return needs;
  }

  async function run(which) {
    mode = which;
    panel.hidden = false;
    const { deps, missing } = await loadNeeds();
    const spec = which === 'check'
      ? { name: node.slug, code: parts.code, deps, check: parts.check }
      : { name: node.slug, code: editor.value, deps, check: null };
    watch();
    await runPython(spec, sink);
    if (missing.length) con.note('run.missing', { names: missing.join(', ') }, 'warn');
  }

  function showEditor(open) {
    editBox.hidden = !open;
    tryBtn.setAttribute('aria-expanded', String(open));
    tryBtn.classList.toggle('on', open);
    runBtn.hidden = !open;
    resetBtn.hidden = !open;
    if (open) {
      panel.hidden = false;
      loadNeeds();
      autosize();
    }
  }

  function autosize() {
    const lines = editor.value.split('\n').length;
    editor.rows = Math.max(4, Math.min(lines + 1, 30));
  }

  // Tab indents by four spaces (Esc, then Tab leaves the field); Ctrl/⌘+Enter runs.
  let escaped = false;
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { escaped = true; return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!runBtn.disabled) run('code'); return; }
    if (e.key === 'Tab' && !escaped && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (!document.execCommand?.('insertText', false, '    ')) editor.setRangeText('    ', editor.selectionStart, editor.selectionEnd, 'end');
    }
    escaped = false;
  });
  editor.addEventListener('input', autosize);

  tryBtn.addEventListener('click', () => {
    const open = editBox.hidden;
    showEditor(open);
    if (open) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  checkBtn?.addEventListener('click', () => run('check'));
  runBtn.addEventListener('click', () => run('code'));
  stopBtn.addEventListener('click', () => stopPython());
  resetBtn.addEventListener('click', () => { editor.value = original; autosize(); editor.focus(); });
  clearBtn.addEventListener('click', () => con.clear());

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
  showEditor(false);
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
