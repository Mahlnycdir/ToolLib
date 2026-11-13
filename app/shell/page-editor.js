// The page editor (0.14.2): Markdown on the left, set as it will look on the right (on the iPhone you switch), a bar for
// heading, bold, formula, list, quote, code and [[link]] with suggestions from your knowledge. It saves by itself a
// moment after you stop typing, when you leave and when the app goes to the background.
// Since 0.17.0 the text is written in md-editor.js (colours, completion, shorthand, lists that continue); the bar has
// task, [@source], image and the formula palette too, every button shows its keys, and a page can carry images,
// ```plot blocks and Python plots.
import { h, debounce, loadPref, savePref, copyText, toast, pickFiles, keepScroll } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { getLang, t } from '../i18n/i18n.js';
import { renderMarkdown, exportMarkdown } from './markdown.js';
import { searchNodes, nodeBySlug, allNodes } from '../services/search.js';
import { nodeHref } from './node-view.js';
import { createEditor } from './md-editor.js';
import { keyTitle } from '../services/keys.js';
import { saveImage, assetUrl, savePlot } from '../services/assets.js';
import { openTexPalette } from './tex-palette.js';

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

export const TOOLS = ['heading', 'bold', 'italic', 'math', 'display', 'list', 'numbered', 'task', 'quote', 'code', 'link', 'cite'];
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
    case 'task': return prefixLines(v, start, end, () => '- [ ] ', /^\s*[-*+]\s+\[[ xX]\]\s+|^\s*[-*+]\s+/);
    case 'quote': return prefixLines(v, start, end, () => '> ', /^\s*>\s?/);
    case 'code': return block(v, start, end, '```python\n', '\n```', '');
    case 'link': return wrap(v, start, end, '[[', ']]', '');
    case 'cite': return wrap(v, start, end, '[@', ']', '');
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
  { id: 'cite', keys: 'cite quelle source zitieren literatur', text: '[@‸]' },
  { id: 'image', keys: 'image bild foto picture', text: '![‸](assets/)' },
  { id: 'plot', keys: 'plot graph funktion function kurve curve', text: '```plot\ny = ‸sin(x)\nx: -2pi .. 2pi\n```' },
  { id: 'pyplot', keys: 'pyplot matplotlib python plot figure abbildung', text: '```python plot\nx = np.linspace(0, 10, 400)\nplt.plot(x, np.sin(x)‸)\nplt.show()\n```' },
  { id: 'aligned', keys: 'aligned umformung align rechnung derivation', text: '$$\n\\begin{aligned}\n‸ &= \\\\\n&= \n\\end{aligned}\n$$' },
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

// ------------------------------------------------------------------ moving a section (0.17.0)
// The section of a heading: from its line to the line before the next heading of the same or a higher level.
export function sectionOf(text, line) {
  const heads = headingsOf(text);
  const k = heads.findIndex((x) => x.line === line);
  if (k < 0) return null;
  const lines = String(text).split('\n');
  const next = heads.slice(k + 1).find((x) => x.level <= heads[k].level);
  return { from: line, to: next ? next.line : lines.length, level: heads[k].level };
}
// Moves the section that starts at line `from` in front of the heading at line `before` (or to the end with -1).
// Returns the new text, or null when nothing moves (into itself, onto the same place).
export function moveSection(text, from, before) {
  const sec = sectionOf(text, from);
  if (!sec) return null;
  const lines = String(text).split('\n');
  if (before >= sec.from && before < sec.to) return null;
  if (before === sec.to) return null;
  const block = lines.slice(sec.from, sec.to);
  if (block.length && block[block.length - 1].trim() !== '') block.push('');
  const rest = [...lines.slice(0, sec.from), ...lines.slice(sec.to)];
  let at = before < 0 ? rest.length : before > sec.from ? before - (sec.to - sec.from) : before;
  if (before < 0 && rest.length && rest[rest.length - 1].trim() !== '') rest.push(''), (at = rest.length);
  const out = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  while (out.length > 1 && out[out.length - 1] === '' && out[out.length - 2] === '') out.pop();
  const joined = out.join('\n');
  return joined === text ? null : joined;
}

