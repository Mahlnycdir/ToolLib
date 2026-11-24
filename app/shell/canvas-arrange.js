// Ordering the canvas of a project (0.34.0, ENTE's list of 17.11.): the arithmetic behind three things you do on the
// canvas (project-canvas.js draws and saves, this file only moves boxes):
//
//   frames     where the frame of each group (section) lies: around its cards and subgroups, with room for the name
//              above, and what you gave it yourself. The same for drawing, dropping and saving (frameRects).
//   tidy       "Ausrichten": the cards of a group in a neat grid without overlap, its subgroups below them; with a red
//              thread the cards come in its order (reading order: left to right, then down). For all groups: every
//              group tidied, then the groups in rows side by side, again in the order of the thread.
//   resize     "Gruppe größer ziehen": a group gets the size you pull it to, even where cards are in the way. Making it
//              smaller pushes its own cards inside; making it larger pushes the groups beside it out of the way (to the
//              right or down, and those push the next ones). When its cards overlap after pulling, they are tidied
//              to the new width.
//
// For Python readers: the state is two dicts, `cards` slug → {x, y, w, h} and `frames` section id → {x, y, w, h}
// (frames you set yourself); `board` is the list of sections with their cards (projects.js boardOf). Every function
// changes the boxes in place, like numpy arrays handed to a function. A snapshot keeps the boxes so a drag can start
// again from them on every move, and Undo can put them back.

export const PAD = 22;          // room inside a frame at the sides and below
export const HEAD = 40;         // room for the name above the cards
export const GAP = 24;          // between cards, and between a group's cards and its subgroups
export const GROUP_GAP = 60;    // between groups side by side
export const CARD_W = 230;
const CARD_H = 110;

export const depthIn = (board, id) => { let d = 0; let s = board.find((x) => x.id === id); while (s?.parent && d < 4) { d += 1; s = board.find((x) => x.id === s.parent); } return d; };
export function treeOf(board, id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const s of board) if ((s.parent || '') === out[i] && !out.includes(s.id)) out.push(s.id);
  return out;
}
const sizeOf = (b) => ({ w: b.w || CARD_W, h: b.h || CARD_H });
export const overlaps = (a, b, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

// The frame of every section: { id → { id, x, y, w, h, sec, depth } }. skip: a card left out (the one you drag);
// without: sections left out (a group you carry, so its old parent does not grow around it).
export function frameRects(board, cards, frames, { skip = '', without = null } = {}) {
  const out = new Map();
  const order = [...board].sort((a, b) => depthIn(board, b.id) - depthIn(board, a.id));
  for (const sec of order) {
    if (without?.has(sec.id)) continue;
    const boxes = sec.items.filter((d) => d.slug !== skip).map((d) => cards.get(d.slug)).filter(Boolean).map((b) => ({ x: b.x, y: b.y, ...sizeOf(b) }));
    for (const c of board) if (c.parent === sec.id && out.has(c.id)) boxes.push(out.get(c.id));
    const own = frames.get(sec.id);
    if (!boxes.length && !own) continue;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const b of boxes) {
      x0 = Math.min(x0, b.x - PAD); y0 = Math.min(y0, b.y - HEAD); x1 = Math.max(x1, b.x + b.w + PAD); y1 = Math.max(y1, b.y + b.h + PAD);
    }
    if (own) { x0 = Math.min(x0, own.x); y0 = Math.min(y0, own.y); x1 = Math.max(x1, own.x + own.w); y1 = Math.max(y1, own.y + own.h); }
    out.set(sec.id, { id: sec.id, x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0), sec, depth: depthIn(board, sec.id) });
  }
  return out;
}

// ---------------------------------------------------------------- snapshots (for a drag and for Undo)
export function snapshot(cards, frames) {
  return { cards: new Map([...cards].map(([k, b]) => [k, { ...b }])), frames: new Map([...frames].map(([k, f]) => [k, { ...f }])) };
}
export function restore(snap, cards, frames) {
  for (const [k, b] of snap.cards) { const now = cards.get(k); if (now) Object.assign(now, b); else cards.set(k, { ...b }); }
  frames.clear();
  for (const [k, f] of snap.frames) frames.set(k, { ...f });
}

