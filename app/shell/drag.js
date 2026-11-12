// Dragging with mouse and finger (0.17.0): one engine for everything you can reorder (chapters, pages, the sections of
// a page; later the cards of a project). With a mouse a drag starts after a few pixels; on a touch screen after a
// short press without moving (moving at once still scrolls). A copy of the item follows the pointer, the place it
// would land is marked, a list scrolls when you come near its edge, Escape cancels.
//   draggable(el, { data, label })                 → the element can be picked up; data travels with it
//   dropZone(el, { accept(data), place(data, e, el) → 'before' | 'after' | 'into' | null, drop(data, place) })
const zones = new WeakMap();
let active = null;   // { data, ghost, zone, place, el }

const HOLD_MS = 320;
const MOVE_PX = 6;

export function dropZone(el, opts) {
  zones.set(el, opts);
  el.dataset.dropzone = '';
  return el;
}

export function draggable(el, { data, label = '' }) {
  el.classList.add('drag-item');
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || active || e.target.closest('input, textarea, [contenteditable="true"], .no-drag')) return;
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    const start = { x: e.clientX, y: e.clientY };
    let timer = 0;
    let started = false;
    const begin = (x, y) => {
      started = true;
      clearTimeout(timer);
      startDrag(el, typeof data === 'function' ? data() : data, label || el.textContent.trim().slice(0, 60), x, y);
      if (navigator.vibrate && touch) { try { navigator.vibrate(8); } catch { /* not on this device */ } }
    };
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const d = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
      if (!started) {
        if (touch) { if (d > 8) cleanup(); return; }   // moved before the press was long enough: you scroll
        if (d < MOVE_PX) return;
        begin(start.x, start.y);
      }
      ev.preventDefault();
      moveDrag(ev.clientX, ev.clientY);
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      if (started) { ev.preventDefault(); endDrag(ev.type !== 'pointerup'); suppressClick(el); }
      cleanup();
    };
    // while dragging with a finger the page must not scroll
    const noScroll = (ev) => { if (started) ev.preventDefault(); };
    const key = (ev) => { if (ev.key === 'Escape' && started) { endDrag(true); cleanup(); } };
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('touchmove', noScroll);
      window.removeEventListener('keydown', key, true);
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('touchmove', noScroll, { passive: false });
    window.addEventListener('keydown', key, true);
    if (touch) timer = setTimeout(() => begin(start.x, start.y), HOLD_MS);
  });
  // no callout or text selection on a long press
  el.addEventListener('contextmenu', (e) => { if (active) e.preventDefault(); });
  // a link or picture inside must not start the browser's own dragging, which would cancel ours (0.18.0)
  el.addEventListener('dragstart', (e) => e.preventDefault());
  return el;
}

function startDrag(el, data, label, x, y) {
  const r = el.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = label;
  ghost.style.width = `${Math.min(r.width, 320)}px`;
  document.body.append(ghost);
  document.body.classList.add('dragging-now');
  el.classList.add('dragging');
  active = { data, ghost, el, zone: null, place: null, dx: x - r.left, dy: y - r.top };
  moveDrag(x, y);
}

function moveDrag(x, y) {
  if (!active) return;
  active.ghost.style.transform = `translate(${x - Math.min(active.dx, 40)}px, ${y - 14}px)`;
  const under = document.elementFromPoint(x, y);
  let zoneEl = under?.closest?.('[data-dropzone]') || null;
  while (zoneEl && !zones.get(zoneEl)?.accept?.(active.data)) zoneEl = zoneEl.parentElement?.closest?.('[data-dropzone]') || null;
  const place = zoneEl ? zones.get(zoneEl).place?.(active.data, { clientX: x, clientY: y }, zoneEl) ?? null : null;
  if (zoneEl !== active.zone || place !== active.place) {
    active.zone?.classList.remove('drop-before', 'drop-after', 'drop-into');
    if (zoneEl && place) zoneEl.classList.add(`drop-${place}`);
    active.zone = place ? zoneEl : null;
    active.place = place;
  }
  autoScroll(under, y);
}

function endDrag(cancel) {
  const a = active;
  active = null;
  if (!a) return;
  a.ghost.remove();
  a.el.classList.remove('dragging');
  document.body.classList.remove('dragging-now');
  a.zone?.classList.remove('drop-before', 'drop-after', 'drop-into');
  if (!cancel && a.zone && a.place) zones.get(a.zone).drop?.(a.data, a.place, a.zone);
}

// the click that follows a drag must not open the item
function suppressClick(el) {
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
  el.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 400);
}

// Near the top or bottom edge of a scrolling list: scroll it a little.
function autoScroll(under, y) {
  let box = under;
  while (box && box !== document.body) {
    const s = getComputedStyle(box);
    if (/(auto|scroll)/.test(s.overflowY) && box.scrollHeight > box.clientHeight) break;
    box = box.parentElement;
  }
  if (!box || box === document.body) return;
  const r = box.getBoundingClientRect();
  if (y < r.top + 36) box.scrollTop -= 12;
  else if (y > r.bottom - 36) box.scrollTop += 12;
}

// Upper or lower half of an element.
export const half = (e, el) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2 ? 'before' : 'after'; };
