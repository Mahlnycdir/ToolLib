// The editor for pages and nodes (0.17.0), on CodeMirror 6 (vendor/editor): Markdown with colours, formulas set apart
// (commands, braces, ^ and _ in their own colours, a formula KaTeX cannot read underlined in red), code blocks in
// their language. It completes LaTeX commands (with a preview), your macros and own commands, [[links]], [@sources]
// and "/" blocks; shorthand expands while you type ("//" → \frac{}{} in a formula); Enter continues a list, a
// numbered list or a task list, Enter on an empty item ends it. Images can be pasted or dropped.
// createEditor(host, opts) → { view, value(), setValue(text), insert(md, {inline}), insertTemplate(t), tool(name),
//   selection(), setSelection(a, b), lineAt(n), focus(), inMath(), destroy() }
import {
  EditorState, EditorSelection, Compartment, Prec, Annotation, EditorView, keymap, drawSelection, placeholder as cmPlaceholder,
  ViewPlugin, Decoration, highlightSpecialChars, dropCursor, defaultKeymap, history, historyKeymap, indentMore, indentLess,
  syntaxHighlighting, HighlightStyle, bracketMatching, StreamLanguage, LanguageDescription, autocompletion, completionKeymap,
  closeBrackets, closeBracketsKeymap, snippet, startCompletion, acceptCompletion, completionStatus, searchKeymap,
  highlightSelectionMatches, markdown, markdownLanguage, python, javascript, yaml, shell, stex, tags,
  insertNewlineContinueMarkup, deleteMarkupBackward,
} from '../../vendor/editor/editor.js';
import { h } from '../services/ui.js';
import { loadPref } from '../services/prefs.js';
import { ACTIONS, keysOf, cmKey } from '../services/keys.js';
import { t } from '../i18n/i18n.js';
import { typeset, texError, mathReady, ownMacros } from './math.js';
import { texCatalog, toSnippet, sampleOf, SHORTHAND } from './tex-catalog.js';

// ------------------------------------------------------------------ where the formulas are (tested on their own)
// Formulas of a text: [{ from, to, inner: [a, b], display }]; code blocks, inline code, the YAML head and \$ are skipped.
// open: a $ or $$ without its closing one counts up to `open` (the cursor), so shorthand works while you type.
export function mathSpans(text, { open = -1 } = {}) {
  const out = [];
  const s = String(text);
  const n = s.length;
  let i = 0;
  if (s.startsWith('---\n')) { const e = s.indexOf('\n---', 4); if (e > 0) i = e + 4; }
  let lineStart = true;
  while (i < n) {
    const c = s[i];
    if (lineStart) {
      const m = /^ {0,3}(```|~~~)/.exec(s.slice(i, i + 8));
      if (m) {
        const fence = m[1];
        let e = s.indexOf('\n', i);
        while (e >= 0) {
          const next = s.indexOf('\n', e + 1);
          const line = s.slice(e + 1, next < 0 ? n : next);
          if (/^ {0,3}(```|~~~)/.test(line) && line.trim().startsWith(fence)) { e = next; break; }
          e = next;
        }
        i = e < 0 ? n : e + 1;
        lineStart = true;
        continue;
      }
    }
    lineStart = c === '\n';
    if (c === '\\') { i += 2; continue; }
    if (c === '`') {
      let k = i;
      while (s[k] === '`') k++;
      const ticks = s.slice(i, k);
      const e = s.indexOf(ticks, k);
      const nl = s.indexOf('\n', k);
      if (e > 0 && (nl < 0 || e < nl)) { i = e + ticks.length; continue; }
      i = k;
      continue;
    }
    if (c !== '$') { i++; continue; }
    if (s[i + 1] === '$') {
      let e = i + 2;
      while (e < n && !(s[e] === '$' && s[e + 1] === '$' && s[e - 1] !== '\\')) e++;
      if (e < n) { out.push({ from: i, to: e + 2, inner: [i + 2, e], display: true }); i = e + 2; continue; }
      if (open > i) out.push({ from: i, to: n, inner: [i + 2, n], display: true, open: true });
      break;
    }
    let e = i + 1;
    while (e < n && s[e] !== '$' && s[e] !== '\n') { if (s[e] === '\\') e++; e++; }
    if (e < n && s[e] === '$' && e > i + 1) { out.push({ from: i, to: e + 1, inner: [i + 1, e], display: false }); i = e + 1; continue; }
    if (open > i && open <= e) out.push({ from: i, to: e, inner: [i + 1, e], display: false, open: true });
    i = e > i + 1 ? e : i + 1;
  }
  return out;
}
export const inMathAt = (text, pos) => mathSpans(text, { open: pos }).some((m) => pos >= m.inner[0] && pos <= m.inner[1]);

