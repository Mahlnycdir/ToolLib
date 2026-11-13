// Drawing the network in 3D (0.26.0): a canvas that shows the dots, lines and planes from graph-layout.js in
// perspective and lets you move around. Used twice: the big view (net-view.js) and the small network beside every
// node (flat: true, interactive: false).
//
//   mouse / trackpad   drag the empty space to turn the picture, Shift+drag (or right button) to move it, wheel or
//                      pinch to zoom, drag a dot to put it elsewhere (within its plane), click a dot to choose it,
//                      double-click to open it, with "Link" (or Alt+drag) from one dot to another to link them
//   finger             one finger turns, two fingers zoom and move; in "Link" tap one dot, then the other
//   keys               arrows turn, + and − zoom, 0 shows everything, R looks from the front again
//
// The canvas is drawn only while something moves (the layout settles, you drag, the view glides); otherwise it
// sleeps and costs nothing. No 3D library: a few lines of trigonometry (project) are enough for a few hundred dots.
//
// For Python readers: think of a small matplotlib 3D figure that redraws itself. The camera looks at a target point
// T from distance D, turned by yaw (around the vertical axis) and pitch (up and down); project() turns world
// coordinates into pixels: rotate, then divide by depth (far things look smaller), then scale by the zoom k.
import { colourValue } from './colors.js';
import { createLayout } from '../services/graph-layout.js';
import { onThemeChange } from '../services/theme.js';

const D = 2400;                                   // distance of the camera: smaller = stronger perspective
const VIEW = { layered: { yaw: 0.5, pitch: 0.2 }, free: { yaw: 0.35, pitch: 0.3 }, flat: { yaw: 0, pitch: 0 } };

