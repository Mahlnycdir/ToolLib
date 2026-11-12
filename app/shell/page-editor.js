// The page editor (0.14.2): Markdown on the left, set as it will look on the right (on the iPhone you switch), a bar for
// heading, bold, formula, list, quote, code and [[link]] with suggestions from your knowledge. It saves by itself a
// moment after you stop typing, when you leave and when the app goes to the background.
import { h, debounce, loadPref, savePref, copyText, toast } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { getLang, t } from '../i18n/i18n.js';
import { renderMarkdown } from './markdown.js';
import { searchNodes, nodeBySlug, allNodes } from '../services/search.js';
import { nodeHref } from './node-view.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const narrow = () => window.matchMedia('(max-width: 759px)').matches;

// ------------------------------------------------------------------ the tools, as text changes (tested on their own)
const lineStart = (v, i) => v.lastIndexOf('\n', i - 1) + 1;
const lineEnd = (v, i) => { const e = v.indexOf('\n', i); return e < 0 ? v.length : e; };

function wrap(v, s, e, left, right, empty) {
  const inner = v.slice(s, e) || empty;
  const value = v.slice(0, s) + left + inner + right + v.slice(e);
  return { value, start: s + left.length, end: s + left.length + inner.length };
}

function prefixLines(v, s, e, make, strip) {
  const a = lineStart(v, s);
  const b = lineEnd(v, Math.max(s, e - (e > s && v[e - 1] === '\n' ? 1 : 0)));
  const lines = v.slice(a, b).split('\n');
  const all = lines.every((l) => strip.test(l) || !l.trim());
  const out = lines.map((l, k) => (all ? l.replace(strip, '') : l.trim() ? make(k) + l.replace(strip, '') : l)).join('\n');
  return { value: v.slice(0, a) + out + v.slice(b), start: a, end: a + out.length };
}

// Own paragraph: blank lines around the block.
function block(v, s, e, top, bottom, empty) {
  const inner = v.slice(s, e) || empty;
  const before = v.slice(0, s).replace(/[ \t]+$/, '');
  const pre = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const after = v.slice(e);
  const post = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const value = `${before}${pre}${top}${inner}${bottom}${post}${after}`;
  const start = before.length + pre.length + top.length;
  return { value, start, end: start + inner.length };
}

