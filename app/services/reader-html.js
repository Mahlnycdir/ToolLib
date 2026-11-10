// Reader (0.14.1): a web page -> Markdown. Readability finds the main text, Turndown writes Markdown, and formulas the
// page carries as LaTeX (KaTeX and MathJax annotations, Wikipedia's alt text, math/tex scripts) are taken over unchanged.
// Needs a DOM (DOMParser); the libraries come from vendor/reader.js when the first page is read.

let lib = null;
const load = async () => { lib = lib || (await import('../../vendor/reader.js')); return lib; };

const MATH_OPEN = '';
const MATH_CLOSE = '';

export function decodeHtml(bytes, contentType = '') {
  let charset = (contentType.match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!charset) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
    charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || head.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i) || [])[1];
  }
  try { return new TextDecoder(charset || 'utf-8').decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

const stripDisplay = (tex) => String(tex || '').trim().replace(/^\{\\(?:displaystyle|textstyle|scriptstyle)\s+([\s\S]*)\}$/, '$1').trim();

// Looks into one math element or container for LaTeX; returns { tex, display } or null.
function texOf(el) {
  const tag = el.localName;
  if (tag === 'script') {
    const type = el.getAttribute('type') || '';
    return { tex: el.textContent.trim(), display: /mode=display/.test(type) };
  }
  const ann = el.querySelector?.('annotation[encoding="application/x-tex"], annotation[encoding="application/x-latex"]') || (tag === 'annotation' ? el : null);
  if (ann) return { tex: stripDisplay(ann.textContent), display: displayOf(el) };
  const math = tag === 'math' ? el : el.querySelector?.('math[alttext]');
  if (math?.getAttribute('alttext')) return { tex: stripDisplay(math.getAttribute('alttext')), display: displayOf(el) || math.getAttribute('display') === 'block' };
  const img = el.querySelector?.('img[alt]');
  if (img && /^\{\\(?:displaystyle|textstyle)/.test(img.getAttribute('alt') || '')) return { tex: stripDisplay(img.getAttribute('alt')), display: displayOf(el) };
  return null;
}
function displayOf(el) {
  if (el.closest?.('.katex-display, .MathJax_Display, .mwe-math-mathml-display')) return true;
  if (el.querySelector?.('.mwe-math-mathml-display')) return true;
  const d = el.getAttribute?.('display') || el.querySelector?.('math[display]')?.getAttribute('display');
  return d === 'block' || d === 'true' || el.classList?.contains('katex-display') || false;
}

// Replaces every formula in the page by a marker in the text; returns the list of formulas.
function takeMath(doc) {
  const maths = [];
  const put = (el, found) => {
    if (!found?.tex) return false;
    maths.push(found);
    el.replaceWith(doc.createTextNode(`${MATH_OPEN}${maths.length - 1}${MATH_CLOSE}`));
    return true;
  };
  // rendered containers first (they hold a formula once), then bare scripts and bare <math>
  const containers = 'span.katex-display, span.katex, .mwe-math-element, span.MathJax, span.MathJax_Preview, mjx-container, .MathJax_Display, span.math, div.math';
  for (const el of doc.querySelectorAll(containers)) {
    if (!el.isConnected) continue;
    if (el.matches('.MathJax_Preview')) { el.remove(); continue; }
    const top = el.closest('.katex-display') || el;
    if (el.matches('span.katex') && el.parentElement?.closest('.katex-display')) continue;
    put(top.isConnected ? top : el, texOf(top));
  }
  for (const el of doc.querySelectorAll('script[type^="math/tex"], script[type^="math/latex"]')) put(el, texOf(el));
  for (const el of doc.querySelectorAll('math')) { if (el.isConnected) put(el, texOf(el)); }
  return maths;
}

// Text nodes with $…$, $$…$$, \(…\) and \[…\]: pages that leave the formulas to MathJax in the browser.
function takeInlineTex(doc, maths) {
  const hasEngine = !!doc.querySelector('script[src*="mathjax" i], script[src*="katex" i], script[type*="mathjax" i]') || /MathJax|renderMathInElement/.test(doc.documentElement.innerHTML.slice(0, 200000));
  const walker = doc.createTreeWalker(doc.body, 4);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$\w])\$(?!\s)([^$\n]{1,200}?)(?<!\s)\$(?![\w$])/g;
  for (const node of nodes) {
    if (node.parentElement?.closest('code, pre, script, style, textarea')) continue;
    const text = node.nodeValue;
    if (!/[$\\]/.test(text)) continue;
    let out = '';
    let last = 0;
    let any = false;
    for (const m of text.matchAll(re)) {
      const tex = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim();
      const single = m[4] != null;
      // single dollars only on pages with a math engine, and only when it looks like math
      if (single && !(hasEngine && /[\\^_={}]/.test(tex))) continue;
      maths.push({ tex, display: m[1] != null || m[2] != null });
      out += text.slice(last, m.index) + `${MATH_OPEN}${maths.length - 1}${MATH_CLOSE}`;
      last = m.index + m[0].length;
      any = true;
    }
    if (any) node.nodeValue = out + text.slice(last);
  }
}

