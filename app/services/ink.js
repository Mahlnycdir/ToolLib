// Tinte (0.21.0): Geometrie und Format der Striche aus der Kladde, damit jedes Werkzeug Tinte lesen und zeigen kann.
// Aus Kladde.html übernommen (Glättung, Ramer-Douglas-Peucker, Begradigen, Bézier-Pfade, Papier), nur in ein Modul
// gelegt. Die Seite hat ihr eigenes Maß: 1000 Einheiten breit ≙ 210 mm (A4), ein Kästchen 25 Einheiten ≈ 5 mm.
//
// Format einer .ink-Datei: eine Kopfzeile, dann ein Strich pro Zeile (so zeigt Git nur geänderte Striche):
//   kladde-ink 1
//   i,26,1203,4410,12,-3,15,0,…      Farbe (i b r g), Stärke ×10, dann Punkte als Differenzen in Zehntel-Einheiten
export const PAGE_W = 1000;
export const SHEET_H = 1414;       // A4-Höhe in Einheiten
export const MM = 0.21;            // Millimeter pro Einheit
export const GRID = 25;            // Kästchen ≈ 5 mm
export const MARGIN = 40;          // linker Rand für „neue Zeile“
export const INK_HEAD = 'kladde-ink 1';
export const MAX_INK = 4 * 1024 * 1024;   // größer liest Toollib keine .ink-Datei

export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

export function bboxOf(p, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i], y = p[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}
export const hit = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

export function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 > 1e-12 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  const ex = ax + t * dx - px, ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

export function makeStroke(pts, w, c) { return { pts, w, c, b: bboxOf(pts, w), path: null }; }

export function hitStroke(s, px, py, r) {
  const b = s.b;
  if (px < b.x0 - r || px > b.x1 + r || py < b.y0 - r || py > b.y1 + r) return false;
  const rr = r + s.w / 2, rr2 = rr * rr, p = s.pts;
  if (p.length === 2) { const dx = px - p[0], dy = py - p[1]; return dx * dx + dy * dy <= rr2; }
  for (let i = 0; i + 3 < p.length; i += 2) if (segDist2(px, py, p[i], p[i + 1], p[i + 2], p[i + 3]) <= rr2) return true;
  return false;
}

// Ramer–Douglas–Peucker: wirft fast kollineare Punkte weg (spart Speicher, Form bleibt)
export function simplify(p, tol) {
  const n = p.length / 2;
  if (n < 3) return p;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]], tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(p[2 * i], p[2 * i + 1], p[2 * a], p[2 * a + 1], p[2 * b], p[2 * b + 1]);
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]);
  return out;
}

export function roughlyStraight(p, tol) {
  const n = p.length;
  if (n < 4) return false;
  const ax = p[0], ay = p[1], bx = p[n - 2], by = p[n - 1];
  const chord = Math.hypot(bx - ax, by - ay);
  if (!chord) return false;
  let len = 0, dev = 0;
  for (let i = 2; i < n; i += 2) {
    len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    dev = Math.max(dev, Math.sqrt(segDist2(p[i], p[i + 1], ax, ay, bx, by)));
  }
  return dev <= tol + 0.08 * chord && len <= 1.25 * chord;
}

// fast waagerecht → exakt waagerecht (Bruchstrich), fast senkrecht → exakt senkrecht
export function snapAngle(ax, ay, bx, by) {
  const ang = Math.atan2(Math.abs(by - ay), Math.abs(bx - ax)), tol = 8 * Math.PI / 180;
  if (ang < tol) return [bx, ay];
  if (ang > Math.PI / 2 - tol) return [ax, by];
  return [bx, by];
}

// Quadratische Bézier-Stücke von Mittelpunkt zu Mittelpunkt → weich, ohne Ecken
export function tracePath(c, p) {
  const n = p.length / 2;
  c.moveTo(p[0], p[1]);
  if (n <= 2) { c.lineTo(p[p.length - 2], p[p.length - 1]); return; }
  for (let i = 1; i < n - 1; i++) {
    const x = p[2 * i], y = p[2 * i + 1];
    c.quadraticCurveTo(x, y, (x + p[2 * i + 2]) / 2, (y + p[2 * i + 3]) / 2);
  }
  c.lineTo(p[2 * n - 2], p[2 * n - 1]);
}

export function drawStroke(c, s, inks, minW = 0, isLive = false) {
  const w = Math.max(s.w, minW || 0), col = inks[s.c] || inks.ink;
  if (s.pts.length === 2) {
    c.fillStyle = col; c.beginPath(); c.arc(s.pts[0], s.pts[1], w * 0.65, 0, Math.PI * 2); c.fill();
    return;
  }
  c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round';
  if (isLive || typeof Path2D === 'undefined') { c.beginPath(); tracePath(c, s.pts); c.stroke(); return; }
  if (!s.path) { s.path = new Path2D(); tracePath(s.path, s.pts); }
  c.stroke(s.path);
}