// The shorthand that the text before the cursor (with the typed character) ends in, or null.
// commands: [{ trigger, text, where, auto }]. Letters as a trigger need no letter in front (except sr, cb, td);
// inside a command name (\sqrt) nothing expands.
const AFTER_ANYTHING = new Set(['sr', 'cb', 'td']);
export function shorthandFor(before, math, commands) {
  let best = null;
  for (const c of commands) {
    if (!c.auto || !c.trigger || !before.endsWith(c.trigger)) continue;
    if (c.where === 'math' && !math) continue;
    if (c.where === 'text' && math) continue;
    const head = before.slice(0, before.length - c.trigger.length);
    if (/\\[a-zA-Z]*$/.test(head)) continue;
    if (/^[a-zA-Z]/.test(c.trigger) && !AFTER_ANYTHING.has(c.trigger) && /[\p{L}\d]$/u.test(head)) continue;
    if (!best || c.trigger.length > best.trigger.length) best = c;
  }
  return best;
}

// Your commands first: one with the same trigger replaces the built-in shorthand.
export function commandList() {
  const own = (loadPref('editor.commands', []) || []).filter((c) => c && c.trigger && typeof c.text === 'string');
  const builtin = loadPref('editor.shorthand', true) !== false ? SHORTHAND : [];
  const mine = new Set(own.map((c) => c.trigger));
  return [...own.map((c) => ({ where: 'any', ...c, own: true })), ...builtin.filter((c) => !mine.has(c.trigger))];
}

// ------------------------------------------------------------------ colours
const style = HighlightStyle.define([
  { tag: tags.heading1, class: 'tk-h tk-h1' },
  { tag: tags.heading2, class: 'tk-h tk-h2' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], class: 'tk-h tk-h3' },
  { tag: tags.strong, class: 'tk-strong' },
  { tag: tags.emphasis, class: 'tk-em' },
  { tag: tags.strikethrough, class: 'tk-strike' },
  { tag: [tags.link, tags.url], class: 'tk-link' },
  { tag: tags.monospace, class: 'tk-code' },
  { tag: tags.quote, class: 'tk-quote' },
  { tag: tags.list, class: 'tk-list' },
  { tag: [tags.processingInstruction, tags.contentSeparator], class: 'tk-mark' },
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword], class: 'tk-kw' },
  { tag: [tags.string, tags.special(tags.string)], class: 'tk-str' },
  { tag: [tags.number, tags.bool, tags.null], class: 'tk-num' },
  { tag: tags.comment, class: 'tk-comment' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'tk-fn' },
  { tag: [tags.className, tags.typeName, tags.definition(tags.className)], class: 'tk-type' },
  { tag: [tags.meta, tags.annotation, tags.atom], class: 'tk-meta' },
  { tag: [tags.propertyName, tags.attributeName], class: 'tk-prop' },
  { tag: tags.invalid, class: 'tk-bad' },
]);

const tex = StreamLanguage.define(stex);
const CODE = [
  LanguageDescription.of({ name: 'python', alias: ['py', 'python3'], support: python() }),
  LanguageDescription.of({ name: 'javascript', alias: ['js', 'ts', 'typescript', 'json'], support: javascript() }),
  LanguageDescription.of({ name: 'yaml', alias: ['yml'], support: yaml() }),
  LanguageDescription.of({ name: 'shell', alias: ['bash', 'sh', 'zsh', 'console'], support: StreamLanguage.define(shell) }),
  LanguageDescription.of({ name: 'latex', alias: ['tex'], support: tex }),
  LanguageDescription.of({ name: 'rust', alias: ['rs'], load: () => import('../../vendor/editor/editor-langs.js').then((m) => m.rust()) }),
  LanguageDescription.of({ name: 'cpp', alias: ['c', 'c++', 'arduino', 'ino'], load: () => import('../../vendor/editor/editor-langs.js').then((m) => m.cpp()) }),
];