export const TOOLS = ['heading', 'bold', 'italic', 'math', 'display', 'list', 'numbered', 'quote', 'code', 'link'];
export function applyTool(value, start, end, tool) {
  const v = String(value);
  switch (tool) {
    case 'heading': {
      const a = lineStart(v, start);
      const b = lineEnd(v, start);
      const line = v.slice(a, b);
      const m = line.match(/^(#{2,4})\s+/);
      const next = !m ? `## ${line}` : m[1].length < 3 ? `### ${line.slice(m[0].length)}` : line.slice(m[0].length);
      return { value: v.slice(0, a) + next + v.slice(b), start: a + next.length, end: a + next.length };
    }
    case 'bold': return wrap(v, start, end, '**', '**', t('editor.sample.bold'));
    case 'italic': return wrap(v, start, end, '*', '*', t('editor.sample.italic'));
    case 'math': return wrap(v, start, end, '$', '$', 'x');
    case 'display': return block(v, start, end, '$$\n', '\n$$', 'E = mc^2');
    case 'list': return prefixLines(v, start, end, () => '- ', /^\s*[-*+]\s+/);
    case 'numbered': return prefixLines(v, start, end, (k) => `${k + 1}. `, /^\s*\d+[.)]\s+/);
    case 'quote': return prefixLines(v, start, end, () => '> ', /^\s*>\s?/);
    case 'code': return block(v, start, end, '```python\n', '\n```', '');
    case 'link': return wrap(v, start, end, '[[', ']]', '');
    default: return { value: v, start, end };
  }
}

// ------------------------------------------------------------------ "/" at the start of a line (0.15.1)
// What you are typing after a "/" that starts a line, or null: "/for" gives "for".
export function slashQuery(value, caret) {
  const a = lineStart(value, caret);
  const m = value.slice(a, caret).match(/^\/([\p{L}\d-]{0,20})$/u);
  return m ? m[1] : null;
}
// The blocks "/" offers: id, the words it is found by, the text it puts in place of the line (‸ = the cursor).
export const SLASH = [
  { id: 'h2', keys: 'heading überschrift h2 title titel', text: '## ‸' },
  { id: 'h3', keys: 'subheading unterüberschrift h3', text: '### ‸' },
  { id: 'display', keys: 'formula formel math equation gleichung display', text: '$$\n‸\n$$' },
  { id: 'list', keys: 'list liste bullet punkte', text: '- ‸' },
  { id: 'numbered', keys: 'numbered nummeriert ordered schritte steps', text: '1. ‸' },
  { id: 'task', keys: 'task aufgabe todo check', text: '- [ ] ‸' },
  { id: 'quote', keys: 'quote zitat', text: '> ‸' },
  { id: 'code', keys: 'code python rust snippet', text: '```python\n‸\n```' },
  { id: 'table', keys: 'table tabelle', text: '| ‸ | |\n| --- | --- |\n| | |' },
  { id: 'link', keys: 'link verweis karte card node knoten', text: '[[‸]]' },
  { id: 'rule', keys: 'line linie trenner divider', text: '---\n‸' },
];
export function slashHits(q) {
  const w = String(q || '').toLowerCase();
  return SLASH.filter((s) => !w || s.id.startsWith(w) || s.keys.split(' ').some((k) => k.startsWith(w)));
}
// Replaces the "/…" line with a block; returns { value, caret }.
export function applySlash(value, caret, item) {
  const a = lineStart(value, caret);
  const [before, after] = item.text.split('‸');
  const v = value.slice(0, a) + before + after + value.slice(caret);
  return { value: v, caret: a + before.length };
}

// The headings of a text (## and ###), with the line they stand on; code and display formulas are skipped.
export function headingsOf(text) {
  const out = [];
  let fence = false;
  let math = false;
  String(text).split('\n').forEach((line, i) => {
    const s = line.trim();
    if (/^(```|~~~)/.test(s)) { fence = !fence; return; }
    if (fence) return;
    if (s === '$$') { math = !math; return; }
    if (math) return;
    const m = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (m) out.push({ level: m[1].length - 1, title: m[2], line: i });
  });
  return out;
}

// What you are typing after "[[", or null.
export function linkQuery(value, caret) {
  const m = String(value).slice(Math.max(0, caret - 60), caret).match(/\[\[([^\]\n|[]{0,50})$/);
  return m ? m[1] : null;
}
// Replaces "[[query" before the caret with "[[slug]]". Returns { value, caret }.
export function completeLink(value, caret, slug) {
  const q = linkQuery(value, caret);
  if (q == null) return { value, caret };
  const start = caret - q.length;
  const rest = value.slice(caret);
  const closing = rest.startsWith(']]') ? '' : ']]';
  const next = `${value.slice(0, start)}${slug}${closing}${rest}`;
  const at = start + slug.length + 2;
  return { value: next, caret: at };
}

// ------------------------------------------------------------------ the editor
// opts: { page: { path, title, body, problems, lang }, onInput(fields), onCursor(at), onLeave }
// Returns { el, get(), insert(md), focus(), setStatus(kind), refresh() }.
export function mountEditor(opts) {
  const lang = getLang();
  const page = opts.page;
  let mode = loadPref('editor.mode', 'split');
  const el = h('div', { class: 'pe', dataset: { mode } });
  const title = h('input', { class: 'pe-title', type: 'text', value: page.title, 'aria-label': t('editor.title'), placeholder: t('editor.title') });
  const helps = h('input', { class: 'field pe-helps small', type: 'text', value: page.problems.join('; '), 'aria-label': t('editor.helps'), placeholder: t('editor.helps.placeholder') });
  // "Helps with" stays folded until you want it (0.15.1); with something in it, it says what
  const helpsBox = h('details', { class: 'pe-more', open: page.problems.length ? null : null },
    h('summary', { class: 'small muted' }, h('span', { text: page.problems.length ? `${t('editor.helps')}: ${page.problems.join('; ')}` : t('editor.helps.add') })),
    h('label', { class: 'pe-helps-row' }, h('span', { class: 'small', text: t('editor.helps') }), helps));
  const status = h('span', { class: 'pe-status small muted', 'aria-live': 'polite' });
  const bar = h('div', { class: 'pe-bar', role: 'toolbar', 'aria-label': t('editor.tools') });
  const modes = h('div', { class: 'segmented pe-modes', role: 'group' });
  const text = h('textarea', { class: 'pe-text', spellcheck: 'true', 'aria-label': t('editor.text'), placeholder: t('editor.placeholder') });
  text.value = page.body;
  const preview = h('div', { class: 'pe-preview rd-inner' });
  const suggest = h('ul', { class: 'pe-suggest', role: 'listbox', hidden: true });
  const wrapEl = h('div', { class: 'pe-panes' }, h('div', { class: 'pe-write' }, text, suggest), preview);
  el.append(h('div', { class: 'pe-head' }, title, helpsBox),
    h('div', { class: 'pe-tools' }, bar, modes, status), wrapEl);

  const fields = () => ({ title: title.value, problems: helps.value.split(/[;\n]/).map((x) => x.trim()).filter(Boolean), body: text.value });
  const changed = () => opts.onInput?.(fields());

  // tools
  const TOOL_ICON = { heading: null, bold: null, italic: null, math: null, display: null, list: 'list', numbered: null, quote: 'comment', code: 'code', link: 'link' };
  const TOOL_TEXT = { heading: 'H', bold: 'B', italic: 'I', math: '$x$', display: '$$', numbered: '1.' };
  for (const tool of TOOLS) {
    const b = h('button', { type: 'button', class: `pe-tool pe-tool-${tool}`, title: t(`editor.tool.${tool}`), 'aria-label': t(`editor.tool.${tool}`) },
      TOOL_ICON[tool] ? iconEl(TOOL_ICON[tool]) : h('span', { class: 'pe-tool-text', text: TOOL_TEXT[tool] }));
    b.addEventListener('pointerdown', (e) => e.preventDefault());   // keep the selection in the text
    b.addEventListener('click', () => use(tool));
    bar.append(b);
  }
  function use(tool) {
    const r = applyTool(text.value, text.selectionStart, text.selectionEnd, tool);
    setText(r.value, r.start, r.end);
    if (tool === 'link') showSuggest();
  }
  // Replaces only the part that changed, so undo and the scroll position stay.
  function setText(value, start, end = start) {
    const old = text.value;
    const top = text.scrollTop;
    let a = 0;
    while (a < old.length && a < value.length && old[a] === value[a]) a++;
    let b = 0;
    while (b < old.length - a && b < value.length - a && old[old.length - 1 - b] === value[value.length - 1 - b]) b++;
    if (text.offsetParent) text.focus();
    text.setSelectionRange(a, old.length - b);
    let ok = false;
    try { ok = text.offsetParent ? document.execCommand('insertText', false, value.slice(a, value.length - b)) : false; } catch { ok = false; }
    if (text.value !== value) text.value = value;
    text.setSelectionRange(start, end);
    text.scrollTop = top;
    if (!ok) onText();
  }

  // modes: split | write | preview (split only on wide screens)
  function drawModes() {
    const list = narrow() ? ['write', 'preview'] : ['split', 'write', 'preview'];
    if (!list.includes(mode)) mode = list[0];
    el.dataset.mode = mode;
    modes.replaceChildren(...list.map((m) => h('button', {
      type: 'button', class: mode === m ? 'on' : '', 'aria-pressed': String(mode === m), text: t(`editor.mode.${m}`),
      onclick: () => { mode = m; savePref('editor.mode', m); drawModes(); if (m !== 'write') drawPreview(); else text.focus(); },
    })));
  }

  // preview
  const onNodeLink = (slug) => {
    const target = nodeBySlug(slug);
    return target ? { href: nodeHref(target.path), label: lang === 'de' && target.title_de ? target.title_de : target.title } : null;
  };
  const onCopy = async (s) => { const ok = await copyText(s); toast(t(ok ? 'node.copied' : 'node.copyFailed'), ok ? 'ok' : 'error'); };
  function drawPreview() {
    if (mode === 'write') return;
    const top = preview.scrollTop;
    preview.replaceChildren(text.value.trim() ? renderMarkdown(text.value, { onNodeLink, onCopy }) : h('p', { class: 'muted', text: t('editor.empty') }));
    preview.scrollTop = top;
  }
  const previewSoon = debounce(drawPreview, 200);

  // [[link]] suggestions
  let hits = [];
  let pick = 0;
  let slash = false;   // the list shows blocks for "/" instead of nodes for "[["
  function showSuggest() {
    const sq = slashQuery(text.value, text.selectionStart);
    if (sq != null) {
      slash = true;
      hits = slashHits(sq);
      pick = 0;
      if (!hits.length) { suggest.hidden = true; return; }
      drawSuggest();
      suggest.hidden = false;
      return;
    }
    slash = false;
    const q = linkQuery(text.value, text.selectionStart);
    if (q == null) { suggest.hidden = true; hits = []; return; }
    const own = page.path;
    hits = (q.trim() ? searchNodes(q, { limit: 8, filter: (d) => !d.conflict && d.path !== own })
      : allNodes().filter((d) => d.type === 'page' && d.library === page.library && d.path !== own).slice(0, 8));
    pick = 0;
    if (!hits.length) { suggest.hidden = true; return; }
    drawSuggest();
    suggest.hidden = false;
  }
  function drawSuggest() {
    if (slash) {
      suggest.replaceChildren(...hits.map((s, k) => {
        const li = h('li', { role: 'option', class: `pe-slash${k === pick ? ' on' : ''}`, 'aria-selected': String(k === pick), dataset: { id: s.id } },
          h('span', { class: 'pe-slash-mark', text: s.text.replace('‸', '').split('\n')[0].trim().slice(0, 6) || '¶' }),
          h('span', { class: 'pe-suggest-title', text: t(`editor.slash.${s.id}`) }));
        li.addEventListener('pointerdown', (e) => { e.preventDefault(); choose(s); });
        return li;
      }));
      return;
    }
    suggest.replaceChildren(...hits.map((d, k) => {
      const li = h('li', { role: 'option', class: k === pick ? 'on' : '', 'aria-selected': String(k === pick) },
        h('span', { class: 'rs-tag', text: t(`type.${d.type}`) === `type.${d.type}` ? d.type : t(`type.${d.type}`) }),
        h('span', { class: 'pe-suggest-title', text: lang === 'de' && d.title_de ? d.title_de : d.title }),
        h('span', { class: 'muted small', text: d.slug }));
      li.addEventListener('pointerdown', (e) => { e.preventDefault(); choose(d); });
      return li;
    }));
  }
  function choose(d) {
    if (slash) {
      const r = applySlash(text.value, text.selectionStart, d);
      suggest.hidden = true;
      slash = false;
      setText(r.value, r.caret);
      if (d.id === 'link') showSuggest();
      return;
    }
    const r = completeLink(text.value, text.selectionStart, d.slug);
    suggest.hidden = true;
    setText(r.value, r.caret);
  }
  text.addEventListener('keydown', (e) => {
    if (!suggest.hidden && hits.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); pick = (pick + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; drawSuggest(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(hits[pick]); return; }
      if (e.key === 'Escape') { e.preventDefault(); suggest.hidden = true; return; }
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && (e.key === 'b' || e.key === 'i')) { e.preventDefault(); use(e.key === 'b' ? 'bold' : 'italic'); }   // Cmd+K stays the command bar
    if (mod && e.key === 's') { e.preventDefault(); opts.onSaveNow?.(); }
  });

  const cursorSoon = debounce(() => opts.onCursor?.(text.selectionStart), 250);
  const headsSoon = debounce(() => opts.onHeadings?.(headingsOf(text.value)), 400);
  function onText() {
    headsSoon();
    changed();
    previewSoon();
    showSuggest();
    cursorSoon();
  }
  text.addEventListener('input', onText);
  for (const ev of ['keyup', 'click', 'select']) text.addEventListener(ev, () => { cursorSoon(); if (ev !== 'select') showSuggest(); });
  text.addEventListener('blur', () => { setTimeout(() => { suggest.hidden = true; }, 150); opts.onCursor?.(text.selectionStart); opts.onLeave?.(); });
  title.addEventListener('input', changed);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); text.focus(); } });
  helps.addEventListener('input', () => { helpsBox.querySelector('summary span').textContent = helps.value.trim() ? `${t('editor.helps')}: ${helps.value.trim()}` : t('editor.helps.add'); });
  helps.addEventListener('input', changed);
  for (const f of [title, helps]) f.addEventListener('blur', () => opts.onLeave?.());

  const onResize = debounce(() => { if (el.isConnected) drawModes(); else window.removeEventListener('resize', onResize); }, 200);
  window.addEventListener('resize', onResize);
  drawModes();
  drawPreview();

  return {
    el,
    get: fields,
    textarea: text,
    // Puts markdown where the cursor is, as its own paragraph (a quote, a formula, a link).
    insert(md, { inline = false } = {}) {
      const s = text.selectionStart ?? text.value.length;
      const e = text.selectionEnd ?? s;
      if (inline) { const v = text.value; setText(v.slice(0, s) + md + v.slice(e), s + md.length); return; }
      const v = text.value.slice(0, s) + text.value.slice(e);
      const r = block(v, s, s, '', '', md);
      setText(r.value, r.end);
    },
    // Goes to a line of the text (a heading in the outline): the cursor there, the line near the top, the preview too.
    jumpTo(line, heading = '') {
      const lines = text.value.split('\n');
      const at = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
      if (mode === 'preview') { mode = narrow() ? 'write' : 'split'; drawModes(); drawPreview(); }
      text.focus({ preventScroll: true });
      text.setSelectionRange(at, at);
      const lh = parseFloat(getComputedStyle(text).lineHeight) || 22;
      text.scrollTop = Math.max(0, line * lh - 40);
      if (heading) {
        const hit = [...preview.querySelectorAll('h2, h3, h4')].find((x) => x.textContent.trim() === heading.replace(/[*`$]/g, '').trim());
        if (hit) preview.scrollTop = hit.offsetTop - preview.offsetTop - 12;
      }
    },
    headings: () => headingsOf(text.value),
    setStatus(kind) { status.textContent = kind ? t(`editor.status.${kind}`) : ''; status.dataset.kind = kind || ''; },
    focus() { text.focus(); },
    refresh(body) { const at = text.selectionStart; text.value = body; text.setSelectionRange(Math.min(at, body.length), Math.min(at, body.length)); drawPreview(); },
    destroy() { window.removeEventListener('resize', onResize); },
  };
}