// ------------------------------------------------------------------ the editor
// opts: { page: { path, title, body, problems, lang, library }, onInput(fields), onCursor(at), onLeave, onSaveNow,
//   onHeadings(list), works() → kept works of the project (for [@ sources) }
// Returns { el, get(), insert(md, {inline}), jumpTo(line, heading), headings(), setStatus(kind), focus(), refresh(body),
//   editor, destroy() }.
export function mountEditor(opts) {
  const lang = getLang();
  const page = opts.page;
  let mode = loadPref('editor.mode', 'split');
  const el = h('div', { class: 'pe', dataset: { mode } });
  const title = h('input', { class: 'pe-title', type: 'text', value: page.title, 'aria-label': t('editor.title'), placeholder: t('editor.title') });
  const helps = h('input', { class: 'field pe-helps small', type: 'text', value: page.problems.join('; '), 'aria-label': t('editor.helps'), placeholder: t('editor.helps.placeholder') });
  const helpsBox = h('details', { class: 'pe-more' },
    h('summary', { class: 'small muted' }, h('span', { text: page.problems.length ? `${t('editor.helps')}: ${page.problems.join('; ')}` : t('editor.helps.add') })),
    h('label', { class: 'pe-helps-row' }, h('span', { class: 'small', text: t('editor.helps') }), helps));
  const status = h('span', { class: 'pe-status small muted', 'aria-live': 'polite' });
  const bar = h('div', { class: 'pe-bar', role: 'toolbar', 'aria-label': t('editor.tools') });
  const modes = h('div', { class: 'segmented pe-modes', role: 'group' });
  const host = h('div', { class: 'pe-text' });
  // switching between writing and preview on the phone keeps the place in the preview (0.22.0)
  const preview = keepScroll(h('div', { class: 'pe-preview rd-inner' }));
  const wrapEl = h('div', { class: 'pe-panes' }, h('div', { class: 'pe-write' }, host), preview);
  el.append(h('div', { class: 'pe-head' }, title, helpsBox), h('div', { class: 'pe-tools' }, bar, modes, status), wrapEl);

  // ---------------------------------------------------------------- what the completion offers
  const linkHits = (q) => {
    const own = page.path;
    const list = q.trim() ? searchNodes(q, { limit: 10, filter: (d) => !d.conflict && d.path !== own })
      : allNodes().filter((d) => d.type === 'page' && d.library === page.library && d.path !== own).slice(0, 10);
    return list.map((d) => ({ slug: d.slug, label: lang === 'de' && d.title_de ? d.title_de : d.title, kind: t(`type.${d.type}`) === `type.${d.type}` ? d.type : t(`type.${d.type}`) }));
  };
  const workInfo = (d) => ({ slug: d.slug, label: d.title, detail: d.arxiv ? `arXiv ${d.arxiv}` : d.doi ? d.doi : d.url ? d.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : t(`type.${d.type}`) });
  const citeHits = (q) => {
    const works = (opts.works?.() || []).filter((d) => d && d.slug);
    const w = q.trim().toLowerCase();
    const mine = works.filter((d) => !w || d.title.toLowerCase().includes(w) || d.slug.includes(w));
    const seen = new Set(mine.map((d) => d.slug));
    const more = w ? searchNodes(q, { limit: 8, filter: (d) => !d.conflict && !seen.has(d.slug) && ['clip', 'page', 'formula', 'term', 'theorem', 'definition', 'snippet'].includes(d.type) }) : [];
    return [...mine.slice(0, 12), ...more].map(workInfo);
  };

  // ---------------------------------------------------------------- the editor
  const fields = () => ({ title: title.value, problems: helps.value.split(/[;\n]/).map((x) => x.trim()).filter(Boolean), body: editor.value() });
  const changed = () => opts.onInput?.(fields());
  const cursorSoon = debounce((at) => opts.onCursor?.(at), 250);
  const headsSoon = debounce(() => opts.onHeadings?.(headingsOf(editor.value())), 400);
  const previewSoon = debounce(() => drawPreview(), 200);
  const editor = createEditor(host, {
    value: page.body,
    kind: 'page',
    placeholder: t('editor.placeholder'),
    slash: slashHits,
    links: linkHits,
    cites: citeHits,
    onImage: addImage,
    onChange: (v, { external }) => { headsSoon(); previewSoon(); if (!external) changed(); },
    onSelection: (at) => cursorSoon(at),
    onBlur: () => { opts.onCursor?.(editor.selection().from); opts.onLeave?.(); },
    actions: {
      'editor.bold': () => use('bold'), 'editor.italic': () => use('italic'), 'editor.math': () => use('math'), 'editor.display': () => use('display'),
      'editor.heading': () => use('heading'), 'editor.list': () => use('list'), 'editor.numbered': () => use('numbered'), 'editor.task': () => use('task'),
      'editor.quote': () => use('quote'), 'editor.code': () => use('code'), 'editor.link': () => use('link'), 'editor.cite': () => use('cite'),
      'editor.image': () => pickImage(), 'editor.palette': () => palette(), 'editor.complete': () => editor.complete(),
      'editor.mode': () => cycleMode(), 'editor.save': () => opts.onSaveNow?.(),
    },
  });

  function use(tool) {
    editor.apply((v, a, b) => applyTool(v, a, b, tool));
    if (tool === 'link' || tool === 'cite') editor.complete();
  }
  async function addImage(file) {
    try {
      const path = await saveImage(file);
      return `![${(file.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[[\]]/g, '')}](${path})`;
    } catch (e) {
      toast(t(e?.message === 'svg' ? 'editor.image.svg' : e?.message === 'no-knowledge' ? 'editor.image.noKnowledge' : 'editor.image.failed'), 'error', 5000);
      return '';
    }
  }
  async function pickImage() {
    const files = await pickFiles({ accept: 'image/*', multiple: true });
    for (const f of files) { const md = await addImage(f); if (md) editor.insert(md); }
  }
  function palette() {
    openTexPalette((entry, { display }) => editor.insertTemplate(entry.template, { display }), { inMath: editor.inMath() });
  }

  // ---------------------------------------------------------------- the bar: every button shows its keys
  const TOOL_ICON = { list: 'list', quote: 'comment', code: 'code', link: 'link' };
  const TOOL_TEXT = { heading: 'H', bold: 'B', italic: 'I', math: '$x$', display: '$$', numbered: '1.', task: '☐', cite: '[@]' };
  const button = (id, action, content, onClick) => {
    const b = h('button', { type: 'button', class: `pe-tool pe-tool-${id}`, 'aria-label': t(`editor.tool.${id}`) }, content);
    keyTitle(b, t(`editor.tool.${id}`), action);
    b.addEventListener('pointerdown', (e) => e.preventDefault());   // the selection stays in the text
    b.addEventListener('click', onClick);
    return b;
  };
  for (const tool of TOOLS) {
    bar.append(button(tool, `editor.${tool}`, TOOL_ICON[tool] ? h('span', { class: 'icon', html: icon(TOOL_ICON[tool]) }) : h('span', { class: 'pe-tool-text', text: TOOL_TEXT[tool] }), () => use(tool)));
  }
  bar.append(h('span', { class: 'pe-bar-gap' }),
    button('image', 'editor.image', h('span', { class: 'icon', html: icon('image') }), pickImage),
    button('palette', 'editor.palette', h('span', { class: 'pe-tool-text', text: 'Σ' }), palette));

  // ---------------------------------------------------------------- modes: split | write | preview (split only when wide)
  const narrow = () => window.matchMedia('(max-width: 759px)').matches;
  function drawModes() {
    const list = narrow() ? ['write', 'preview'] : ['split', 'write', 'preview'];
    if (!list.includes(mode)) mode = list[0];
    el.dataset.mode = mode;
    modes.replaceChildren(...list.map((m) => {
      const b = h('button', {
        type: 'button', class: mode === m ? 'on' : '', 'aria-pressed': String(mode === m), text: t(`editor.mode.${m}`),
        onclick: () => setMode(m),
      });
      keyTitle(b, t(`editor.mode.${m}`), 'editor.mode');
      return b;
    }));
  }
  function setMode(m) { mode = m; savePref('editor.mode', m); drawModes(); if (m !== 'write') drawPreview(); else editor.focus(); }
  function cycleMode() { const list = narrow() ? ['write', 'preview'] : ['split', 'write', 'preview']; setMode(list[(list.indexOf(mode) + 1) % list.length]); }

  // ---------------------------------------------------------------- preview
  const onNodeLink = (slug) => {
    const target = nodeBySlug(slug);
    return target ? { href: nodeHref(target.path), label: lang === 'de' && target.title_de ? target.title_de : target.title } : null;
  };
  const onCite = (slug) => {
    const d = nodeBySlug(slug);
    if (!d) return null;
    const url = d.doi ? `https://doi.org/${d.doi}` : d.arxiv ? `https://arxiv.org/abs/${d.arxiv}` : d.url || d.sourceUrls?.[0] || '';
    return { href: nodeHref(d.path), label: lang === 'de' && d.title_de ? d.title_de : d.title, url };
  };
  const onCopy = async (s) => { const ok = await copyText(s); toast(t(ok ? 'node.copied' : 'node.copyFailed'), ok ? 'ok' : 'error'); };
  const onPlot = (code) => drawPythonPlot(code);
  function drawPreview() {
    if (mode === 'write') return;
    const top = preview.scrollTop;
    const v = editor.value();
    preview.replaceChildren(v.trim() ? renderMarkdown(v, { onNodeLink, onCopy, onCite, onAsset: assetUrl, onPlot }) : h('p', { class: 'muted', text: t('editor.empty') }));
    preview.scrollTop = top;
  }

  // the page as Markdown for outside: sources as numbered links with a list at the end
  const exportText = () => exportMarkdown(`# ${title.value}\n\n${editor.value()}`, onCite, t('md.sources'));

  title.addEventListener('input', changed);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); editor.focus(); } });
  helps.addEventListener('input', () => { helpsBox.querySelector('summary span').textContent = helps.value.trim() ? `${t('editor.helps')}: ${helps.value.trim()}` : t('editor.helps.add'); });
  helps.addEventListener('input', changed);
  for (const f of [title, helps]) f.addEventListener('blur', () => opts.onLeave?.());

  const onResize = debounce(() => { if (el.isConnected) drawModes(); else window.removeEventListener('resize', onResize); }, 200);
  window.addEventListener('resize', onResize);
  drawModes();
  drawPreview();

  return {
    el,
    editor,
    get: fields,
    exportText,
    insert(md, { inline = false } = {}) { editor.insert(md, { inline }); },
    // Goes to a line of the text (a heading in the outline): the cursor there, the line near the top, the preview too.
    jumpTo(line, heading = '') {
      if (mode === 'preview') { mode = narrow() ? 'write' : 'split'; drawModes(); drawPreview(); }
      editor.focus();
      editor.scrollToLine(line);
      if (heading) {
        const hit = [...preview.querySelectorAll('h2, h3, h4')].find((x) => x.textContent.trim() === heading.replace(/[*`$]/g, '').trim());
        if (hit) preview.scrollTop = hit.offsetTop - preview.offsetTop - 12;
      }
    },
    // Moves a section (heading line `from`) in front of the heading at line `before` (-1: to the end).
    moveSection(from, before) {
      const next = moveSection(editor.value(), from, before);
      if (next == null) return false;
      editor.apply(() => ({ value: next, start: Math.min(next.length, editor.selection().from) }));
      return true;
    },
    headings: () => headingsOf(editor.value()),
    setStatus(kind) { status.textContent = kind ? t(`editor.status.${kind}`) : ''; status.dataset.kind = kind || ''; },
    focus() { editor.focus(); },
    refresh(body) { editor.setValue(body); drawPreview(); },
    destroy() { window.removeEventListener('resize', onResize); editor.destroy(); },
  };
}

// A ```python plot block: run it once with Python (in the browser), store the last figure under assets/plots/, show it.
async function drawPythonPlot(code) {
  const { runPython } = await import('../services/python.js');
  let last = null;
  let err = '';
  await new Promise((resolve) => {
    const sink = {
      started() {}, progress() {}, note() {}, figureClosed() {}, liveEnded() {}, cancelInput() {}, detach() { resolve(); },
      write(text, kind) { if (kind === 'err') err += text; },
      figure(key, b64) { last = b64; },
      requestInput() { return Promise.resolve(null); },
      done() { resolve(); },
    };
    runPython({ name: 'plot', code: /\bplt\.show\(/.test(code) ? code : `${code}\nplt.show()`, deps: [], check: null }, sink).catch(() => resolve());
  });
  if (!last) { if (err) throw new Error(err.trim().split('\n').pop()); return null; }
  const path = await savePlot(code, last);
  return assetUrl(path);
}