// formulas, their parts, [[links]] and [@sources] as marks; a formula KaTeX cannot read gets a red line and the reason
const mark = (cls, attrs) => Decoration.mark(attrs ? { class: cls, attributes: attrs } : { class: cls });
const M = { span: mark('cm-math'), display: mark('cm-math cm-math-display'), delim: mark('cm-math-delim'), cmd: mark('cm-tex-cmd'), brace: mark('cm-tex-brace'), script: mark('cm-tex-script'), align: mark('cm-tex-align'), link: mark('cm-wikilink'), cite: mark('cm-cite') };
const errors = new Map();   // tex → message or ''
function decorate(view) {
  const text = view.state.doc.toString();
  if (text.length > 400000) return Decoration.none;
  const list = [];
  for (const m of mathSpans(text)) {
    const inner = text.slice(m.inner[0], m.inner[1]);
    const err = errors.get(`${m.display ? 'D' : 'I'}${inner}`);
    list.push((err ? mark(`cm-math${m.display ? ' cm-math-display' : ''} cm-math-error`, { title: err }) : m.display ? M.display : M.span).range(m.from, m.to));
    list.push(M.delim.range(m.from, m.inner[0]));
    if (m.to > m.inner[1]) list.push(M.delim.range(m.inner[1], m.to));
    for (const x of inner.matchAll(/\\[a-zA-Z@]+\*?|\\.|[{}]|[_^]|&|\\\\/g)) {
      const a = m.inner[0] + x.index;
      const kind = x[0][0] === '\\' ? (x[0] === '\\\\' ? 'align' : 'cmd') : '{}'.includes(x[0]) ? 'brace' : x[0] === '&' ? 'align' : 'script';
      list.push(M[kind].range(a, a + x[0].length));
    }
  }
  for (const x of text.matchAll(/\[\[[^\]\n]{1,80}\]\]|\[@[^\]\n]{1,120}\]/g)) list.push((x[0][1] === '@' ? M.cite : M.link).range(x.index, x.index + x[0].length));
  return Decoration.set(list, true);
}
const checkSoon = new WeakMap();
const mathMarks = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = decorate(view); this.view = view; this.check(); }
  update(u) { if (u.docChanged) { this.decorations = decorate(u.view); this.check(); } }
  // KaTeX reads every formula a moment after you stop typing; the ones it cannot set are underlined
  check() {
    clearTimeout(checkSoon.get(this.view));
    checkSoon.set(this.view, setTimeout(async () => {
      await mathReady().catch(() => null);
      const text = this.view.state.doc.toString();
      let fresh = false;
      for (const m of mathSpans(text)) {
        const key = `${m.display ? 'D' : 'I'}${text.slice(m.inner[0], m.inner[1])}`;
        if (errors.has(key)) continue;
        errors.set(key, texError(key.slice(1), m.display) || '');
        fresh = true;
      }
      if (errors.size > 2000) errors.clear();
      if (fresh && this.view.dom.isConnected) { this.decorations = decorate(this.view); this.view.dispatch({}); }
    }, 600));
  }
}, { decorations: (v) => v.decorations });

// ------------------------------------------------------------------ completion
function texOptions() {
  const own = Object.entries(ownMacros()).map(([label, expansion]) => ({ label, template: label, words: t('editor.ownMacro'), group: 'own', expansion }));
  return [...texCatalog(), ...own];
}
const preview = (template, words, expansion) => () => {
  const box = h('div', { class: 'cm-tex-info' });
  box.append(typeset(h('div', { class: 'cm-tex-sample' }), sampleOf(template), true));
  if (expansion) box.append(h('code', { class: 'small', text: expansion }));
  if (words) box.append(h('div', { class: 'small muted', text: words }));
  return box;
};
const GROUP_RANK = { own: 99, yours: 60, greek: 50, structure: 45, big: 40, rel: 35, arrows: 30, ops: 30, symbols: 25, fonts: 25, delims: 25, env: 20, space: 5 };

