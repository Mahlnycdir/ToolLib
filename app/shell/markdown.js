// A small Markdown renderer for nodes. It builds DOM elements directly and never sets innerHTML,
// so text from the knowledge (later also from the web) cannot inject scripts.
// Covers what nodes use: headings, paragraphs, lists, quotes, tables, code blocks with copy buttons,
// formulas ($$ … $$ and $ … $, set with KaTeX since 0.12.0; the copy button gives the LaTeX), inline code, bold,
// italic, links and [[node]] links. Spots of an open convention (0.13.0) come marked from services/choices.js
// and show highlighted. Since 0.17.0: images (![text](assets/… or https://…)), sources [@fund] and [@a, p. 3; @b]
// numbered in order with a list "Sources" at the end, ```plot blocks drawn as a picture (plot.js) and ```python plot
// blocks whose matplotlib figure is stored under assets/plots/ (drawn once with Python, then shown everywhere).
import { h } from '../services/ui.js';
import { stripMarks, unmarkTex } from '../services/choices.js';
import { icon } from '../services/icons.js';
import { t } from '../i18n/i18n.js';
import { typeset } from './math.js';
import { renderPlot } from './plot.js';
import { PLACEHOLDER, fillPlaceholders } from '../services/nodes.js';

const SECTION_KEYS = {
  example: 'section.example', examples: 'section.example', pitfalls: 'section.pitfalls', check: 'section.check', steps: 'section.steps', derivation: 'section.derivation',
  text: 'section.text', references: 'section.references', highlights: 'section.highlights',   // parts of a clip (0.14.1)
};
const iconEl = (name) => h('span', { class: 'icon', html: icon(name) });

// options: onCopy(text, label), onNodeLink(slug) → { label, href } or null, onCite(slug) → { label, href, url } or null
// (sources), onAsset(path) → Promise of an address (images, plots), onPlot(code, figure) (draw a Python plot).
export function renderMarkdown(md, options = {}) {
  const top = !options.cites;
  if (top) options = { ...options, cites: new Map() };
  const root = h('div', { class: 'md' });
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const isBlank = (l) => !l || !l.trim();
  const startsBlock = (l) => /^(```|~~~)/.test(l.trim()) || /^\s*\$\$/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l)
    || /^\s*([-*+]|\d+[.)])\s+/.test(l) || /^\s*\|/.test(l) || /^\s*(-{3,}|\*{3,})\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    const fence = line.trim().match(/^(```|~~~)\s*([\w+-]*)(.*)$/);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      const code = body.join('\n');
      if (fence[2] === 'plot') root.append(renderPlot(code));
      else if (/^(python|py)$/.test(fence[2]) && /\bplot\b/.test(fence[3])) root.append(pyPlot(code, options));
      else root.append(codeBlock(code, fence[2], options));
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
  if (top && options.cites.size) root.append(references(options));
  return root;
}

