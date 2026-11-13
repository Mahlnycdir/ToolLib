// Layout of the network (0.26.0): where each dot stands, in three dimensions. Pure arithmetic, no page, so it can
// be tested alone.
//
// It is the classic "force-directed" layout, as in Obsidian's graph or networkx.spring_layout(dim=3):
//   - every pair of dots pushes apart (like charges),
//   - every connection pulls its two ends together (like a spring of a certain length); how hard depends on its
//     tension: the more two nodes belong together in substance, the stiffer and shorter the spring,
//   - a weak pull toward the middle keeps loose groups from drifting away.
// Each step moves every dot a little along the sum of its forces; the steps get smaller ("cooling", alpha) until
// nothing moves any more. Then the layout stops and costs nothing.
//
// Layers in depth (ENTE, 13.11.: "3D mit Ebenen in der Tiefe", "die Ebenen sollen sich natürlich erschließen"):
// a dot with a `layer` number is pulled gently toward the depth of its layer (layer × gap), like a spring in z.
// It is not nailed there: connections pull too, so the layers form by themselves as loose strata, thicker where
// much hangs together. Dots without a layer move freely in all three directions. Dots in different strata push
// each other less (they are farther apart), so every stratum forms its own clouds.
//
// Calm on purpose (ENTE, 13.11.: "visuell ruhig"):
//   - Start positions come from the name of a node (a hash), never from chance, so the same knowledge gives the
//     same picture every time. Positions are kept (keep()/restore()), so a node stays where you know it.
//   - A new node starts next to the nodes it is connected to, and the rest only settles gently (low alpha).
//
// For Python readers: positions are plain numbers in Float64Arrays (like numpy arrays x, y, z); `n` is the number
// of dots. The double loop in step() is the O(n²) part, fine for a few hundred dots.

// A number from 0 to 1 from a text, always the same for the same text (FNV-1a hash).
export function hash01(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h / 4294967296;
}

export const DEFAULTS = {
  repel: 4200,       // how strongly dots push apart
  spring: 0.06,      // how strongly a connection pulls
  length: 70,        // the length a connection likes to have (at tension 1)
  gravity: 0.005,    // pull toward the middle (weak, so clouds can lie apart)
  damping: 0.55,     // how much speed is kept from one step to the next
  far: 900,          // dots farther apart than this do not push any more (saves time, keeps groups apart calmly)
  gap: 260,          // distance between two layers
  layerPull: 0.07,   // how strongly a dot is pulled toward the depth of its layer
  minAlpha: 0.004,   // below this the layout counts as settled
  flat: false,       // true: everything on one plane (the small network beside a node)
};

