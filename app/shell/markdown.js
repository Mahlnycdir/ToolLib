// A small Markdown renderer for nodes. It builds DOM elements directly and never sets innerHTML,
// so text from the knowledge (later also from the web) cannot inject scripts.
// Covers what nodes use: headings, paragraphs, lists, quotes, tables, code blocks with copy buttons,
// formulas ($$ … $$ and $ … $, set with KaTeX since 0.12.0; the copy button gives the LaTeX), inline code, bold,
// italic, links and [[node]] links. Spots of an open convention (0.13.0) come marked from services/choices.js
// and show highlighted.
import { h } from '../services/ui.js';
import { stripMarks, unmarkTex } from '../services/choices.js';
import { icon } from '../services/icons.js';
import { t } from '../i18n/i18n.js';
import { typeset } from './math.js';

const SECTION_KEYS = {
  example: 'section.example', examples: 'section.example', pitfalls: 'section.pitfalls', check: 'section.check', steps: 'section.steps', derivation: 'section.derivation',
  text: 'section.text', references: 'section.references', highlights: 'section.highlights',   // parts of a clip (0.14.1)
};
const iconEl = (name) => h('span', { class: 'icon', html: icon(name) });

// options: onCopy(text, label), onNodeLink(slug) → { label, open } or null
export function renderMarkdown(md, options = {}) {
  const root = h('div', { class: 'md' });
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const isBlank = (l) => !l || !l.trim();
  const startsBlock = (l) => /^(```|~~~)/.test(l.trim()) || /^\s*\$\$/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l)
    || /^\s*([-*+]|\d+[.)])\s+/.test(l) || /^\s*\|/.test(l) || /^\s*(-{3,}|\*{3,})\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    const fence = line.trim().match(/^(```|~~~)\s*([\w+-]*)/);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      root.append(codeBlock(body.join('\n'), fence[2], options));
      continue;
    }

    if (/^\s*\$\$/.test(line)) {
      let tex = line.trim().slice(2);
      if (tex.endsWith('$$') && tex.length >= 2) tex = tex.slice(0, -2);
      else {
        const body = [tex];
        i++;
        while (i < lines.length && !lines[i].includes('$$')) body.push(lines[i++]);
        if (i < lines.length) body.push(lines[i].slice(0, lines[i].indexOf('$$')));
        tex = body.join('\n');
      }
      i++;
      root.append(mathBlock(tex.trim(), options));
      continue;
    }

    const head = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (head) {
      const level = Math.min(4, Math.max(2, head[1].length));
      const key = SECTION_KEYS[head[2].trim().toLowerCase()];
      root.append(h(`h${level}`, {}, key ? t(key) : inline(head[2], options)));
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { root.append(h('hr')); i++; continue; }

    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      root.append(h('blockquote', {}, renderMarkdown(body.join('\n'), options)));
      continue;
    }

    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      root.append(table(rows, options));
      continue;
    }

    const item = line.match(/^\s*([-*+]|\d+[.)])\s+/);
    if (item) {
      const ordered = /\d/.test(item[1]);
      const list = h(ordered ? 'ol' : 'ul');
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (!m) break;
        const text = [m[2]];
        i++;
        while (i < lines.length && !isBlank(lines[i]) && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) text.push(lines[i++].trim());
        list.append(h('li', {}, inline(text.join(' '), options)));
        if (i < lines.length && isBlank(lines[i]) && i + 1 < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i + 1])) i++;
      }
      root.append(list);
      continue;
    }

    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && (para.length === 0 || !startsBlock(lines[i]))) para.push(lines[i++].trim());
    root.append(h('p', {}, inline(para.join(' '), options)));
  }
  return root;
}

// ------------------------------------------------------------------ blocks
function copyButton(getText, label, options) {
  return h('button', {
    type: 'button', class: 'copy-btn', title: t('node.copy'), 'aria-label': `${t('node.copy')}: ${label}`,
    onclick: () => options.onCopy?.(getText(), label),
  }, iconEl('copy'), h('span', { text: t('node.copy') }));
}

const PLACEHOLDER = /\$\{(?:\d+:)?([^}]*)\}/g;

const SPOT = /([\uE000\uE002])([^\uE001]*)\uE001/g;
const spotEl = (open, text) => h('mark', { class: `choice-spot${open ? ' open' : ''}`, title: t('choice.spot') }, text);