// ctx: everything the functions below need, built once per action
export function arrangeCtx(board, cards, frames, thread = []) {
  const at = new Map(thread.map((s, i) => [s, i]));
  return { board, cards, frames, rank: (slug) => (at.has(slug) ? at.get(slug) : Infinity), before: frameRects(board, cards, frames), hadFrame: new Set(frames.keys()) };
}
// moves a section with its subgroups, their cards and the frames you set
export function shiftTree(ctx, id, dx, dy) {
  if (!dx && !dy) return;
  for (const t of treeOf(ctx.board, id)) {
    for (const d of ctx.board.find((s) => s.id === t)?.items || []) { const b = ctx.cards.get(d.slug); if (b) { b.x = Math.round(b.x + dx); b.y = Math.round(b.y + dy); } }
    const f = ctx.frames.get(t);
    if (f) ctx.frames.set(t, { ...f, x: Math.round(f.x + dx), y: Math.round(f.y + dy) });
  }
}
// the place of a section (or of the first card of its tree) in the red thread; Infinity when none is in it
function treeRank(ctx, id) {
  let best = Infinity;
  for (const t of treeOf(ctx.board, id)) for (const d of ctx.board.find((s) => s.id === t)?.items || []) best = Math.min(best, ctx.rank(d.slug));
  return best;
}
const hasCards = (ctx, id) => treeOf(ctx.board, id).some((t) => (ctx.board.find((s) => s.id === t)?.items || []).some((d) => ctx.cards.has(d.slug)));

// ---------------------------------------------------------------- tidy
// Lays out one section with its frame's top left corner at (ox, oy): its cards in a grid (in the order of the red
// thread, then where they lay: top to bottom, left to right), its subgroups below them. width: the frame's width to
// keep (a group you pulled to a size), else the grid finds its own (about twice as high as wide).
// Returns the size of the frame { w, h } (0 × 0 for a group with nothing in it).
export function layoutSection(ctx, id, ox, oy, width = null) {
  const { board, cards, frames } = ctx;
  const sec = board.find((s) => s.id === id);
  if (!sec) return { w: 0, h: 0 };
  const pos = (s) => cards.get(s);
  const own = sec.items.map((d) => d.slug).filter((s) => cards.has(s));
  own.sort((a, b) => ctx.rank(a) - ctx.rank(b) || pos(a).y - pos(b).y || pos(a).x - pos(b).x);
  const kids = board.filter((s) => (s.parent || '') === id && (hasCards(ctx, s.id) || ctx.hadFrame.has(s.id)));
  const was = (k) => ctx.before.get(k.id) || { x: 0, y: 0 };
  kids.sort((a, b) => treeRank(ctx, a.id) - treeRank(ctx, b.id) || was(a).y - was(b).y || was(a).x - was(b).x);
  const maxW = Math.max(CARD_W, ...own.map((s) => sizeOf(pos(s)).w));
  let cols = width ? Math.floor((width - 2 * PAD + GAP) / (maxW + GAP)) : Math.ceil(Math.sqrt(own.length / 2));
  cols = Math.max(1, Math.min(cols, own.length || 1));
  const colW = Array(cols).fill(0); const rowH = [];
  own.forEach((s, i) => { const { w, h } = sizeOf(pos(s)); colW[i % cols] = Math.max(colW[i % cols], w); rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)] || 0, h); });
  const colX = []; let x = ox + PAD;
  for (let c = 0; c < cols; c++) { colX.push(x); x += colW[c] + GAP; }
  const rowY = []; let y = oy + HEAD;
  for (const rh of rowH) { rowY.push(y); y += rh + GAP; }
  own.forEach((s, i) => { const b = pos(s); b.x = Math.round(colX[i % cols]); b.y = Math.round(rowY[Math.floor(i / cols)]); });
  const cardsW = own.length ? colW.reduce((a, b) => a + b, 0) + GAP * (cols - 1) : 0;
  const cardsH = own.length ? rowH.reduce((a, b) => a + b, 0) + GAP * (rowH.length - 1) : 0;
  const top = oy + HEAD + (own.length ? cardsH + GAP : 0);
  let cy = top; let kidsW = 0;
  for (const k of kids) {
    const blk = layoutSection(ctx, k.id, ox + PAD, cy, width ? width - 2 * PAD : null);
    if (!blk.w) continue;
    kidsW = Math.max(kidsW, blk.w);
    cy += blk.h + GAP;
  }
  frames.delete(id);
  if (!own.length && cy === top) {
    // an empty group keeps a small frame where it is, so you can still drop cards into it
    if (!ctx.hadFrame.has(id)) return { w: 0, h: 0 };
    const f = { x: ox, y: oy, w: Math.max(width || 0, 260), h: 140 };
    frames.set(id, f);
    return { w: f.w, h: f.h };
  }
  const bottom = cy > top ? cy - GAP : oy + HEAD + cardsH;
  return { w: Math.max(cardsW, kidsW) + 2 * PAD, h: bottom - oy + PAD };
}

