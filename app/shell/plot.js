// Quick plots in a page (0.17.0): a ```plot block draws functions as a picture, at once and without Python, on every
// device. One line per curve, settings with a colon:
//   y = sin(x) * exp(-x/5)        a function of x (several lines: several curves)
//   x, y = cos(t), sin(t)          a curve with a parameter t
//   x: 0 .. 4pi                    the range of x (or t: … for the parameter), y: … fixes the height
//   title: Gedämpfte Schwingung    and xlabel:, ylabel:
// Expressions: + − * / ^, brackets, 2x and 3(x+1), pi, e, sin cos tan asin acos atan sinh cosh tanh exp log ln log10
// log2 sqrt abs floor ceil sign min max pow and heaviside. No code runs: the expression is read, not evaluated as JS.
import { h } from '../services/ui.js';

// ------------------------------------------------------------------ reading an expression
const FN = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh,
  tanh: Math.tanh, exp: Math.exp, log: Math.log, ln: Math.log, log10: Math.log10, log2: Math.log2, sqrt: Math.sqrt, abs: Math.abs,
  floor: Math.floor, ceil: Math.ceil, sign: Math.sign, min: Math.min, max: Math.max, pow: Math.pow, atan2: Math.atan2,
  heaviside: (x) => (x < 0 ? 0 : x > 0 ? 1 : 0.5), sinc: (x) => (x === 0 ? 1 : Math.sin(x) / x),
};
const CONST = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);   // so "constructor" or "toString" stay unknown names

function tokens(src) {
  const out = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|([a-zA-Zα-ω_][\wα-ω]*)|(\*\*|[-+*/^(),π]))/gy;
  let m;
  let at = 0;
  while (at < src.length) {
    re.lastIndex = at;
    m = re.exec(src);
    if (!m) { if (!src.slice(at).trim()) break; throw new Error(`? ${src.slice(at, at + 8)}`); }
    at = re.lastIndex;
    if (m[1]) out.push({ k: 'num', v: parseFloat(m[1]) });
    else if (m[2]) out.push({ k: 'id', v: m[2] });
    else if (m[3] === 'π') out.push({ k: 'id', v: 'pi' });
    else out.push({ k: 'op', v: m[3] === '**' ? '^' : m[3] });
  }
  return out;
}

// expr := term (± term)* ; term := unary ((*|/|implicit) unary)* ; unary := -unary | power ; power := atom (^ unary)?
export function compile(src, vars = ['x']) {
  const tk = tokens(String(src));
  let i = 0;
  const peek = () => tk[i];
  const take = (v) => { if (tk[i]?.v === v) { i++; return true; } return false; };
  const atomStart = (x) => x && (x.k === 'num' || x.k === 'id' || x.v === '(');
  function expr() {
    let f = term();
    for (;;) {
      if (take('+')) { const a = f; const b = term(); f = (s) => a(s) + b(s); } else if (take('-')) { const a = f; const b = term(); f = (s) => a(s) - b(s); } else return f;
    }
  }
  function term() {
    let f = unary();
    for (;;) {
      if (take('*')) { const a = f; const b = unary(); f = (s) => a(s) * b(s); } else if (take('/')) { const a = f; const b = unary(); f = (s) => a(s) / b(s); } else if (atomStart(peek())) { const a = f; const b = power(); f = (s) => a(s) * b(s); } else return f;
    }
  }
  function unary() {
    if (take('-')) { const a = unary(); return (s) => -a(s); }
    if (take('+')) return unary();
    return power();
  }
  function power() {
    const base = atom();
    if (take('^')) { const ex = unary(); return (s) => base(s) ** ex(s); }
    return base;
  }
  function atom() {
    const x = tk[i++];
    if (!x) throw new Error('end');
    if (x.k === 'num') return () => x.v;
    if (x.v === '(') { const f = expr(); if (!take(')')) throw new Error(')'); return f; }
    if (x.k === 'id') {
      const k = vars.indexOf(x.v);
      if (k >= 0) return (s) => s[k];
      if (own(CONST, x.v)) return () => CONST[x.v];
      if (own(FN, x.v) && take('(')) {
        const args = [expr()];
        while (take(',')) args.push(expr());
        if (!take(')')) throw new Error(')');
        const fn = FN[x.v];
        return args.length === 1 ? (s) => fn(args[0](s)) : (s) => fn(...args.map((a) => a(s)));
      }
      throw new Error(x.v);
    }
    throw new Error(x.v);
  }
  const f = expr();
  if (i < tk.length) throw new Error(tk[i].v);
  return (...s) => f(s);
}

// ------------------------------------------------------------------ reading the block
const range = (v) => {
  const m = String(v).split(/\.\.|…|,/).map((x) => x.trim()).filter(Boolean);
  if (m.length !== 2) throw new Error('range');
  const a = compile(m[0], [])();
  const b = compile(m[1], [])();
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) throw new Error('range');
  return [Math.min(a, b), Math.max(a, b)];
};
export function parsePlot(text) {
  const spec = { curves: [], x: null, y: null, t: [0, 2 * Math.PI], title: '', xlabel: 'x', ylabel: '' };
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    let m = line.match(/^(x|y|t|title|xlabel|ylabel)\s*:\s*(.+)$/i);
    if (m) {
      const k = m[1].toLowerCase();
      if (['x', 'y', 't'].includes(k)) spec[k] = range(m[2]); else spec[k] = m[2].trim();
      continue;
    }
    m = line.match(/^x\s*,\s*y\s*=\s*(.+)$/);
    if (m) {
      const parts = splitTop(m[1]);
      if (parts.length !== 2) throw new Error('x, y');
      spec.curves.push({ kind: 'param', fx: compile(parts[0], ['t']), fy: compile(parts[1], ['t']), label: line });
      continue;
    }
    m = line.match(/^(?:y|f\(x\))\s*=\s*(.+)$/) || [null, line];
    spec.curves.push({ kind: 'fn', f: compile(m[1], ['x']), label: line });
  }
  if (!spec.curves.length) throw new Error('empty');
  if (!spec.x) spec.x = spec.curves.every((c) => c.kind === 'param') ? null : [-5, 5];
  return spec;
}
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

