// Tap to write (0.31.0): where a tap on shown text (Markdown drawn as HTML) lies in the Markdown source, so the
// editor opens with the cursor right there. Used by the note view and the notes on the canvas.
//
//   offsetAtPoint(shownEl, source, x, y) -> a position in source (0 … source.length)
//
// How: the browser tells which letter is under the finger (caretRangeFromPoint, in Python terms "the text node and
// the index in it"). The words around it are looked up in the source; if they stand there more than once, the hit
// whose place in the source is closest to the place of the tap in the shown text wins. A tap on a formula goes to
// the start of its TeX. Nothing found: the same share of the source as of the shown text.

function caretAt(x, y) {
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, off: r.startOffset } : null;
  }
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, off: p.offset } : null;
  }
  return null;
}

// the shown text without what a formula keeps for screen readers (KaTeX's hidden MathML)
function textNodes(root) {
  const out = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('.katex-mathml, .copy-btn, .code-head') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n);
  return out;
}

const closest = (hits, want) => hits.reduce((best, p) => (Math.abs(p - want) < Math.abs(best - want) ? p : best));

export function offsetAtPoint(shown, source, x, y) {
  const src = String(source || '');
  if (!src) return 0;
  const hit = caretAt(x, y);
  const nodes = textNodes(shown);
  const total = nodes.reduce((n, t) => n + t.data.length, 0) || 1;

  // a formula: the start of its TeX in the source
  const formula = hit?.node && (hit.node.nodeType === 1 ? hit.node : hit.node.parentElement)?.closest('[data-tex]');
  if (formula && shown.contains(formula)) {
    const at = src.indexOf(formula.dataset.tex);
    if (at >= 0) return at;
  }
  if (!hit || hit.node.nodeType !== 3 || !shown.contains(hit.node)) return src.length;

  let before = 0;
  for (const n of nodes) { if (n === hit.node) break; before += n.data.length; }
  const want = Math.round(((before + hit.off) / total) * src.length);
  const text = hit.node.data;
  const off = hit.off;
  // the longest piece of text around the tap first, shorter ones if formatting (**, `, links) splits it
  for (const [a, b] of [[24, 24], [10, 10], [0, 14], [14, 0], [0, 6], [6, 0]]) {
    const left = text.slice(Math.max(0, off - a), off);
    const right = text.slice(off, off + b);
    const needle = left + right;
    if (needle.trim().length < 3) continue;
    const hits = [];
    for (let i = src.indexOf(needle); i >= 0 && hits.length < 200; i = src.indexOf(needle, i + 1)) hits.push(i + left.length);
    if (hits.length) return closest(hits, want);
  }
  return Math.max(0, Math.min(src.length, want));
}
