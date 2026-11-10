// Reader (0.14.1): the text of a PDF -> Markdown, with pdf.js (vendor/pdfjs, loaded when the first PDF is read).
// Text only: pdf.js gives words with positions; this file puts them in reading order (two columns), joins lines to
// paragraphs, undoes hyphenation, drops running heads and page numbers, finds headings by size and numbering, and
// cuts the reference list. Formulas in a PDF are only glyphs: they come out as plain, often garbled characters.
// (For arXiv papers the reader takes the LaTeX source instead.)

let pdfjs = null;
async function lib() {
  if (!pdfjs) {
    pdfjs = await import('../../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

const MAX_PAGES = 700;

// ------------------------------------------------------------------ one page -> lines
// Words in rows of equal height (a row may still reach across both columns of a page).
function pageRows(content) {
  const items = [];
  for (const it of content.items) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, , d, x, y] = it.transform;
    const size = Math.hypot(a, b) || Math.abs(d) || it.height || 10;
    if (Math.abs(b) > 0.5 * Math.abs(a) && Math.abs(b) > 1) continue;   // rotated text (arXiv's stamp at the margin)
    items.push({ str: it.str, x, y, w: it.width || it.str.length * size * 0.5, size, font: it.fontName || '' });
  }
  items.sort((p, q) => q.y - p.y || p.x - q.x);
  const rows = [];
  for (const it of items) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) <= 0.5 * Math.max(last.size, it.size) && (it.size >= last.size * 0.7 || last.size >= it.size * 0.7)) {
      last.items.push(it);
      last.y = (last.y * (last.items.length - 1) + it.y) / last.items.length;
      last.size = Math.max(last.size, it.size);
    } else rows.push({ y: it.y, size: it.size, items: [it] });
  }
  return rows;
}

// Two columns: a vertical strip in the middle that (almost) no word crosses, with words on both sides of it.
function findGutter(rows, width) {
  if (rows.length < 12) return null;
  let best = null;
  for (let x = width * 0.36; x <= width * 0.64; x += 1.5) {
    let cross = 0;
    let both = 0;
    for (const r of rows) {
      const hit = r.items.some((i) => i.x < x - 1 && i.x + i.w > x + 1);
      if (hit) cross++;
      else if (r.items.some((i) => i.x + i.w <= x + 1) && r.items.some((i) => i.x >= x - 1)) both++;
    }
    if (!best || cross < best.cross || (cross === best.cross && both > best.both)) best = { x, cross, both };
  }
  if (!best) return null;
  return best.both >= Math.max(6, rows.length * 0.25) && best.cross <= rows.length * 0.12 ? best.x : null;
}