const JUNK = 'script, style, noscript, iframe, form, button, svg, canvas, sup.reference, .mw-editsection, .noprint, .navbox, .hatnote, .mw-cite-backlink, .metadata, table.ambox, .printfooter, .catlinks, [aria-hidden="true"].icon';

export async function htmlToDoc(html, url) {
  const { Readability, TurndownService, gfm } = await load();
  const parse = () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const base = doc.createElement('base');
    base.href = url;
    doc.head.prepend(base);
    return doc;
  };
  const doc = parse();
  const siteTitle = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || '';
  const maths = takeMath(doc);
  takeInlineTex(doc, maths);
  for (const el of doc.querySelectorAll(JUNK)) el.remove();

  let article = null;
  try { article = new Readability(doc.cloneNode(true), { charThreshold: 150, keepClasses: false }).parse(); } catch { article = null; }
  let contentHtml = article?.content || '';
  let title = (article?.title || doc.title || '').trim();
  if (!article || (article.textContent || '').trim().length < 300) {
    const main = doc.querySelector('main, article, #content, #main, .content, [role="main"]') || doc.body;
    if (main && (main.textContent || '').trim().length > (article?.textContent || '').trim().length) contentHtml = main.innerHTML;
  }

  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**', linkStyle: 'inlined', hr: '---' });
  td.use(gfm);
  td.escape = (s) => s.replace(/\$/g, '＄').replace(/\*/g, '∗').replace(/`/g, "'").replace(/^(\s*)([#>+-]|\d+[.)])(\s)/, '$1​$2$3');
  td.addRule('figure', {
    filter: 'figure',
    replacement: (content, node) => {
      const cap = node.querySelector('figcaption')?.textContent.replace(/\s+/g, ' ').trim();
      return cap ? `\n\n> *${cap}*\n\n` : '\n\n';
    },
  });
  td.remove(['figcaption']);
  td.addRule('image', { filter: 'img', replacement: (c, node) => { const alt = (node.getAttribute('alt') || '').replace(/\s+/g, ' ').trim(); return alt.length > 12 && !alt.includes(MATH_OPEN) ? `*[${alt}]*` : ''; } });
  td.addRule('plainHeading', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: (content, node) => {
      const text = content.replace(/\s+/g, ' ').trim();
      if (!text) return '';
      const level = Number(node.nodeName[1]);
      if (level <= 2) return `\n\n### ${text}\n\n`;
      if (level === 3) return `\n\n#### ${text}\n\n`;
      return `\n\n**${text}**\n\n`;
    },
  });
  let md = td.turndown(contentHtml || '');

  // formulas back, as LaTeX
  md = md.replace(new RegExp(`${MATH_OPEN}(\\d+)${MATH_CLOSE}`, 'g'), (all, k) => {
    const f = maths[Number(k)];
    if (!f) return '';
    const tex = f.tex.replace(/\s*\n\s*/g, ' ').replace(/\$/g, '');
    return f.display ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
  });
  md = md.replace(/^\s*\*\*\*\s*$/gm, '---').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // the title is shown by the reader: drop it when the text starts with it
  const firstHeading = md.match(/^### (.+)\n/);
  if (firstHeading && title && firstHeading[1].trim().toLowerCase() === title.toLowerCase()) md = md.slice(firstHeading[0].length).trim();

  const warnings = [];
  const plainLength = md.replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, '').length;
  if (plainLength < 600) warnings.push('thin');
  return {
    title, byline: article?.byline || '', site: article?.siteName || siteTitle, lang: article?.lang || doc.documentElement.lang || '',
    markdown: md, abstract: '', references: [], via: 'html', warnings, stats: { formulas: maths.length, characters: md.length },
  };
}
