// Reader (0.14.1): highlights in the displayed text. A highlight is stored as the marked words (the quote); here the
// quote is found again in the page and wrapped in <mark class="rd-hl">. Formulas count as one unit and read as their
// LaTeX ($…$ or $$…$$), taken from data-tex, so a quote with a formula survives KaTeX loading late.

const BLOCK = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'DIV', 'TR', 'TD', 'TH', 'PRE', 'UL', 'OL', 'TABLE', 'SECTION', 'HR']);
const SKIP = '.copy-btn, .code-head, script, style, button';

const atomText = (el) => (el.dataset.display ? `$$${el.dataset.tex}$$` : `$${el.dataset.tex}$`);

// The text of root as a list of pieces (text nodes, formulas, separators) and the whole string.
export function buildIndex(root) {
  const segs = [];
  let full = '';
  const sep = () => { if (full && !full.endsWith(' ')) { segs.push({ type: 'sep', start: full.length, end: full.length + 1 }); full += ' '; } };
  const walk = (node) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        const text = c.nodeValue;
        segs.push({ type: 'text', node: c, start: full.length, end: full.length + text.length });
        full += text;
      } else if (c.nodeType === 1) {
        if (c.matches(SKIP)) continue;
        if (c.dataset?.tex != null) {
          const text = atomText(c);
          segs.push({ type: 'atom', el: c, start: full.length, end: full.length + text.length });
          full += text;
          continue;
        }
        const block = BLOCK.has(c.nodeName);
        if (block) sep();
        walk(c);
        if (block) sep();
      }
    }
  };
  walk(root);
  return { segs, full };
}

// Whitespace runs become one space; map[i] is the position in the original for position i of the result.
function normalize(s) {
  let out = '';
  const map = [];
  let space = true;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      if (!space) { out += ' '; map.push(i); space = true; }
    } else { out += ch; map.push(i); space = false; }
  }
  if (out.endsWith(' ')) { out = out.slice(0, -1); map.pop(); }
  return { out, map };
}
export const normalizeQuote = (q) => normalize(String(q)).out;

// [start, end) of the quote in index.full, or null.
export function findQuote(index, quote) {
  const q = normalizeQuote(quote);
  if (!q) return null;
  const n = normalize(index.full);
  const at = n.out.indexOf(q);
  if (at < 0) return null;
  const start = n.map[at];
  const end = n.map[at + q.length - 1] + 1;
  return { start, end };
}

// Wraps [start, end) in marks made by make(); returns the marks.
export function wrapRange(index, start, end, make) {
  const marks = [];
  for (const seg of index.segs) {
    if (seg.type === 'sep' || seg.end <= start || seg.start >= end) continue;
    if (seg.type === 'atom') {
      const m = make();
      m.classList.add('rd-hl-atom');
      seg.el.parentNode.insertBefore(m, seg.el);
      m.append(seg.el);
      marks.push(m);
      continue;
    }
    const from = Math.max(start, seg.start) - seg.start;
    const to = Math.min(end, seg.end) - seg.start;
    if (to <= from || !seg.node.nodeValue.slice(from, to).trim()) continue;
    let mid = seg.node;
    if (from > 0) mid = mid.splitText(from);
    if (to - from < mid.nodeValue.length) mid.splitText(to - from);
    const m = make();
    mid.parentNode.insertBefore(m, mid);
    m.append(mid);
    marks.push(m);
  }
  return marks;
}

export function unwrap(marks) {
  const parents = new Set();
  for (const m of marks) {
    if (!m.parentNode) continue;
    parents.add(m.parentNode);
    m.replaceWith(...m.childNodes);
  }
  for (const p of parents) p.normalize();
}

// The selection inside root: { text, section, range } or null. Formulas touched are taken whole.
export function selectionQuote(root) {
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.commonAncestorContainer)) return null;
  const range = r.cloneRange();
  const atomOf = (n) => (n.nodeType === 1 ? n : n.parentElement)?.closest('[data-tex]');
  const a = atomOf(range.startContainer);
  const b = atomOf(range.endContainer);
  if (a && root.contains(a)) range.setStartBefore(a);
  if (b && root.contains(b)) range.setEndAfter(b);
  const frag = range.cloneContents();
  for (const el of frag.querySelectorAll('[data-tex]')) el.replaceWith(document.createTextNode(` ${atomText(el)} `));
  for (const el of frag.querySelectorAll(SKIP)) el.remove();
  for (const el of frag.querySelectorAll('p, li, h3, h4, blockquote, tr, pre')) el.append(document.createTextNode(' '));
  const text = frag.textContent.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  let section = '';
  for (const head of root.querySelectorAll('h3, h4')) {
    if (head.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING || head.contains(range.startContainer)) section = head.textContent.trim();
    else break;
  }
  return { text, section, range };
}