function lineFrom(items) {
  const size = Math.max(...items.map((i) => i.size));
  items.sort((p, q) => p.x - q.x);
  let text = '';
  let prevEnd = null;
  for (const it of items) {
    if (prevEnd != null) {
      const gap = it.x - prevEnd;
      if (gap > 0.17 * size && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      else if (gap < -0.2 * size && !text.endsWith(' ')) text += ' ';
    }
    text += it.str;
    prevEnd = it.x + it.w;
  }
  text = text.replace(/\s+/g, ' ').trim();
  const font = items.reduce((m, i) => (i.str.length > (m.len || 0) ? { name: i.font, len: i.str.length } : m), {}).name;
  return { y: items.reduce((s, i) => s + i.y, 0) / items.length, size, text, x0: items[0].x, x1: Math.max(...items.map((i) => i.x + i.w)), font, chars: text.length };
}

// Lines in reading order: for two columns first the left one, then the right one; lines across both (title, wide
// formulas) keep their place and end the columns above them.
function pageLines(content, viewport) {
  const rows = pageRows(content);
  const gx = findGutter(rows, viewport.width);
  const lines = [];
  for (const r of rows) {
    if (gx == null) { lines.push(lineFrom(r.items)); continue; }
    const crosses = r.items.some((i) => i.x < gx - 1 && i.x + i.w > gx + 1);
    if (crosses) { const l = lineFrom(r.items); l.col = -1; lines.push(l); continue; }
    const left = r.items.filter((i) => i.x + i.w <= gx + 1);
    const right = r.items.filter((i) => i.x >= gx - 1);
    // a row with words in both halves but nothing crossing: two lines, unless it is one line of a wide text with a gap
    for (const [part, col] of [[left, 0], [right, 1]]) if (part.length) { const l = lineFrom(part); l.col = col; lines.push(l); }
  }
  const kept = lines.filter((l) => l.text);
  if (gx == null) return { lines: kept, columns: 1 };
  const out = [];
  let l = [];
  let r = [];
  const flush = () => { out.push(...l, ...r); l = []; r = []; };
  for (const line of kept) {
    if (line.col === -1) { flush(); out.push(line); } else if (line.col === 0) l.push(line); else r.push(line);
  }
  flush();
  return { lines: out, columns: 2 };
}

// ------------------------------------------------------------------ the whole document
const norm = (s) => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();

export async function pdfToDoc(bytes, { onProgress, signal, maxPages = MAX_PAGES } = {}) {
  const pdf = await lib();
  const task = pdf.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0, stopAtErrors: false });
  signal?.addEventListener('abort', () => task.destroy(), { once: true });
  const doc = await task.promise;
  const total = doc.numPages;
  const pages = [];
  const limit = Math.min(total, maxPages);
  let meta = {};
  try { meta = (await doc.getMetadata()).info || {}; } catch { /* no metadata */ }
  for (let n = 1; n <= limit; n++) {
    if (signal?.aborted) { await task.destroy(); throw Object.assign(new Error('aborted'), { code: 'aborted' }); }
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const ordered = pageLines(content, viewport);
    pages.push({ n, height: viewport.height, width: viewport.width, ...ordered });
    page.cleanup();
    onProgress?.(n, total);
    if (n % 5 === 0) await new Promise((r) => setTimeout(r, 0));   // let the page breathe
  }
  await task.destroy();

  const chars = pages.reduce((s, p) => s + p.lines.reduce((t, l) => t + l.chars, 0), 0);
  const warnings = [];
  if (chars < 200 * Math.min(total, 3)) warnings.push('no-text');
  if (total > limit) warnings.push('truncated');

  // body size: the size most characters have
  const bySize = new Map();
  for (const p of pages) for (const l of p.lines) { const k = Math.round(l.size * 2) / 2; bySize.set(k, (bySize.get(k) || 0) + l.chars); }
  const body = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  const byFont = new Map();
  for (const p of pages) for (const l of p.lines) if (Math.abs(l.size - body) < 0.6) byFont.set(l.font, (byFont.get(l.font) || 0) + l.chars);
  const bodyFont = [...byFont.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // running heads and page numbers: the same text (digits aside) at the top or bottom of many pages
  const edge = new Map();
  for (const p of pages) {
    const sorted = [...p.lines].sort((a, b) => b.y - a.y);
    const near = [...sorted.slice(0, 2), ...sorted.slice(-2)];
    p.near = new Set(near);
    for (const l of p.near) edge.set(norm(l.text), (edge.get(norm(l.text)) || 0) + 1);
  }
  const repeated = new Set([...edge.entries()].filter(([k, c]) => c >= Math.max(3, pages.length * 0.4) && k.length < 140).map(([k]) => k));
  const isNoise = (l, p) => {
    const edgeZone = p.near.has(l);   // one of the two top or bottom lines of the page
    return (edgeZone && (/^\s*[\divxlc]{1,5}\s*$/i.test(l.text) || repeated.has(norm(l.text)))) || /^arXiv:\d{4}\.\d{4,5}(v\d+)?\s+\[[^\]]+\]/.test(l.text);
  };

  const blocks = [];   // { kind: 'h' | 'p', level, text }
  let para = null;
  const endPara = () => { if (para) { blocks.push({ kind: 'p', text: para.text.trim() }); para = null; } };
  let titleSize = 0;      // the title: the first heading; what is bigger than the text but smaller (authors, date) before the first section is no heading
  let sectioned = false;
  const headingOf = (l) => {
    const t = l.text;
    if (t.length > 110 || t.length < 3) return 0;
    const bigger = l.size >= body * 1.18;
    const numbered = t.match(/^(\d+(?:\.\d+){0,2}|[A-Z](?:\.\d+)*|[IVX]+)\.?\s+[A-Z(]/);
    const boldish = l.font !== bodyFont && Math.abs(l.size - body) < 0.8;
    const named = /^(abstract|references|bibliography|acknowledg\w+|conclusions?|introduction|appendix\b.*|literatur\w*)\.?$/i.test(t);
    if (numbered && (boldish || bigger) && !/[,;]$/.test(t)) { sectioned = true; return (numbered[1].match(/\./g) || []).length >= 1 && /^\d/.test(numbered[1]) ? 4 : 3; }
    if (named && (boldish || bigger || /^[A-Z]/.test(t))) { sectioned = true; return 3; }
    if (bigger && !/[.,;]$/.test(t)) {
      if (!sectioned && titleSize && l.size < titleSize * 0.9) return 0;
      if (!titleSize) titleSize = l.size;
      else sectioned = true;
      return /^(\d+\.\d+|\d+\.\d+\.\d+)/.test(t) ? 4 : 3;
    }
    return 0;
  };

  for (const p of pages) {
    let prev = null;
    for (const l of p.lines) {
      if (isNoise(l, p)) continue;
      const level = headingOf(l);
      if (level) {
        endPara();
        const last = blocks[blocks.length - 1];
        if (last && last.kind === 'h' && last.level === level && last.merge && Math.abs(last.size - l.size) < 0.6) { last.text += ` ${l.text}`; } else blocks.push({ kind: 'h', level, text: l.text, merge: l.size >= body * 1.18, size: l.size });
        prev = l;
        continue;
      }
      const lineH = body * 1.25;
      const gap = prev && prev.col === l.col ? prev.y - l.y : 0;
      const indent = prev && prev.col === l.col ? l.x0 - prev.x0 : 0;
      const shortPrev = prev && para && prev.x1 - prev.x0 < (p.columns === 2 ? p.width * 0.4 : p.width * 0.55) && /[.!?:]$/.test(prev.text);
      const newPara = !para || gap > lineH * 1.45 || shortPrev || (indent > body * 0.8 && prev && /[.!?:]$/.test(prev.text));
      if (newPara) {
        endPara();
        para = { text: l.text };
      } else if (/[A-Za-z]-$/.test(para.text) && /^[a-z]/.test(l.text)) para.text = para.text.slice(0, -1) + l.text;
      else para.text += ` ${l.text}`;
      prev = l;
    }
    // a paragraph may continue on the next page or column: it stays open
  }
  endPara();

  // references: after a "References" heading
  const refAt = blocks.findIndex((b) => b.kind === 'h' && /^(references|bibliography|literatur\w*|citations)$/i.test(b.text.replace(/^[\dA-Z.]+\s+/, '')));
  let references = [];
  let mainBlocks = blocks;
  if (refAt >= 0 && refAt > blocks.length * 0.3) {
    mainBlocks = blocks.slice(0, refAt);
    const joined = blocks.slice(refAt + 1).filter((b) => b.kind === 'p').map((b) => b.text).join(' ');
    const split = joined.split(/\s(?=\[\d{1,3}\]\s)/).map((s) => s.trim()).filter(Boolean);
    references = /^\[1\]\s/.test(joined) && split.length >= 2 ? split : blocks.slice(refAt + 1).filter((b) => b.kind === 'p').map((b, k) => `[${k + 1}] ${b.text}`);
    if (blocks.slice(refAt + 1).some((b) => b.kind === 'h' && /^(appendix|supplement)/i.test(b.text))) {
      const next = blocks.findIndex((b, i) => i > refAt && b.kind === 'h' && /^(appendix|supplement)/i.test(b.text));
      mainBlocks = [...blocks.slice(0, refAt), ...blocks.slice(next)];
    }
  }

  const md = mainBlocks.map((b) => (b.kind === 'h' ? `${'#'.repeat(b.level)} ${b.text}` : b.text)).filter(Boolean).join('\n\n')
    .replace(/\$/g, '＄').replace(/\*/g, '∗').replace(/`/g, "'")
    .replace(/\n{3,}/g, '\n\n');
  const firstHeading = mainBlocks.find((b) => b.kind === 'h');
  return {
    title: String(meta.Title || '').trim() || (firstHeading && firstHeading.level === 3 ? firstHeading.text : ''),
    markdown: md, abstract: '', references, via: 'pdf', warnings,
    stats: { pages: total, read: limit, characters: md.length, columns: pages.some((p) => p.columns === 2) ? 2 : 1 },
  };
}