// The sources you cited, numbered in the order they first appear, with their address when they have one.
function references(options) {
  const list = h('ol', { class: 'md-refs' });
  for (const [slug, c] of options.cites) {
    const t0 = c.target;
    list.append(h('li', { id: `ref-${c.n}` },
      t0?.href ? h('a', { href: t0.href, class: 'node-link', text: t0.label }) : h('span', { class: 'node-link missing', text: slug }),
      t0?.url ? ' · ' : null,
      t0?.url && safeUrl(t0.url) ? h('a', { href: t0.url, target: '_blank', rel: 'noopener noreferrer', class: 'md-ref-url', text: t0.url.replace(/^https?:\/\//, '') }) : null));
  }
  return h('section', { class: 'md-sources' }, h('h3', { text: t('md.sources') }), list);
}

// A Python plot: the stored picture if there is one, a button to draw it (again), the code folded below.
function pyPlot(code, options) {
  const fig = h('figure', { class: 'py-plot' });
  const img = h('img', { class: 'md-img', alt: t('md.plot'), hidden: true });
  const status = h('span', { class: 'small muted' });
  const draw = h('button', { type: 'button', class: 'btn small py-plot-draw' }, h('span', { text: t('md.plot.draw') }));
  draw.addEventListener('click', async () => {
    if (!options.onPlot) return;
    draw.disabled = true;
    status.textContent = t('md.plot.running');
    try {
      const url = await options.onPlot(code);
      if (url) { img.src = url; img.hidden = false; status.textContent = ''; draw.querySelector('span').textContent = t('md.plot.again'); }
      else status.textContent = t('md.plot.none');
    } catch (e) {
      status.textContent = t('md.plot.failed', { error: String(e?.message || e).split('\n')[0].slice(0, 120) });
    } finally { draw.disabled = false; }
  });
  fig.append(img, h('div', { class: 'py-plot-bar' }, options.onPlot ? draw : null, status),
    h('details', { class: 'py-plot-code' }, h('summary', { class: 'small muted', text: t('md.plot.code') }), codeBlock(code, 'python', options)));
  (async () => {
    const { plotPath } = await import('../services/assets.js');
    const url = await options.onAsset?.(await plotPath(code));
    if (url) { img.src = url; img.hidden = false; draw.querySelector('span').textContent = t('md.plot.again'); }
    else if (!options.onPlot) status.textContent = t('md.plot.none');
  })().catch(() => {});
  return fig;
}

// ------------------------------------------------------------------ blocks
function copyButton(getText, label, options) {
  return h('button', {
    type: 'button', class: 'copy-btn', title: t('node.copy'), 'aria-label': `${t('node.copy')}: ${label}`,
    onclick: () => options.onCopy?.(getText(), label),
  }, iconEl('copy'), h('span', { text: t('node.copy') }));
}


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
    if (m[1]) plain(m[0].slice(1));   // $${…}: a plain ${…}
    else el.append(h('span', { class: 'ph', title: t('node.placeholder'), text: m[2] }));
    last = m.index + m[0].length;
  }
  plain(code.slice(last));
  pre.append(el);
  const label = lang || t('node.code');
  return h('div', { class: 'code-block' },
    h('div', { class: 'code-head' }, h('span', { class: 'code-lang', text: label }), copyButton(() => stripMarks(fillPlaceholders(code)), label, options)),
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
  '!\\[([^\\]]*)\\]\\(([^()\\s]+)(?:\\s+"[^"]*")?\\)', // 12, 13 image (0.17.0) (starts at "!", before any link)
  '\\[@([^\\]\\n]+)\\]', // 14 sources (0.17.0)
].join('|'), 'g');

const safeUrl = (u) => (/^(https?:|mailto:)/i.test(u) ? u : null);

// An image of your knowledge (assets/…) or from an https address; nothing else (no data:, no file:).
function image(alt, src, options) {
  const img = h('img', { class: 'md-img', alt: alt || '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  if (/^assets\//.test(src)) {
    img.dataset.asset = src;
    Promise.resolve(options.onAsset?.(src)).then((url) => { if (url) img.src = url; else img.replaceWith(h('span', { class: 'md-img-missing small', text: `🖼 ${alt || src}` })); }).catch(() => {});
  } else if (/^https:\/\//i.test(src)) img.src = src;
  else return h('span', { class: 'md-img-missing small', text: `🖼 ${alt || src}` });
  return img;
}

// [@a] · [@a, p. 3] · [@a; @b] → [1] · [1, p. 3] · [1; 2], each number a link to the source, numbered in order.
export function parseCite(body) {
  return String(body).split(';').map((part) => part.trim().match(/^@?([\w.-]+)\s*(?:,\s*(.+))?$/)).filter(Boolean).map((m) => ({ slug: m[1], at: (m[2] || '').trim() }));
}
function citation(body, options) {
  const parts = parseCite(body);
  if (!parts.length || !options.cites) return document.createTextNode(`[@${body}]`);
  const out = h('span', { class: 'md-cite' }, '[');
  parts.forEach((p, k) => {
    let c = options.cites.get(p.slug);
    if (!c) { c = { n: options.cites.size + 1, target: options.onCite?.(p.slug) || null }; options.cites.set(p.slug, c); }
    if (k) out.append('; ');
    out.append(h('a', { href: c.target?.href || `#ref-${c.n}`, class: `md-cite-n${c.target ? '' : ' missing'}`, title: c.target?.label || p.slug, text: String(c.n) }));
    if (p.at) out.append(`, ${p.at}`);
  });
  out.append(']');
  return out;
}

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
    else if (m[13] != null) frag.append(image(m[12], m[13], options));
    else if (m[14] != null) frag.append(citation(m[14], options));
  }
  frag.append(text.slice(last));
  return frag;
}

// A page as Markdown for outside (0.17.0): [@fund] becomes [n](address), and a numbered list of the sources follows.
export function exportMarkdown(md, onCite, heading = 'Sources') {
  const order = new Map();
  const fenced = String(md).split(/(^```[\s\S]*?^```)/m);
  const body = fenced.map((part, k) => (k % 2 ? part : part.replace(/\[@([^\]\n]+)\]/g, (all, inner) => {
    const parts = parseCite(inner);
    if (!parts.length) return all;
    return `[${parts.map((p) => {
      if (!order.has(p.slug)) order.set(p.slug, { n: order.size + 1, target: onCite?.(p.slug) || null });
      const c = order.get(p.slug);
      const url = c.target?.url;
      return `${url ? `[${c.n}](${url})` : c.n}${p.at ? `, ${p.at}` : ''}`;
    }).join('; ')}]`;
  }))).join('');
  if (!order.size) return body;
  const list = [...order].map(([slug, c]) => `${c.n}. ${c.target?.label || slug}${c.target?.url ? ` — ${c.target.url}` : ''}`).join('\n');
  return `${body.replace(/\s+$/, '')}\n\n## ${heading}\n\n${list}\n`;
}