// ------------------------------------------------------------------ drawing
const N = 600;
function niceStep(span, n = 6) {
  const raw = span / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
const fmt = (v) => (Math.abs(v) < 1e-12 ? '0' : Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3 ? v.toExponential(1) : String(+v.toFixed(4)));

export function samples(spec) {
  return spec.curves.map((c) => {
    const pts = [];
    if (c.kind === 'fn') {
      const [a, b] = spec.x;
      for (let k = 0; k <= N; k++) { const x = a + ((b - a) * k) / N; pts.push([x, c.f(x)]); }
    } else {
      const [a, b] = spec.t;
      for (let k = 0; k <= N; k++) { const t = a + ((b - a) * k) / N; pts.push([c.fx(t), c.fy(t)]); }
    }
    return pts;
  });
}

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); return el; };

export function renderPlot(text) {
  let spec;
  try { spec = parsePlot(text); } catch (e) { return h('div', { class: 'plot-error small', text: `Plot: ${e.message}` }); }
  const data = samples(spec);
  const finite = data.flat().filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (!finite.length) return h('div', { class: 'plot-error small', text: 'Plot: –' });
  let [x0, x1] = spec.x || [Math.min(...finite.map((p) => p[0])), Math.max(...finite.map((p) => p[0]))];
  let y0;
  let y1;
  if (spec.y) [y0, y1] = spec.y;
  else {
    // robust height: leave out the far 1 % (poles of tan, 1/x)
    const ys = finite.map((p) => p[1]).sort((a, b) => a - b);
    y0 = ys[Math.floor(ys.length * 0.01)];
    y1 = ys[Math.ceil(ys.length * 0.99) - 1];
    const pad = (y1 - y0) * 0.08 || 1;
    y0 -= pad; y1 += pad;
  }
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  const W = 640; const H = 380; const L = 54; const R = 16; const T = spec.title ? 34 : 14; const B = 40;
  const sx = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'plot-svg', role: 'img', 'aria-label': spec.title || data.length + ' curves' });
  const grid = svg('g', { class: 'plot-grid' });
  const sxStep = niceStep(x1 - x0);
  const syStep = niceStep(y1 - y0, 5);
  for (let v = Math.ceil(x0 / sxStep) * sxStep; v <= x1 + 1e-9; v += sxStep) {
    grid.append(svg('line', { x1: sx(v), x2: sx(v), y1: T, y2: H - B }));
    const tx = svg('text', { x: sx(v), y: H - B + 16, 'text-anchor': 'middle', class: 'plot-tick' }); tx.textContent = fmt(v); grid.append(tx);
  }
  for (let v = Math.ceil(y0 / syStep) * syStep; v <= y1 + 1e-9; v += syStep) {
    grid.append(svg('line', { x1: L, x2: W - R, y1: sy(v), y2: sy(v) }));
    const tx = svg('text', { x: L - 6, y: sy(v) + 4, 'text-anchor': 'end', class: 'plot-tick' }); tx.textContent = fmt(v); grid.append(tx);
  }
  root.append(grid);
  const axes = svg('g', { class: 'plot-axes' });
  if (y0 < 0 && y1 > 0) axes.append(svg('line', { x1: L, x2: W - R, y1: sy(0), y2: sy(0) }));
  if (x0 < 0 && x1 > 0) axes.append(svg('line', { x1: sx(0), x2: sx(0), y1: T, y2: H - B }));
  axes.append(svg('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'none' }));
  root.append(axes);
  const clip = `plotclip${Math.random().toString(36).slice(2, 8)}`;
  const defs = svg('defs');
  const cp = svg('clipPath', { id: clip });
  cp.append(svg('rect', { x: L, y: T, width: W - L - R, height: H - T - B }));
  defs.append(cp);
  root.append(defs);
  data.forEach((pts, k) => {
    let d = '';
    let pen = false;
    const span = y1 - y0;
    let prev = null;
    for (const [x, y] of pts) {
      const ok = Number.isFinite(x) && Number.isFinite(y) && Math.abs(y - y0) < 50 * span;
      // a jump across most of the picture between two samples is a pole: lift the pen
      if (ok && prev && Math.abs(y - prev) > 2 * span) pen = false;
      if (!ok) { pen = false; prev = null; continue; }
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
      pen = true;
      prev = y;
    }
    root.append(svg('path', { d, class: `plot-line plot-c${k % 6}`, 'clip-path': `url(#${clip})` }));
  });
  if (spec.title) { const tt = svg('text', { x: W / 2, y: 20, 'text-anchor': 'middle', class: 'plot-title' }); tt.textContent = spec.title; root.append(tt); }
  if (spec.xlabel) { const tx = svg('text', { x: W - R, y: H - 6, 'text-anchor': 'end', class: 'plot-label' }); tx.textContent = spec.xlabel; root.append(tx); }
  if (spec.ylabel) { const ty = svg('text', { x: 12, y: T + 10, class: 'plot-label' }); ty.textContent = spec.ylabel; root.append(ty); }
  const legend = data.length > 1 ? h('ul', { class: 'plot-legend small' }, ...spec.curves.map((c, k) => h('li', {}, h('span', { class: `plot-key plot-c${k % 6}` }), h('code', { text: c.label })))) : null;
  return h('figure', { class: 'plot' }, root, legend);
}