function codeBlock(code, lang, options) {
  const pre = h('pre', {});
  const el = h('code', {});
  let last = 0;
  const plain = (s) => {
    let at = 0;
    for (const m of s.matchAll(SPOT)) {
      el.append(s.slice(at, m.index), spotEl(m[1] === '\uE002', m[2]));
      at = m.index + m[0].length;
    }
    el.append(s.slice(at));
  };
  for (const m of code.matchAll(PLACEHOLDER)) {
    plain(code.slice(last, m.index));
    el.append(h('span', { class: 'ph', title: t('node.placeholder'), text: m[1] }));
    last = m.index + m[0].length;
  }
  plain(code.slice(last));
  pre.append(el);
  const label = lang || t('node.code');
  return h('div', { class: 'code-block' },
    h('div', { class: 'code-head' }, h('span', { class: 'code-lang', text: label }), copyButton(() => stripMarks(code.replace(PLACEHOLDER, '$1')), label, options)),
    pre);
}

// A display formula: set with KaTeX; the button copies the LaTeX as written in the node.
function mathBlock(tex, options) {
  return h('div', { class: 'code-block math' },
    h('div', { class: 'code-head' }, h('span', { class: 'code-lang', text: 'LaTeX' }), copyButton(() => unmarkTex(tex), 'LaTeX', options)),
    typeset(h('div', { class: 'math-display', dataset: { tex: unmarkTex(tex), display: '1' } }), tex, true));
}

function table(rows, options) {
  const cells = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  const tbl = h('table', {}, h('thead', {}, h('tr', {}, head.map((c) => h('th', {}, inline(c, options))))));
  const body = h('tbody');
  for (const r of rows.slice(2)) body.append(h('tr', {}, cells(r).map((c) => h('td', {}, inline(c, options)))));
  tbl.append(body);
  return h('div', { class: 'table-wrap' }, tbl);
}

// ------------------------------------------------------------------ inline
const INLINE = new RegExp([
  '`([^`]+)`', // 1 code
  '\\[\\[([^\\]|]+)(?:\\|([^\\]]+))?\\]\\]', // 2,3 node link
  '\\[((?:[^\\]\\\\]|\\\\.)+)\\]\\(((?:[^()\\s]|\\([^()\\s]*\\))+)(?:\\s+"[^"]*")?\\)', // 4,5 link, also [text](address "title") and a (bracket) in the address
  '\\*\\*([^*]+)\\*\\*', // 6 bold (no __bold__: Python names like __init__ stay as they are)
  '\\*([^*\\s][^*]*?)\\*', // 7 italic (no _italic_ for the same reason)
  '\\$([^$\\n]+?)\\$', // 8 inline formula
  '(https?:\\/\\/[^\\s<>()]+[^\\s<>().,;:!?])', // 9 bare address
  '([\\uE000\\uE002])([^\\uE001]*)\\uE001', // 10, 11 spot of an open convention (0.13.0)
].join('|'), 'g');

const safeUrl = (u) => (/^(https?:|mailto:)/i.test(u) ? u : null);

export function inline(text, options = {}) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    frag.append(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] != null) frag.append(h('code', { text: m[1] }));
    else if (m[2] != null) {
      const target = options.onNodeLink?.(m[2].trim());
      const label = m[3] || target?.label || m[2];
      frag.append(target ? h('a', { href: target.href, class: 'node-link', text: label }) : h('span', { class: 'node-link missing', title: t('node.missing'), text: label }));
    } else if (m[4] != null) {
      const url = safeUrl(m[5]);
      // "#" and "¶" behind a heading are the permalink marks of documentation pages (Sphinx, MkDocs): no text of yours
      if (/^[#¶§🔗]$/u.test(m[4].trim())) continue;
      frag.append(url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, inline(m[4], options)) : inline(m[4], options));
    } else if (m[6] != null) frag.append(h('strong', {}, inline(m[6], options)));
    else if (m[7] != null) frag.append(h('em', {}, inline(m[7], options)));
    else if (m[8] != null) frag.append(typeset(h('span', { class: 'math-inline', title: unmarkTex(m[8]), dataset: { tex: unmarkTex(m[8]) } }), m[8], false));
    else if (m[9] != null) frag.append(h('a', { href: m[9], target: '_blank', rel: 'noopener noreferrer', text: m[9] }));
    else if (m[10] != null) frag.append(spotEl(m[10] === '\uE002', inline(m[11], options)));
  }
  frag.append(text.slice(last));
  return frag;
}