// fitOnResize: show everything again whenever the size changes (the small network beside a node)
// insetTop: pixels at the top covered by the floating bar; the picture is centred in the space below it
export function createNetCanvas({ interactive = true, flat = false, onSelect, onOpen, onLink, onSettle, label = '', fitOnResize = false, insetTop = 0 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'net-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  if (interactive) canvas.tabIndex = 0;
  const g = canvas.getContext('2d');
  const layout = createLayout({ flat });

  let nodes = new Map();   // id → { id, title, colour, r, layer, important }
  let edges = [];          // { a, b, kind, strength }
  let planes = [];         // [{ layer, label, colour }]
  let around = new Map();  // id → Set of neighbour ids (for highlighting)
  const cam = { tx: 0, ty: 0, tz: 0, k: 1, ...(flat ? VIEW.flat : VIEW.free) };
  let glide = null;        // { from, to, t0, ms } while the camera moves by itself
  let w = 300; let h = 200; let dpr = 1;
  let hover = null; let selected = null; let focus = null; let pending = null;   // pending: first dot of a link by taps
  let linkMode = false;
  let rubber = null;       // { from, x, y } while a link is being drawn
  let colours = readColours();
  let frame = 0;
  let destroyed = false;
  let settledOnce = false;
  let spin = false;        // turning slowly by itself
  let proj = new Map();    // id → [sx, sy, depth, f], filled by draw() and used for hits

  // ------------------------------------------------------------------ colours from the page (light or dark)
  function readColours() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fb) => cs.getPropertyValue(name).trim() || fb;
    const dark = document.documentElement.dataset.theme === 'dark';
    return {
      dark, ink: v('--fg', '#0f1f3d'), muted: v('--muted', '#5a6a82'), accent: v('--accent', '#1f63e0'),
      bg1: v('--net-bg1', dark ? '#141c2e' : '#fbfcff'), bg2: v('--net-bg2', dark ? '#06090f' : '#e6ecf6'),
      glass: dark ? 'rgba(18, 24, 38, 0.78)' : 'rgba(255, 255, 255, 0.82)', glassLine: dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(15, 31, 61, 0.12)',
      line: dark ? 'rgba(170, 190, 230, 0.55)' : 'rgba(70, 90, 130, 0.5)', star: dark ? '#cfe0ff' : '#6b7c99', ring: dark ? '#ffffff' : '#0f1f3d',
    };
  }
  // colour helpers for the drawing: '#rrggbb' with transparency, and two colours mixed
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const withAlpha = (hex, a) => { const [r, gg, b] = rgb(hex); return `rgba(${r}, ${gg}, ${b}, ${a})`; };
  const mix = (hex, other, t) => { const p = rgb(hex); const q = rgb(other); return `rgb(${p.map((c, i) => Math.round(c + (q[i] - c) * t)).join(', ')})`; };
  const stopTheme = onThemeChange(() => { colours = readColours(); sprites.clear(); wake(); });

  // ------------------------------------------------------------------ data
  // nodes: [{ id, title, colour, r, layer, important }], edges: [{ a, b, kind, strength, hidden }],
  // planes: [{ layer, label, colour }] (empty = free in depth). warm: how lively the layout gets.
  function setData(list, links, { warm, planes: p = [] } = {}) {
    const hadPlanes = planes.length > 0;
    planes = flat ? [] : p;
    nodes = new Map(list.map((nd) => [nd.id, nd]));
    const all = links.filter((e) => nodes.has(e.a) && nodes.has(e.b));
    edges = all.filter((e) => !e.hidden);   // hidden ones only pull (topic clouds), they are not drawn
    around = new Map(list.map((nd) => [nd.id, new Set()]));
    for (const e of edges) { around.get(e.a).add(e.b); around.get(e.b).add(e.a); }
    // big planes (many dots each) get more room between them, so the stack reads as layers in depth
    if (planes.length) layout.setGap(Math.min(480, 220 + 18 * Math.sqrt(list.length / planes.length)));
    const fresh = layout.setGraph(list.map((nd) => ({ id: nd.id, r: nd.r, layer: planes.length ? nd.layer : null })), all.map((e) => ({ a: e.a, b: e.b, strength: e.strength ?? 1 })));
    layout.heat(warm ?? (fresh > list.length / 2 ? 1 : fresh ? 0.35 : 0.08));
    if (selected && !nodes.has(selected)) selected = null;
    if (hover && !nodes.has(hover)) hover = null;
    if (!flat && hadPlanes !== planes.length > 0) Object.assign(cam, planes.length ? VIEW.layered : VIEW.free);
    settledOnce = false;
    wake();
  }

  // ------------------------------------------------------------------ camera
  // world → screen: [sx, sy, depth, f]; f is the perspective factor (bigger = nearer)
  function project(px, py, pz, c = cam) {
    const x = px - c.tx; const y = py - c.ty; const z = pz - c.tz;
    const cy = Math.cos(c.yaw); const sy = Math.sin(c.yaw); const cp = Math.cos(c.pitch); const sp = Math.sin(c.pitch);
    const x1 = x * cy + z * sy; const z1 = -x * sy + z * cy;
    const y2 = y * cp - z1 * sp; const z2 = y * sp + z1 * cp;
    const f = D / Math.max(60, D + z2);
    return [w / 2 + x1 * f * c.k, midY() + y2 * f * c.k, z2, f];
  }
  // a movement on the screen (pixels, at perspective f) → the same movement in the world
  function unproject(dx, dy, f = 1) {
    const ux = dx / (f * cam.k); const uy = dy / (f * cam.k);
    const cy = Math.cos(cam.yaw); const sy = Math.sin(cam.yaw); const cp = Math.cos(cam.pitch); const sp = Math.sin(cam.pitch);
    return [ux * cy + uy * sp * sy, uy * cp, ux * sy - uy * sp * cy];
  }
  const midY = () => (h + Math.min(insetTop, h / 3)) / 2;   // the middle of the free space below the bar
  const clampK = (k) => Math.min(5, Math.max(0.05, k));
  function glideTo(to, ms = 420) {
    glide = { from: { ...cam }, to: { ...cam, ...to, k: clampK(to.k ?? cam.k) }, t0: performance.now(), ms };
    wake();
  }
  // the target and zoom that show all dots (or only the given ones), around a centre point
  function framing(centre, ids = null, c = cam) {
    const pad = interactive ? 64 : 22;
    const probe = { ...c, tx: centre[0], ty: centre[1], tz: centre[2], k: 1 };
    let mx = 30; let my = 30;
    layout.each((id, px, py, pz) => {
      if (ids && !ids.includes(id)) return;
      const [sx, sy] = project(px, py, pz, probe);
      mx = Math.max(mx, Math.abs(sx - w / 2)); my = Math.max(my, Math.abs(sy - midY()));
    });
    return { tx: centre[0], ty: centre[1], tz: centre[2], k: clampK(Math.min((w / 2 - pad) / mx, ((h - Math.min(insetTop, h / 3)) / 2 - pad * 0.7) / my, interactive ? 1.8 : 1.4)) };
  }
  function fit(ids = null, { animate = true } = {}) {
    let x0 = Infinity; let y0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let y1 = -Infinity; let z1 = -Infinity;
    layout.each((id, px, py, pz) => {
      if (ids && !ids.includes(id)) return;
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); z0 = Math.min(z0, pz); x1 = Math.max(x1, px); y1 = Math.max(y1, py); z1 = Math.max(z1, pz);
    });
    if (!Number.isFinite(x0)) return;
    const to = framing([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], ids);
    if (animate) glideTo(to); else Object.assign(cam, to);
  }
  // the given dot in the middle, zoomed so that all others fit around it
  function fitAround(id) {
    const c = layout.pos(id);
    if (!c) return fit();
    glideTo(framing(c));
  }
  function zoomAt(f, sx = w / 2, sy = midY()) {
    // keep the point under the pointer where it is: move the target toward it while zooming
    const k0 = cam.k;
    cam.k = clampK(cam.k * f);
    const [dx, dy, dz] = unproject(sx - w / 2, sy - midY());
    const s = 1 - k0 / cam.k;
    cam.tx += dx * s * (cam.k / k0); cam.ty += dy * s * (cam.k / k0); cam.tz += dz * s * (cam.k / k0);
    glide = null;
    wake();
  }
  function turn(dyaw, dpitch) {
    if (flat) return;
    cam.yaw += dyaw;
    cam.pitch = Math.min(1.45, Math.max(-1.45, cam.pitch + dpitch));
    glide = null;
    wake();
  }

  // ------------------------------------------------------------------ the look (0.26.0, ENTE: "sehr modern")
  // Glowing dots on a soft gradient, a faint field of stars that turns with the picture, a coloured mist behind
  // every cloud of one topic, curved lines in the colours of their ends (tighter ties stronger), depth by fog:
  // far dots are smaller and paler. The layers show only as a thin dotted ring each: they form by themselves.
  const sprites = new Map();   // colour → { glow, ball } little pictures drawn once per colour and theme
  function sprite(name) {
    const key = `${name}|${colours.dark}`;
    if (sprites.has(key)) return sprites.get(key);
    const col = colourValue(name);
    const make = (paint) => { const c = document.createElement('canvas'); c.width = c.height = 64; paint(c.getContext('2d')); return c; };
    const glow = make((q) => {
      const gr = q.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, withAlpha(col, colours.dark ? 0.55 : 0.32));
      gr.addColorStop(0.4, withAlpha(col, colours.dark ? 0.2 : 0.12));
      gr.addColorStop(1, withAlpha(col, 0));
      q.fillStyle = gr; q.fillRect(0, 0, 64, 64);
    });
    const ball = make((q) => {
      const gr = q.createRadialGradient(24, 22, 2, 32, 32, 31);
      gr.addColorStop(0, mix(col, '#ffffff', colours.dark ? 0.55 : 0.45));
      gr.addColorStop(0.55, col);
      gr.addColorStop(1, mix(col, '#000000', colours.dark ? 0.1 : 0.22));
      q.fillStyle = gr; q.beginPath(); q.arc(32, 32, 31, 0, Math.PI * 2); q.fill();
    });
    const out = { glow, ball, col };
    sprites.set(key, out);
    return out;
  }
  // the field of stars: points on a far sphere, the same every time
  const rnd = (i, k) => { let v = Math.imul(i + 1, 2654435761) ^ Math.imul(k + 7, 40503); v = Math.imul(v ^ (v >>> 15), 2246822519); return ((v ^ (v >>> 13)) >>> 0) / 4294967296; };
  const STARS = Array.from({ length: 260 }, (_, i) => {
    const u = rnd(i, 1) * 2 - 1; const phi = rnd(i, 2) * Math.PI * 2; const r = Math.sqrt(1 - u * u);
    return [Math.cos(phi) * r, u, Math.sin(phi) * r, 0.3 + rnd(i, 3) * 0.7];
  });

  function draw() {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    const bg = g.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.max(w, h) * 0.8);
    bg.addColorStop(0, colours.bg1); bg.addColorStop(1, colours.bg2);
    g.fillStyle = bg; g.globalAlpha = 1;
    g.fillRect(0, 0, w, h);

    proj = new Map();
    let fMin = Infinity; let fMax = 0;
    layout.each((id, px, py, pz) => { const p = project(px, py, pz); proj.set(id, p); fMin = Math.min(fMin, p[3]); fMax = Math.max(fMax, p[3]); });
    const near = (f) => (fMax - fMin < 1e-3 ? 1 : (f - fMin) / (fMax - fMin));   // 0 = farthest, 1 = nearest
    const lit = hover || pending || selected;
    const ring = lit ? around.get(lit) || new Set() : null;
    const isLit = (id) => !lit || id === lit || ring.has(id);
    const glowMode = colours.dark ? 'lighter' : 'source-over';

    // stars (only in the big picture): turn with the camera, never move with it
    if (!flat && interactive) {
      g.fillStyle = colours.star;
      const R = Math.hypot(w, h) * 0.75;
      const cy = Math.cos(cam.yaw); const sy = Math.sin(cam.yaw); const cp = Math.cos(cam.pitch); const sp = Math.sin(cam.pitch);
      for (const [x, y, z, a] of STARS) {   // directions only: turn with the camera, no perspective
        const x1 = x * cy + z * sy; const z1 = -x * sy + z * cy;
        const y2 = y * cp - z1 * sp; const z2 = y * sp + z1 * cp;
        const px = w / 2 + x1 * R; const py = h / 2 + y2 * R;
        if (px < 0 || py < 0 || px > w || py > h) continue;
        g.globalAlpha = a * (colours.dark ? 0.5 : 0.28) * (0.55 + 0.45 * (z2 + 1) / 2);
        g.fillRect(px, py, a > 0.85 ? 1.6 : 1.1, a > 0.85 ? 1.6 : 1.1);
      }
    }

    // mist behind every cloud of one topic, in the colour most of its dots have
    const clouds = new Map();
    for (const [id, nd] of nodes) {
      if (!nd.cloud) continue;
      const pos = layout.pos(id);
      if (!pos) continue;
      if (!clouds.has(nd.cloud)) clouds.set(nd.cloud, { pts: [], colours: new Map() });
      const c = clouds.get(nd.cloud);
      c.pts.push(pos);
      c.colours.set(nd.colour, (c.colours.get(nd.colour) || 0) + 1);
    }
    g.globalCompositeOperation = glowMode;
    for (const c of clouds.values()) {
      if (c.pts.length < 4) continue;
      const cx = c.pts.reduce((s0, p) => s0 + p[0], 0) / c.pts.length; const cy = c.pts.reduce((s0, p) => s0 + p[1], 0) / c.pts.length; const cz = c.pts.reduce((s0, p) => s0 + p[2], 0) / c.pts.length;
      const spread = Math.sqrt(c.pts.reduce((s0, p) => s0 + (p[0] - cx) ** 2 + (p[1] - cy) ** 2 + (p[2] - cz) ** 2, 0) / c.pts.length);
      const [sx, sy, , f] = project(cx, cy, cz);
      const r = spread * f * cam.k * 1.35 + 26;
      const colour = [...c.colours].sort((p, q) => q[1] - p[1])[0][0];
      const col = colourValue(colour);
      const gr = g.createRadialGradient(sx, sy, 0, sx, sy, r);
      gr.addColorStop(0, withAlpha(col, (colours.dark ? 0.16 : 0.1) * (0.5 + 0.5 * near(f))));
      gr.addColorStop(1, withAlpha(col, 0));
      g.globalAlpha = lit ? 0.4 : 1;
      g.fillStyle = gr;
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';

    // the layers: one thin dotted ring each, around the dots of that layer, with a small name
    if (planes.length > 1) {
      g.font = `600 ${interactive ? 10.5 : 10}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      g.textBaseline = 'middle';
      for (const pl of planes) {
        const pts = [];
        layout.each((id, px, py, pz) => { if (nodes.get(id)?.layer === pl.layer) pts.push([px, py, pz]); });
        if (pts.length < 3) continue;
        const cx = pts.reduce((s0, p) => s0 + p[0], 0) / pts.length; const cy = pts.reduce((s0, p) => s0 + p[1], 0) / pts.length; const cz = pts.reduce((s0, p) => s0 + p[2], 0) / pts.length;
        const ds = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy)).sort((p, q) => p - q);
        const rad = ds[Math.floor(ds.length * 0.85)] + 40;
        const col = colourValue(pl.colour);
        g.globalAlpha = lit ? 0.12 : 0.32;
        g.strokeStyle = col; g.lineWidth = 1; g.setLineDash([1.5, 5]);
        g.beginPath();
        let left = null;
        for (let k = 0; k <= 64; k++) {
          const t = (k / 64) * Math.PI * 2;
          const q = project(cx + Math.cos(t) * rad, cy + Math.sin(t) * rad, cz);
          if (!left || q[0] < left[0]) left = q;
          if (k) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]);
        }
        g.stroke(); g.setLineDash([]);
        if (left && interactive) {
          g.globalAlpha = lit ? 0.25 : 0.7; g.fillStyle = col;
          g.fillText(pl.label.toUpperCase(), left[0] + 8, left[1]);
        }
      }
    }

    // lines: a slight curve, the colour running from one end to the other, tighter ties stronger
    g.lineCap = 'round';
    const many = edges.length > 700;
    for (const e of edges) {
      const a = proj.get(e.a); const b = proj.get(e.b);
      if (!a || !b) continue;
      const on = lit && (e.a === lit || e.b === lit);
      const st = e.strength ?? 1;
      const fade = 0.3 + 0.7 * near((a[3] + b[3]) / 2);
      g.globalAlpha = lit ? (on ? 0.95 : 0.04) : Math.min(0.75, 0.1 + 0.17 * st) * fade;
      const ca = colourValue(nodes.get(e.a).colour); const cb = colourValue(nodes.get(e.b).colour);
      if (many && !on) g.strokeStyle = colours.line;
      else { const gr = g.createLinearGradient(a[0], a[1], b[0], b[1]); gr.addColorStop(0, ca); gr.addColorStop(1, cb); g.strokeStyle = gr; }
      g.lineWidth = (on ? 1.9 : 0.45 + 0.42 * Math.min(st, 3)) * Math.min(1.4, Math.sqrt(cam.k * (a[3] + b[3]) / 2));
      g.setLineDash(e.kind === 'cite' || e.kind === 'convention' ? [1.5, 4] : []);
      const mx = (a[0] + b[0]) / 2; const my = (a[1] + b[1]) / 2;
      const bend = (hashSign(e.a, e.b) * 0.08);
      const cx = mx - (b[1] - a[1]) * bend; const cy = my + (b[0] - a[0]) * bend;
      g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo(cx, cy, b[0], b[1]); g.stroke();
      if (e.kind === 'derived' && (on || cam.k > 0.8)) { g.strokeStyle = cb; arrow([cx, cy], a, radius(nodes.get(e.a), a[3]), ca); }   // from what it follows from to the result
    }
    g.setLineDash([]);
    if (rubber) {
      const a = proj.get(rubber.from);
      g.globalAlpha = 0.95; g.strokeStyle = colours.accent; g.lineWidth = 2; g.setLineDash([6, 5]);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(rubber.x, rubber.y); g.stroke(); g.setLineDash([]);
    }

    // dots, the farthest first: a glow, then a little sphere
    const order = [...nodes.keys()].filter((id) => proj.has(id)).sort((a, b) => proj.get(b)[2] - proj.get(a)[2]);
    for (const id of order) {
      const nd = nodes.get(id); const p = proj.get(id);
      if (p[0] < -60 || p[1] < -60 || p[0] > w + 60 || p[1] > h + 60) continue;
      const r = radius(nd, p[3]);
      const sp = sprite(nd.colour);
      const depthA = 0.3 + 0.7 * near(p[3]);
      const dim = isLit(id) ? 1 : 0.14;
      const strong = id === focus || id === selected || id === hover || id === pending;
      g.globalCompositeOperation = glowMode;
      g.globalAlpha = dim * depthA * (strong ? 1 : 0.85);
      const gs = r * (strong ? 7 : 4.6);
      g.drawImage(sp.glow, p[0] - gs / 2, p[1] - gs / 2, gs, gs);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = dim * (0.45 + 0.55 * depthA);
      g.drawImage(sp.ball, p[0] - r, p[1] - r, r * 2, r * 2);
      if (strong) {
        g.globalAlpha = 1;
        g.strokeStyle = id === pending ? colours.accent : colours.ring;
        g.lineWidth = 1.6;
        if (id === pending) g.setLineDash([3, 3]);
        g.beginPath(); g.arc(p[0], p[1], r + 4, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
        if (id === focus) { g.globalAlpha = 0.35; g.beginPath(); g.arc(p[0], p[1], r + 9, 0, Math.PI * 2); g.stroke(); }
      }
    }

    // names in small glass pills: the important and near ones first, none on top of another
    g.font = `500 ${interactive ? 12 : 11}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.textBaseline = 'middle';
    const want = [];
    for (const [id, nd] of nodes) {
      const p = proj.get(id);
      if (!p) continue;
      let score = 0;
      if (id === hover) score = 100; else if (id === selected || id === pending) score = 90; else if (id === focus) score = 80;
      else if (ring?.has(id)) score = 50;
      else if (!lit) score = (nd.important ? 30 : 0) + Math.min(20, nd.r) + (cam.k * p[3] > 1.1 ? 15 : 0) + 10 * near(p[3]);
      if (score >= (interactive ? (nodes.size > 140 && cam.k < 0.6 ? 38 : 18) : 30)) want.push([score, id]);
    }
    want.sort((p, q) => q[0] - p[0]);
    const boxes = [];
    let count = 0;
    for (const [score, id] of want) {
      if (count >= (interactive ? Math.min(60, Math.round((w * h) / 12000)) : 8)) break;   // fewer names on a small screen
      const nd = nodes.get(id); const p = proj.get(id);
      const r = radius(nd, p[3]);
      let text = nd.title.length > 42 ? `${nd.title.slice(0, 40)}…` : nd.title;
      const right = w - (p[0] + r + 22); const left = p[0] - r - 22;
      const onRight = g.measureText(text).width <= right || right >= left;
      text = shorten(text, Math.max(0, onRight ? right : left));
      if (!text) continue;
      const tw = g.measureText(text).width;
      const px0 = onRight ? p[0] + r + 6 : p[0] - r - 6 - tw - 14;
      const box = [px0, p[1] - 10, px0 + tw + 14, p[1] + 10];
      if (boxes.some((bb) => box[0] < bb[2] && box[2] > bb[0] && box[1] < bb[3] && box[3] > bb[1])) continue;
      boxes.push(box);
      count++;
      const a = (isLit(id) ? 1 : 0.35) * (0.6 + 0.4 * near(p[3]));
      g.globalAlpha = a * (score >= 80 ? 0.96 : 0.82);
      g.fillStyle = colours.glass;
      roundRect(box[0], box[1], box[2] - box[0], box[3] - box[1], 10); g.fill();
      g.globalAlpha = a * 0.6; g.strokeStyle = colours.glassLine; g.lineWidth = 1; g.stroke();
      g.globalAlpha = a;
      g.fillStyle = colours.ink;
      g.fillText(text, box[0] + 7, p[1] + 0.5);
    }
    g.globalAlpha = 1;
  }
  function roundRect(x0, y0, ww, hh, r) {
    g.beginPath();
    g.moveTo(x0 + r, y0); g.arcTo(x0 + ww, y0, x0 + ww, y0 + hh, r); g.arcTo(x0 + ww, y0 + hh, x0, y0 + hh, r);
    g.arcTo(x0, y0 + hh, x0, y0, r); g.arcTo(x0, y0, x0 + ww, y0, r); g.closePath();
  }
  const hashSign = (a, b) => ((a.length * 31 + b.length * 17 + a.charCodeAt(0) + b.charCodeAt(b.length - 1)) % 2 ? 1 : -1);
  // a name cut with … so that it is at most `room` pixels wide ('' when not even a few letters fit)
  function shorten(text, room) {
    if (g.measureText(text).width <= room) return text;
    let lo = 0; let hi = text.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (g.measureText(`${text.slice(0, mid)}…`).width <= room) lo = mid; else hi = mid - 1; }
    return lo >= 4 ? `${text.slice(0, lo).trimEnd()}…` : '';
  }
  const radius = (nd, f = 1) => Math.max(2.4, Math.min(22, nd.r * f * Math.sqrt(cam.k)));
  function arrow(from, to, r, fill) {
    const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const tx = to[0] - Math.cos(ang) * (r + 3); const ty = to[1] - Math.sin(ang) * (r + 3);
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(tx, ty);
    g.lineTo(tx - Math.cos(ang - 0.42) * 7, ty - Math.sin(ang - 0.42) * 7);
    g.lineTo(tx - Math.cos(ang + 0.42) * 7, ty - Math.sin(ang + 0.42) * 7);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  }

  // ------------------------------------------------------------------ the loop: runs only while something moves
  function tick(now) {
    frame = 0;
    if (destroyed) return;
    let busy = false;
    if (layout.alpha > 0) {
      // as many steps as fit into ~10 ms of this frame, so even many dots settle within a second or two
      const t0 = performance.now();
      do layout.step(); while (layout.alpha > 0 && performance.now() - t0 < 10);
      busy = layout.alpha > 0;
      if (!busy && !settledOnce) { settledOnce = true; onSettle?.(layout.keep()); }
    }
    if (glide) {
      const t = Math.min(1, (now - glide.t0) / glide.ms);
      const e = 1 - (1 - t) ** 3;
      for (const key of ['tx', 'ty', 'tz', 'k', 'yaw', 'pitch']) cam[key] = glide.from[key] + (glide.to[key] - glide.from[key]) * e;
      if (t >= 1) glide = null; else busy = true;
    }
    if (spin && !drag && !document.hidden) { cam.yaw += 0.0022; busy = true; }
    draw();
    if (busy || drag) frame = requestAnimationFrame(tick);
  }
  function wake() { if (!frame && !destroyed) frame = requestAnimationFrame(tick); }

  // ------------------------------------------------------------------ size
  function resize() {
    const r = canvas.getBoundingClientRect();
    w = Math.max(50, r.width); h = Math.max(50, r.height);
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    if (fitOnResize) fit(null, { animate: false });
    wake();
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);

  // ------------------------------------------------------------------ finding a dot under the pointer (the nearest)
  function hit(sx, sy) {
    let best = null; let bestF = -1;
    for (const [id, p] of proj) {
      const nd = nodes.get(id);
      if (!nd) continue;
      if (Math.hypot(p[0] - sx, p[1] - sy) < radius(nd, p[3]) + (interactive ? 7 : 4) && p[3] > bestF) { best = id; bestF = p[3]; }
    }
    return best;
  }
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  // ------------------------------------------------------------------ pointer: tap, drag a dot, turn, move, pinch, link
  const pointers = new Map();
  let drag = null;   // { mode: 'turn' | 'pan' | 'node' | 'link' | 'pinch', … }
  if (interactive) {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      const [sx, sy] = local(e);
      pointers.set(e.pointerId, [sx, sy]);
      glide = null;
      if (pointers.size === 2) {
        const [[ax, ay], [bx, by]] = [...pointers.values()];
        drag = { mode: 'pinch', d0: Math.hypot(ax - bx, ay - by), k0: cam.k, mid: [(ax + bx) / 2, (ay + by) / 2] };
        rubber = null;
        return;
      }
      const id = hit(sx, sy);
      const panning = e.shiftKey || e.button === 2 || flat;
      if (id && (linkMode || e.altKey)) drag = { mode: 'link', id, sx, sy, moved: false };
      else if (id && e.button === 0) drag = { mode: 'node', id, sx, sy, lx: sx, ly: sy, moved: false };
      else drag = { mode: panning ? 'pan' : 'turn', sx, sy, lx: sx, ly: sy, moved: false };
      wake();
    });
    canvas.addEventListener('pointermove', (e) => {
      const [sx, sy] = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [sx, sy]);
      if (!drag) {
        if (e.pointerType !== 'mouse') return;
        const id = hit(sx, sy);
        canvas.style.cursor = id ? (linkMode || e.altKey ? 'crosshair' : 'pointer') : e.shiftKey || flat ? 'move' : 'grab';
        if (id !== hover) { hover = id; wake(); }
        return;
      }
      if (drag.mode === 'pinch' && pointers.size === 2) {
        const [[ax, ay], [bx, by]] = [...pointers.values()];
        const mid = [(ax + bx) / 2, (ay + by) / 2];
        cam.k = clampK(drag.k0 * (Math.hypot(ax - bx, ay - by) / Math.max(1, drag.d0)));
        const [dx, dy, dz] = unproject(mid[0] - drag.mid[0], mid[1] - drag.mid[1]);   // two fingers also move
        cam.tx -= dx; cam.ty -= dy; cam.tz -= dz;
        drag.mid = mid;
        wake();
        return;
      }
      if (!drag.moved && Math.hypot(sx - drag.sx, sy - drag.sy) < (e.pointerType === 'mouse' ? 4 : 9)) return;
      drag.moved = true;
      const ddx = sx - drag.lx; const ddy = sy - drag.ly;
      drag.lx = sx; drag.ly = sy;
      if (drag.mode === 'turn') { turn(ddx * 0.008, ddy * 0.008); canvas.style.cursor = 'grabbing'; }
      else if (drag.mode === 'pan') { const [dx, dy, dz] = unproject(ddx, ddy); cam.tx -= dx; cam.ty -= dy; cam.tz -= dz; }
      else if (drag.mode === 'node') {
        const p = layout.pos(drag.id); const f = proj.get(drag.id)?.[3] || 1;
        const [dx, dy, dz] = unproject(ddx, ddy, f);
        layout.move(drag.id, p[0] + dx, p[1] + dy, p[2] + dz);
        layout.fix(drag.id, true);
        layout.heat(0.25);
        hover = drag.id;
      } else if (drag.mode === 'link') {
        rubber = { from: drag.id, x: sx, y: sy };
        hover = hit(sx, sy) || drag.id;
      }
      wake();
    });
    const end = (e) => {
      const [sx, sy] = local(e);
      pointers.delete(e.pointerId);
      const d = drag;
      if (!d) return;
      if (d.mode === 'pinch') { if (!pointers.size) drag = null; return; }
      drag = null;
      canvas.style.cursor = '';
      if (d.mode === 'link') {
        rubber = null;
        const to = hit(sx, sy);
        if (d.moved && to && to !== d.id) onLink?.(d.id, to);
        else if (!d.moved) tapLink(d.id);
      } else if (!d.moved && d.mode === 'node') {
        if (linkMode) tapLink(d.id);
        else { selected = d.id; onSelect?.(d.id); }
      } else if (!d.moved && (d.mode === 'turn' || d.mode === 'pan')) {
        pending = null;
        if (selected) { selected = null; onSelect?.(null); }
      } else if (d.mode === 'node' && d.moved) {
        settledOnce = false;   // the dragged dot stays where you put it; it is kept when the layout is still again
      }
      wake();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); drag = null; rubber = null; wake(); });
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !drag && hover) { hover = null; wake(); } });
    canvas.addEventListener('dblclick', (e) => { const id = hit(...local(e)); if (id) onOpen?.(id); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [sx, sy] = local(e);
      // a pinch on the trackpad comes as wheel with Ctrl; a mouse wheel in steps zooms; two fingers on the trackpad
      // move the picture, with Shift they turn it
      const wheelSteps = e.deltaMode === 1 || (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50 && e.deltaX === 0);
      if (e.ctrlKey || e.metaKey || wheelSteps) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), sx, sy);
      else if (e.shiftKey && !flat) turn(e.deltaX * 0.004, e.deltaY * 0.004);
      else { const [dx, dy, dz] = unproject(-e.deltaX, -e.deltaY); cam.tx -= dx; cam.ty -= dy; cam.tz -= dz; glide = null; wake(); }
    }, { passive: false });
    canvas.addEventListener('keydown', (e) => {
      const keys = { '+': () => zoomAt(1.25), '=': () => zoomAt(1.25), '-': () => zoomAt(0.8), _: () => zoomAt(0.8), 0: () => fit(), r: () => resetView(), R: () => resetView(),
        ArrowLeft: () => turn(-0.12, 0), ArrowRight: () => turn(0.12, 0), ArrowUp: () => turn(0, -0.1), ArrowDown: () => turn(0, 0.1),
        Escape: () => { pending = null; wake(); } };
      if (keys[e.key] && !e.altKey && !e.metaKey && !e.ctrlKey) { keys[e.key](); e.preventDefault(); }
    });
  } else {
    canvas.style.cursor = 'pointer';
  }

  // in link mode: the first tap chooses, the second links
  function tapLink(id) {
    if (pending && pending !== id) { const a = pending; pending = null; onLink?.(a, id); }
    else pending = pending === id ? null : id;
    wake();
  }
  // looks from the front again (the starting angle), everything in view
  function resetView() {
    const view = flat ? VIEW.flat : planes.length ? VIEW.layered : VIEW.free;
    const to = framing([cam.tx, cam.ty, cam.tz], null, { ...cam, ...view });
    glideTo({ ...view, ...to });
  }

  return {
    el: canvas,
    layout,
    setData,
    fit,
    fitAround,
    resetView,
    zoomBy: (f) => zoomAt(f),
    turn,
    // the dot with a ring (focus) and the one chosen (selected)
    setFocus(id) { focus = id; wake(); },
    select(id) { selected = id; wake(); },
    setLinkMode(on) { linkMode = !!on; pending = null; wake(); },
    // turn slowly by itself (stops while you drag; costs a little power, so it is off at first)
    setSpin(on) { spin = !!on && !flat; wake(); },
    get spin() { return spin; },
    get linkMode() { return linkMode; },
    get pending() { return pending; },
    get camera() { return { ...cam }; },
    // where a dot is drawn right now (for tests)
    screenOf(id) { const p = proj.get(id); return p ? { x: p[0], y: p[1], f: p[3] } : null; },
    resize,
    redraw: wake,
    destroy() { destroyed = true; ro?.disconnect(); stopTheme(); if (frame) cancelAnimationFrame(frame); },
  };
}