function completer(opts) {
  return (ctx) => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    // "/" at the start of a line: blocks
    const slash = before.match(/^\/([\p{L}\d-]{0,20})$/u);
    if (slash && opts.slash) {
      return {
        from: line.from, filter: false,
        options: opts.slash(slash[1]).map((s) => ({ label: `/${t(`editor.slash.${s.id}`)}`, displayLabel: t(`editor.slash.${s.id}`), detail: s.text.replace('‸', '').split('\n')[0].trim().slice(0, 14), type: 'slash', apply: (view) => applyBlock(view, line.from, ctx.pos, s.text) })),
      };
    }
    // [[ a node
    const link = before.match(/\[\[([^\]\n|[]{0,50})$/);
    if (link && opts.links) {
      const nodes = opts.links(link[1]);
      if (!nodes.length) return null;
      const from = ctx.pos - link[1].length;
      return {
        from, filter: false,
        options: nodes.map((d, k) => ({ label: d.slug, displayLabel: d.label, detail: d.kind, boost: -k, type: 'link', apply: (view, c, a, b) => { const close = view.state.sliceDoc(b, b + 2) === ']]' ? '' : ']]'; view.dispatch({ changes: { from: a, to: b, insert: `${d.slug}${close}` }, selection: { anchor: a + d.slug.length + 2 } }); } })),
      };
    }
    // [@ a source
    const cite = before.match(/\[@([^\]\n;,]{0,60})$/);
    if (cite && opts.cites) {
      const works = opts.cites(cite[1]);
      if (!works.length) return null;
      const from = ctx.pos - cite[1].length;
      return {
        from, filter: false,
        options: works.map((w, k) => ({ label: w.slug, displayLabel: w.label, detail: w.detail, boost: -k, type: 'cite', apply: (view, c, a, b) => { const close = view.state.sliceDoc(b, b + 1) === ']' ? '' : ']'; view.dispatch({ changes: { from: a, to: b, insert: `${w.slug}${close}` }, selection: { anchor: a + w.slug.length + 1 } }); } })),
      };
    }
    // \ a command
    const cmd = ctx.matchBefore(/\\[a-zA-Z]*\*?$/);
    if (cmd && (cmd.from < cmd.to || ctx.explicit)) {
      return {
        from: cmd.from,
        validFor: /^\\[a-zA-Z]*\*?$/,
        options: texOptions().map((e) => ({
          label: e.label, detail: e.group === 'yours' || e.group === 'own' ? (e.expansion || '').slice(0, 28) : t(`tex.group.${e.group}`),
          type: e.group === 'env' ? 'class' : 'function', boost: (GROUP_RANK[e.group] || 0) / 10,
          info: preview(e.template, e.words, e.expansion), apply: snippet(toSnippet(e.template)),
        })),
      };
    }
    // environments without the backslash ("pmatrix") and your own commands that do not expand by themselves
    const word = ctx.matchBefore(/[\w;:.@!<>=~+*/-]{2,}$/);
    if (!word) return null;
    const math = inMathAt(ctx.state.doc.toString(), ctx.pos);
    const own = commandList().filter((c) => !c.auto && c.trigger.startsWith(word.text) && (c.where === 'any' || (c.where === 'math') === math));
    const envs = math ? texCatalog().filter((e) => e.group === 'env' && e.label.startsWith(word.text)) : [];
    if (!own.length && !envs.length) return null;
    return {
      from: word.from, filter: false,
      options: [...own.map((c) => ({ label: c.trigger, detail: c.text.replace(/#\d/g, '…').slice(0, 30), type: 'own', boost: 5, apply: snippet(toSnippet(c.text)) })),
        ...envs.map((e) => ({ label: e.label, detail: t('tex.group.env'), type: 'class', info: preview(e.template, e.words), apply: snippet(toSnippet(e.template)) }))],
    };
  };
}

function applyBlock(view, from, to, text) {
  const [a, b] = text.split('‸');
  view.dispatch({ changes: { from, to, insert: a + b }, selection: { anchor: from + a.length }, userEvent: 'input.complete' });
  if (/\[\[$|\[@$/.test(a)) setTimeout(() => startCompletion(view), 0);
}

// ------------------------------------------------------------------ shorthand while typing
function shorthandHandler() {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (text.length !== 1 || from !== to || view.composing || completionStatus(view.state) === 'active' && /\w/.test(text)) return false;
    const commands = commandList();
    if (!commands.some((c) => c.auto)) return false;
    const line = view.state.doc.lineAt(from);
    const before = line.text.slice(0, from - line.from) + text;
    const doc = view.state.doc.toString();
    const math = inMathAt(doc.slice(0, from) + text + doc.slice(to), from + 1);
    const c = shorthandFor(before, math, commands);
    if (!c) return false;
    const start = from + 1 - c.trigger.length;
    view.dispatch({ changes: { from, to, insert: text }, userEvent: 'input.type' });
    snippet(toSnippet(c.text))(view, null, start, from + 1);
    return true;
  });
}

// ------------------------------------------------------------------ the tools (bold, formula, list …) as text changes
// apply(value, a, b) → { value, start, end }: the editor replaces only the part that changed (undo stays fine).
export function replaceAll(view, r) {
  const old = view.state.doc.toString();
  let a = 0;
  while (a < old.length && a < r.value.length && old[a] === r.value[a]) a++;
  let b = 0;
  while (b < old.length - a && b < r.value.length - a && old[old.length - 1 - b] === r.value[r.value.length - 1 - b]) b++;
  view.dispatch({ changes: { from: a, to: old.length - b, insert: r.value.slice(a, r.value.length - b) }, selection: EditorSelection.single(r.start, r.end ?? r.start), scrollIntoView: true, userEvent: 'input' });
}

// A change from outside (sync, merge) is not your typing: it does not count as an edit of yours.
const External = Annotation.define();

// ------------------------------------------------------------------ the editor
export function createEditor(host, opts = {}) {
  const compartments = { lists: new Compartment(), brackets: new Compartment() };
  const run = (fn) => (view) => { fn(view); return true; };
  // the keys of Settings › Keys for the actions of the editor
  const actionKeys = [];
  for (const a of ACTIONS.filter((x) => x.area === 'editor')) {
    const fn = opts.actions?.[a.id];
    if (!fn) continue;
    for (const k of keysOf(a.id)) { const key = cmKey(k); if (key) actionKeys.push({ key, run: run(fn), preventDefault: true }); }
  }
  const brackets = loadPref('editor.brackets', true) !== false;
  const extensions = [
    highlightSpecialChars(), history(), drawSelection(), dropCursor(), bracketMatching(), highlightSelectionMatches(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage, codeLanguages: CODE, addKeymap: false }),
    compartments.lists.of(loadPref('editor.lists', true) !== false ? listKeys() : []),
    syntaxHighlighting(style),
    mathMarks,
    compartments.brackets.of(brackets ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : []),
    EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{', '$'] } }]),
    autocompletion({ override: [completer(opts)], icons: false, activateOnTyping: true, closeOnBlur: true, maxRenderedOptions: 60, addToOptions: [] }),
    shorthandHandler(),
    Prec.high(keymap.of(actionKeys)),
    keymap.of([
      { key: 'Tab', run: (v) => acceptCompletion(v) || indentMore(v) },
      { key: 'Shift-Tab', run: indentLess },
      ...completionKeymap, ...searchKeymap.filter((k) => k.key !== 'Mod-Shift-l'), ...historyKeymap, ...defaultKeymap,
    ]),
    EditorView.contentAttributes.of({
      spellcheck: loadPref('editor.spellcheck', true) !== false && opts.kind !== 'source' ? 'true' : 'false',
      autocorrect: opts.kind === 'source' ? 'off' : 'on', autocapitalize: opts.kind === 'source' ? 'off' : 'sentences',
      'aria-label': opts.label || t('editor.text'), 'aria-multiline': 'true',
    }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange?.(u.state.doc.toString(), { external: u.transactions.every((tr) => tr.annotation(External)) });
      if (u.selectionSet || u.docChanged) opts.onSelection?.(u.state.selection.main.head);
      if (u.focusChanged && !u.view.hasFocus) opts.onBlur?.();
    }),
    EditorView.domEventHandlers({
      paste: (e, view) => images(e.clipboardData?.files, view, e),
      drop: (e, view) => images(e.dataTransfer?.files, view, e, view.posAtCoords({ x: e.clientX, y: e.clientY })),
    }),
  ];
  // CodeMirror's own theme comes after our stylesheet: font and focus ring are set here
  extensions.push(EditorView.theme({
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': opts.kind === 'source'
      ? { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.5' }
      : { fontFamily: 'inherit', lineHeight: '1.65' },
  }));
  if (opts.placeholder) extensions.push(cmPlaceholder(opts.placeholder));
  const view = new EditorView({ parent: host, state: EditorState.create({ doc: opts.value || '', extensions }) });
  view.dom.classList.add('md-editor', `md-${opts.kind || 'page'}`);
  view.dom.style.setProperty('--ed-size', `${Number(loadPref('editor.fontSize', 16)) || 16}px`);

  function images(files, v, e, at = null) {
    const list = [...(files || [])].filter((f) => /^image\//.test(f.type));
    if (!list.length || !opts.onImage) return false;
    e.preventDefault();
    (async () => {
      for (const f of list) {
        const md = await opts.onImage(f);
        if (!md) continue;
        const pos = at ?? v.state.selection.main.head;
        api.insert(md, { at: pos });
        at = null;
      }
    })();
    return true;
  }

  const api = {
    view,
    value: () => view.state.doc.toString(),
    // New text from outside (a sync, a merge): only the part that differs changes, so the cursor moves with the text
    // around it instead of jumping (0.17.0).
    setValue(text) {
      const old = view.state.doc.toString();
      if (old === text) return;
      let a = 0;
      while (a < old.length && a < text.length && old[a] === text[a]) a++;
      let b = 0;
      while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++;
      view.dispatch({ changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) }, annotations: External.of(true) });
    },
    // After the layout changed (head and bar step aside on the phone): the cursor back into view.
    keepCaretInView() { requestAnimationFrame(() => { if (view.dom.isConnected) view.dispatch({ scrollIntoView: true }); }); },
    // A passage as its own paragraph (or inline) where the cursor is.
    insert(md, { inline = false, at = null } = {}) {
      const sel = view.state.selection.main;
      const a = at ?? sel.from;
      const b = at ?? sel.to;
      if (inline) { view.dispatch({ changes: { from: a, to: b, insert: md }, selection: { anchor: a + md.length }, scrollIntoView: true, userEvent: 'input' }); return; }
      const doc = view.state.doc;
      const before = doc.sliceString(Math.max(0, a - 2), a);
      const after = doc.sliceString(b, b + 2);
      const pre = a === 0 ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      const post = b >= doc.length ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
      view.dispatch({ changes: { from: a, to: b, insert: pre + md + post }, selection: { anchor: a + pre.length + md.length }, scrollIntoView: true, userEvent: 'input' });
    },
    // A LaTeX template (#1 … #0) at the cursor; outside a formula it comes in $ … $.
    insertTemplate(template, { display = false } = {}) {
      const sel = view.state.selection.main;
      const math = inMathAt(view.state.doc.toString(), sel.from);
      const body = math ? template : display ? `$$\n${template}\n$$` : `$${template}$`;
      snippet(toSnippet(body))(view, null, sel.from, sel.to);
      view.focus();
    },
    // A tool as a change of the whole text: fn(value, start, end) → { value, start, end }.
    apply(fn) {
      const sel = view.state.selection.main;
      replaceAll(view, fn(view.state.doc.toString(), sel.from, sel.to));
      view.focus();
    },
    selection: () => ({ from: view.state.selection.main.from, to: view.state.selection.main.to }),
    setSelection(a, b = a, { scroll = true } = {}) { view.dispatch({ selection: EditorSelection.single(a, b), scrollIntoView: scroll }); },
    lineStart(n) { const doc = view.state.doc; return doc.line(Math.max(1, Math.min(doc.lines, n + 1))).from; },
    scrollToLine(n) {
      const pos = api.lineStart(n);
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 40 }) });
    },
    // Where you are in the text (0.22.0): the line at the top of the view, how far it stood from the top, the cursor.
    // toPlace() puts it back, so a page opens again where you left it.
    place() {
      const at = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
      let block = view.lineBlockAtHeight(Math.max(0, at));
      // the first line that starts in view, so it can be put back at the same distance below the top
      if (block.top < at - 1 && block.to < view.state.doc.length) block = view.lineBlockAt(block.to + 1);
      return { pos: block.from, dy: Math.max(0, Math.round(block.top - at)), caret: view.state.selection.main.head };
    },
    toPlace(p) {
      if (!p || !view.dom.isConnected) return;
      const len = view.state.doc.length;
      // the editor's own scrolling, so it also holds when the editor was hidden a moment ago (a pane on the phone)
      view.dispatch({ selection: { anchor: Math.min(p.caret ?? 0, len) }, effects: EditorView.scrollIntoView(Math.min(p.pos, len), { y: 'start', yMargin: Math.max(0, p.dy || 0) }) });
    },
    complete: () => startCompletion(view),
    inMath: () => inMathAt(view.state.doc.toString(), view.state.selection.main.head),
    setLists(on) { view.dispatch({ effects: compartments.lists.reconfigure(on ? listKeys() : []) }); },
    focus: () => view.focus(),
    hasFocus: () => view.hasFocus,
    destroy: () => view.destroy(),
  };
  return api;
}

// Enter continues lists (- item, 1. item, - [ ] task, > quote), Backspace removes the mark; from lang-markdown.
function listKeys() {
  return Prec.high(keymap.of([{ key: 'Enter', run: insertNewlineContinueMarkup }, { key: 'Backspace', run: deleteMarkupBackward }]));
}