export function drawPaper(c, style, vis, pageH, hair, P) {
  const x0 = Math.max(0, vis.x0), x1 = Math.min(PAGE_W, vis.x1);
  const y0 = Math.max(0, vis.y0), y1 = Math.min(pageH, vis.y1);
  if (x1 <= x0 || y1 <= y0) return;
  c.fillStyle = P.paper; c.fillRect(x0, y0, x1 - x0, y1 - y0);
  if (style === 'blank') return;
  if (style === 'dots') {
    const r = Math.max(hair * 1.4, 0.9);
    c.fillStyle = P.dot; c.beginPath();
    for (let y = Math.ceil(y0 / GRID) * GRID; y <= y1; y += GRID)
      for (let x = Math.ceil(x0 / GRID) * GRID; x <= x1; x += GRID) { c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2); }
    c.fill();
    return;
  }
  const gy = style === 'lines' ? GRID * 1.6 : GRID;
  c.strokeStyle = P.rule; c.lineWidth = hair; c.beginPath();
  if (style === 'grid') for (let x = Math.ceil(x0 / GRID) * GRID; x <= x1; x += GRID) { c.moveTo(x, y0); c.lineTo(x, y1); }
  for (let y = Math.ceil(y0 / gy) * gy; y <= y1; y += gy) { c.moveTo(x0, y); c.lineTo(x1, y); }
  c.stroke();
}

export function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export function contentTop(strokes) { let t = Infinity; for (const s of strokes) if (s.b.y0 < t) t = s.b.y0; return t; }
export function contentBottom(strokes) { let b = 0; for (const s of strokes) if (s.b.y1 > b) b = s.b.y1; return b; }
export function sheetCount(strokes) { return Math.max(1, Math.ceil(contentBottom(strokes) / SHEET_H)); }
export function inkBox(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) { x0 = Math.min(x0, s.b.x0); y0 = Math.min(y0, s.b.y0); x1 = Math.max(x1, s.b.x1); y1 = Math.max(y1, s.b.y1); }
  return x1 > x0 ? { x0, y0, x1, y1 } : null;
}

// ───────── Speicherformat: Delta-kodiert, 1/10 Einheit Auflösung ─────────
const CODE = { ink: 'i', blue: 'b', red: 'r', green: 'g' }, DECODE = { i: 'ink', b: 'blue', r: 'red', g: 'green' };
export const INKS = ['ink', 'blue', 'red', 'green'];

function encodeStroke(s) {
  const out = [CODE[s.c] || 'i', Math.round(s.w * 10)];
  let px = 0, py = 0;
  for (let i = 0; i < s.pts.length; i += 2) {
    const x = Math.round(s.pts[i] * 10), y = Math.round(s.pts[i + 1] * 10);
    out.push(x - px, y - py); px = x; py = y;
  }
  return out.join(',');
}

// Für die Datei: Kopfzeile, ein Strich pro Zeile.
export function encodeInk(strokes) { return `${INK_HEAD}\n${strokes.map(encodeStroke).join('\n')}${strokes.length ? '\n' : ''}`; }

// Liest das Dateiformat und auch das alte der Kladde (Striche mit „;“ getrennt).
export function decodeInk(str) {
  if (!str || typeof str !== 'string' || str.length > MAX_INK) return [];
  const list = [];
  for (const part of str.split(/[;\n]/)) {
    if (!part || part.startsWith('kladde-ink')) continue;
    const a = part.split(',');
    if (a.length < 4 || !(a[0] in DECODE)) continue;
    const pts = [];
    let x = 0, y = 0, bad = false;
    for (let i = 2; i + 1 < a.length; i += 2) {
      const dx = +a[i], dy = +a[i + 1];
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) { bad = true; break; }
      x += dx; y += dy; pts.push(x / 10, y / 10);
    }
    if (bad || !pts.length) continue;
    const w = clamp((+a[1]) / 10 || 2.6, 0.5, 20);
    list.push(makeStroke(pts, w, DECODE[a[0]] || 'ink'));
  }
  return list;
}

// Ein kleines Vorschaubild (data:-URL) der beschriebenen Fläche, für Listen und Karten.
export function thumbnail(strokes, { w = 156, h = 112, color = '#15171b', bg = null } = {}) {
  const box = inkBox(strokes);
  if (!box || typeof document === 'undefined') return '';
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  if (bg) { c.fillStyle = bg; c.fillRect(0, 0, w, h); }
  const bw = Math.max(box.x1 - box.x0, GRID * 4), bh = Math.max(box.y1 - box.y0, GRID * 3);
  const s = Math.min((w - 8) / bw, (h - 8) / bh);
  c.setTransform(s, 0, 0, s, 4 - box.x0 * s, 4 - box.y0 * s);
  const inks = { ink: color, blue: color, red: color, green: color };
  for (const st of strokes) drawStroke(c, st, inks, 1.4 / s);
  try { return cv.toDataURL('image/png'); } catch { return ''; }
}