// "Ausrichten" for one group: neat where it is; groups it now covers step aside
export function tidyOne(ctx, id) {
  const r = ctx.before.get(id);
  if (!r) return;
  layoutSection(ctx, id, r.x, r.y);
  pushOthers(ctx, id, r);
}

// "Ausrichten" for all: every top group tidied, then the groups in rows (in the order of the red thread, then
// left to right as they lay), starting where the canvas began
export function tidyAll(ctx) {
  const tops = ctx.board.filter((s) => !s.parent && (hasCards(ctx, s.id) || ctx.hadFrame.has(s.id)));
  if (!tops.length) return;
  const was = (s) => ctx.before.get(s.id) || { x: 0, y: 0 };
  tops.sort((a, b) => treeRank(ctx, a.id) - treeRank(ctx, b.id) || was(a).x - was(b).x || was(a).y - was(b).y);
  const known = [...ctx.before.values()];
  const x0 = known.length ? Math.min(...known.map((r) => r.x)) : 0;
  const y0 = known.length ? Math.min(...known.map((r) => r.y)) : 0;
  const blocks = tops.map((s) => ({ id: s.id, ...layoutSection(ctx, s.id, 0, 0) })).filter((b) => b.w);
  // rows about 1.6 times as wide as the whole is high, never narrower than three average groups
  const area = blocks.reduce((a, b) => a + (b.w + GROUP_GAP) * (b.h + GROUP_GAP), 0);
  const avgW = blocks.reduce((a, b) => a + b.w, 0) / Math.max(1, blocks.length);
  const rowMax = Math.max(Math.sqrt(area * 1.6), 3 * avgW + 2 * GROUP_GAP);
  let x = x0; let y = y0; let rowH = 0;
  for (const b of blocks) {
    if (x > x0 && x + b.w > x0 + rowMax) { x = x0; y += rowH + GROUP_GAP; rowH = 0; }
    shiftTree(ctx, b.id, x, y);
    x += b.w + GROUP_GAP;
    rowH = Math.max(rowH, b.h);
  }
}

// ---------------------------------------------------------------- push aside
// The group `id` got a new place or size (it lay at `old` before): the groups beside it that it now covers move out of
// its way, to the right when they lay to its right, down when they lay below, else the shorter way; a group pushed
// that way pushes the next. A subgroup pushes its siblings; its parent grows and pushes its own neighbours.
export function pushOthers(ctx, id, old) {
  let level = id;
  let was = old;
  for (let up = 0; up < 4 && level; up++) {
    const sec = ctx.board.find((s) => s.id === level);
    if (!sec) return;
    const now = frameRects(ctx.board, ctx.cards, ctx.frames);
    const mine = now.get(level);
    if (mine) {
      const sibs = ctx.board.filter((s) => (s.parent || '') === (sec.parent || '') && s.id !== level);
      const queue = [{ rect: mine, old: was || mine }];
      for (let guard = 0; queue.length && guard < 200; guard++) {
        const { rect, old: o } = queue.shift();
        const cur = frameRects(ctx.board, ctx.cards, ctx.frames);
        for (const s of sibs) {
          const q = cur.get(s.id);
          if (!q || q === rect || s.id === rect.id || !overlaps(rect, q, GAP / 2 - 1)) continue;
          const right = q.x >= o.x + o.w - 1; const below = q.y >= o.y + o.h - 1;
          const dx = rect.x + rect.w + GAP - q.x; const dy = rect.y + rect.h + GAP - q.y;
          let mx = 0; let my = 0;
          if (right && !below) mx = dx; else if (below && !right) my = dy; else if (dx <= dy) mx = dx; else my = dy;
          shiftTree(ctx, s.id, mx, my);
          queue.push({ rect: { ...q, x: q.x + mx, y: q.y + my }, old: q });
        }
      }
    }
    level = sec.parent || '';
    was = level ? ctx.before.get(level) : null;
  }
}