export function createLayout(options = {}) {
  const o = { ...DEFAULTS, ...options };
  let ids = [];
  let index = new Map();
  let x = new Float64Array(0); let y = new Float64Array(0); let z = new Float64Array(0);
  let vx = new Float64Array(0); let vy = new Float64Array(0); let vz = new Float64Array(0);
  let size = new Float64Array(0);   // radius of each dot; bigger dots push a bit more
  let fixed = new Uint8Array(0);    // 1 = does not move (dragged and let go)
  let layer = new Float64Array(0);  // NaN = free in depth, else the number of its plane
  let springs = [];                 // [i, j, strength]
  let alpha = 1;
  let layers = 0;                   // how many planes
  const remembered = new Map();     // id → [x, y, z], positions kept from earlier (restore)

  const zOfLayer = (l) => (o.flat ? 0 : (l - (layers - 1) / 2) * o.gap);

  // nodes: [{ id, r, layer }], edges: [{ a, b, strength }]. Dots that were there keep their place; new ones start
  // next to their neighbours, or at a place from their name. Returns how many dots are new.
  function setGraph(nodes, edges) {
    const old = { index, x, y, z, vx, vy, vz, fixed };
    ids = nodes.map((nd) => nd.id);
    index = new Map(ids.map((id, i) => [id, i]));
    const n = ids.length;
    x = new Float64Array(n); y = new Float64Array(n); z = new Float64Array(n);
    vx = new Float64Array(n); vy = new Float64Array(n); vz = new Float64Array(n);
    size = new Float64Array(n); fixed = new Uint8Array(n); layer = new Float64Array(n);
    layers = 1 + nodes.reduce((m, nd) => Math.max(m, Number.isFinite(nd.layer) ? nd.layer : 0), 0);
    springs = [];
    for (const e of edges) {
      const i = index.get(e.a); const j = index.get(e.b);
      if (i === undefined || j === undefined || i === j) continue;
      springs.push([i, j, e.strength ?? 1]);
    }
    const placed = new Uint8Array(n);
    nodes.forEach((nd, i) => {
      size[i] = nd.r || 6;
      layer[i] = o.flat ? 0 : Number.isFinite(nd.layer) ? nd.layer : NaN;
      const k = old.index.get(nd.id);
      if (k !== undefined) {
        x[i] = old.x[k]; y[i] = old.y[k]; z[i] = old.z[k];
        vx[i] = old.vx[k] * 0.3; vy[i] = old.vy[k] * 0.3; vz[i] = old.vz[k] * 0.3; fixed[i] = old.fixed[k];
        placed[i] = 1;
      } else if (remembered.has(nd.id)) {
        [x[i], y[i], z[i]] = remembered.get(nd.id);
        placed[i] = 1;
      }
      if (!Number.isNaN(layer[i]) && k === undefined && !remembered.has(nd.id)) z[i] = zOfLayer(layer[i]) + (hash01(`${nd.id}#z`) - 0.5) * o.gap * 0.3;
    });
    let fresh = 0;
    // new dots: next to the average of their placed neighbours (a few rounds, so chains grow outward)
    const neighbours = Array.from({ length: n }, () => []);
    for (const [i, j] of springs) { neighbours[i].push(j); neighbours[j].push(i); }
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < n; i++) {
        if (placed[i]) continue;
        const near = neighbours[i].filter((j) => placed[j]);
        if (!near.length && round < 3) continue;
        const angle = hash01(ids[i]) * Math.PI * 2;
        const lift = (hash01(`${ids[i]}#z`) - 0.5) * 2;
        if (near.length) {
          const cx = near.reduce((s, j) => s + x[j], 0) / near.length;
          const cy = near.reduce((s, j) => s + y[j], 0) / near.length;
          const cz = near.reduce((s, j) => s + z[j], 0) / near.length;
          x[i] = cx + Math.cos(angle) * o.length * 0.8;
          y[i] = cy + Math.sin(angle) * o.length * 0.8;
          z[i] = cz + lift * o.length * 0.6;
        } else {
          // no placed neighbour at all: a place on a wide spiral, from the name
          const r = o.length * (2 + 6 * hash01(`${ids[i]}#r`)) * Math.sqrt(1 + n / 60);
          x[i] = Math.cos(angle) * r;
          y[i] = Math.sin(angle) * r;
          z[i] = lift * r * 0.5;
        }
        if (!Number.isNaN(layer[i])) z[i] = zOfLayer(layer[i]) + lift * o.gap * 0.15;
        placed[i] = 2;
        fresh++;
      }
    }
    if (o.flat) z.fill(0);
    return fresh;
  }

  // One step of the simulation; returns the current alpha (0 = settled).
  function step() {
    const n = ids.length;
    if (!n || alpha < o.minAlpha) { alpha = 0; return 0; }
    const fx = new Float64Array(n); const fy = new Float64Array(n); const fz = new Float64Array(n);
    const far2 = o.far * o.far;
    // every pair pushes apart: force ~ repel / distance²
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = x[i] - x[j]; let dy = y[i] - y[j]; const dz = z[i] - z[j];
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > far2) continue;
        if (d2 < 0.01) { dx = hash01(ids[i]) - 0.5; dy = hash01(ids[j]) - 0.5; d2 = 0.5; }   // on top of each other
        const f = (o.repel * (1 + (size[i] + size[j]) / 24)) / d2;
        const d = Math.sqrt(d2);
        fx[i] += (dx / d) * f; fy[i] += (dy / d) * f; fz[i] += (dz / d) * f;
        fx[j] -= (dx / d) * f; fy[j] -= (dy / d) * f; fz[j] -= (dz / d) * f;
      }
    }
    // tension (ENTE, 13.11.): a strong connection is stiffer and shorter, so closely related knowledge pulls together
    // into clouds; a weak one (a convention, a project) is long and loose and lets the clouds lie apart. Between two
    // layers the depth part counts only a little: the layers set the depth, the line pulls the dots one behind the other.
    for (const [i, j, s] of springs) {
      const dx = x[j] - x[i]; const dy = y[j] - y[i]; const dz = z[j] - z[i];
      const across = !Number.isNaN(layer[i]) && !Number.isNaN(layer[j]) && layer[i] !== layer[j];
      const dzw = across ? dz * 0.15 : dz;
      const d = Math.sqrt(dx * dx + dy * dy + dzw * dzw) || 0.01;
      const want = (across ? 0.4 : 1) * o.length * Math.min(2.2, Math.max(0.45, 1 / Math.sqrt(s))) + size[i] + size[j];
      const f = o.spring * Math.min(s, 3) * (d - want);
      fx[i] += (dx / d) * f; fy[i] += (dy / d) * f; fz[i] += (dzw / d) * f;
      fx[j] -= (dx / d) * f; fy[j] -= (dy / d) * f; fz[j] -= (dzw / d) * f;
    }
    // move, a little less each step
    let moved = 0;
    for (let i = 0; i < n; i++) {
      if (fixed[i]) { vx[i] = 0; vy[i] = 0; vz[i] = 0; continue; }
      fx[i] -= x[i] * o.gravity; fy[i] -= y[i] * o.gravity;
      // toward the depth of its layer (a soft spring), or toward the middle when it has none
      fz[i] += Number.isNaN(layer[i]) ? -z[i] * o.gravity : (zOfLayer(layer[i]) - z[i]) * o.layerPull;
      vx[i] = (vx[i] + fx[i] * alpha) * o.damping;
      vy[i] = (vy[i] + fy[i] * alpha) * o.damping;
      vz[i] = o.flat ? 0 : (vz[i] + fz[i] * alpha) * o.damping;
      const v = Math.hypot(vx[i], vy[i], vz[i]);
      if (v > 40) { vx[i] *= 40 / v; vy[i] *= 40 / v; vz[i] *= 40 / v; }   // no jumps
      x[i] += vx[i]; y[i] += vy[i]; z[i] += vz[i];
      moved += Math.abs(vx[i]) + Math.abs(vy[i]) + Math.abs(vz[i]);
    }
    alpha *= 0.985;
    if (moved / n < 0.02) alpha *= 0.8;   // nothing moves any more: finish sooner
    return alpha;
  }

  return {
    setGraph,
    step,
    // runs up to `ticks` steps at once (for small pictures that need no animation)
    run(ticks = 300) { for (let k = 0; k < ticks && alpha > 0; k++) step(); return alpha; },
    // how lively the layout is: 1 = like new, 0.15 = settle gently
    heat(a) { alpha = Math.max(alpha, a); },
    get alpha() { return alpha; },
    get size() { return ids.length; },
    get layers() { return layers; },
    zOfLayer,
    // the distance between layers (bigger layers need more room in depth)
    setGap(v) { if (Number.isFinite(v) && v > 0) o.gap = v; },
    has: (id) => index.has(id),
    layerOf(id) { const i = index.get(id); return i === undefined || Number.isNaN(layer[i]) ? null : layer[i]; },
    pos(id) { const i = index.get(id); return i === undefined ? null : [x[i], y[i], z[i]]; },
    // moves a dot (its layer pulls it back toward its depth a little)
    move(id, px, py, pz) {
      const i = index.get(id);
      if (i === undefined) return;
      x[i] = px; y[i] = py;
      if (!o.flat && Number.isFinite(pz)) z[i] = pz;
      vx[i] = 0; vy[i] = 0; vz[i] = 0;
    },
    fix(id, on = true) { const i = index.get(id); if (i !== undefined) fixed[i] = on ? 1 : 0; },
    isFixed(id) { const i = index.get(id); return i !== undefined && fixed[i] === 1; },
    // all positions, for drawing: calls fn(id, x, y, z) for each dot
    each(fn) { for (let i = 0; i < ids.length; i++) fn(ids[i], x[i], y[i], z[i]); },
    // positions to keep for later ({ id: [x, y, z] }, rounded) and to give back
    keep() { const out = {}; for (let i = 0; i < ids.length; i++) out[ids[i]] = [Math.round(x[i]), Math.round(y[i]), Math.round(z[i])]; return out; },
    restore(saved) {
      remembered.clear();
      for (const [id, p] of Object.entries(saved || {})) {
        if (Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite)) remembered.set(id, [p[0], p[1], p[2] ?? 0]);
      }
    },
  };
}