// ---------------------------------------------------------------- resize
// The smallest size a group can be pulled to: its widest card and its tallest card fit, with the room of every
// level of subgroups around them.
export function minSize(ctx, id) {
  const tree = treeOf(ctx.board, id);
  const levels = Math.max(...tree.map((t) => depthIn(ctx.board, t))) - depthIn(ctx.board, id);
  const slugs = tree.flatMap((t) => (ctx.board.find((s) => s.id === t)?.items || []).map((d) => d.slug)).filter((s) => ctx.cards.has(s));
  const w = Math.max(CARD_W, ...slugs.map((s) => sizeOf(ctx.cards.get(s)).w));
  const h = Math.max(CARD_H, ...slugs.map((s) => sizeOf(ctx.cards.get(s)).h));
  return { w: Math.max(180, w + 2 * PAD * (levels + 1)), h: Math.max(120, h + HEAD * (levels + 1) + PAD * (levels + 1)) };
}
// The group `id` (at `old` when you took its corner) gets the size w × h: its cards (and subgroups' cards) are pushed
// inside, neighbours out of the way. Called on every move with the boxes as they were at the start (snapshot).
export function resizeGroup(ctx, id, w, h, old) {
  const min = minSize(ctx, id);
  const R = { x: old.x, y: old.y, w: Math.max(min.w, Math.round(w)), h: Math.max(min.h, Math.round(h)) };
  const base = depthIn(ctx.board, id);
  for (const t of treeOf(ctx.board, id)) {
    const k = depthIn(ctx.board, t) - base + 1;   // levels of frames around the cards of t
    const pad = PAD * k; const head = HEAD * k;
    for (const d of ctx.board.find((s) => s.id === t)?.items || []) {
      const b = ctx.cards.get(d.slug);
      if (!b) continue;
      const { w: bw, h: bh } = sizeOf(b);
      b.x = Math.round(Math.max(R.x + pad, Math.min(b.x, R.x + R.w - pad - bw)));
      b.y = Math.round(Math.max(R.y + head, Math.min(b.y, R.y + R.h - pad - bh)));
    }
    if (t !== id) ctx.frames.delete(t);   // a subgroup squeezed with it follows its cards again
  }
  ctx.frames.set(id, R);
  pushOthers(ctx, id, old);
  return R;
}
// After pulling: if cards of the group now lie on each other, they are tidied to its width (and the frame grows
// down where they need it). True when it tidied.
export function settleGroup(ctx, id, R) {
  const slugs = treeOf(ctx.board, id).flatMap((t) => (ctx.board.find((s) => s.id === t)?.items || []).map((d) => d.slug)).filter((s) => ctx.cards.has(s));
  const boxes = slugs.map((s) => { const b = ctx.cards.get(s); return { x: b.x, y: b.y, ...sizeOf(b) }; });
  let clash = false;
  for (let i = 0; i < boxes.length && !clash; i++) for (let j = i + 1; j < boxes.length; j++) if (overlaps(boxes[i], boxes[j], -4)) { clash = true; break; }
  if (!clash) return false;
  const blk = layoutSection(ctx, id, R.x, R.y, R.w);
  ctx.frames.set(id, { x: R.x, y: R.y, w: R.w, h: Math.max(R.h, blk.h) });
  pushOthers(ctx, id, R);
  return true;
}
