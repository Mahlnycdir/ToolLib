// One frame for every widget (0.28.0): on Heute and in projects. A widget has a head (icon, name, menu ⋯) and a
// body. 0.33.0 ("Anordnen vollständig"): the board can be arranged like the home screen of a phone.
//
//   Normal         the head moves a widget (mouse), the menu ⋯ moves it, sizes it, edits or removes it.
//   Anordnen       the widgets wiggle; each has an × (top left: away at once, "Undo" in the message) and a corner
//                  (bottom right: drag it, the widget snaps to 1×1, 2×1, 1×2 or 2×2); you take a widget anywhere and
//                  lay it where you like (0.33.2): into any column, under any other widget; a light field shows where
//                  it lands and the others make room at once. What is inside rests meanwhile. A tray above the board offers
//                  everything you can lay down: widgets you hid (to show again) and building blocks.
//   iPhone         a long press on a widget starts Anordnen (like the home screen); "Fertig" ends it.
//                  0.33.1: on the phone the board is one column and calmer: each widget takes the whole width, and
//                  what you hide there (×) is hidden on this phone only (pref widgets.phone, per board); the Mac keeps
//                  everything. The tray offers them again under "Hidden on this phone".
//
//   widgetGrid({
//     scope,                     a name for this board (drags only land on the same board)
//     list,                      ids in order
//     sizes,                     { id: '2x1' | '1x2' | '2x2' } (1×1 is left out); `wide: [ids]` still works (= 2×1)
//     col,                       { id: column } on a board of four (0.33.2); a widget without one takes the lowest
//                                free place; the order of `list` is the order from top to bottom
//     render(id)                 → { kind, title, icon, body, editable, hasContent, bare } or null (left out);
//                                  bare: no frame of its own (the focus card, Loom), the head shows only while arranging
//     save({ list, sizes, col }) store a new order, sizes or columns
//     remove(id)                 take a widget away; may return a function that brings it back (the "Undo")
//     edit(id)                   change a building block
//     choices()                  → [{ value, label, icon, detail }] for "Add a widget"; the ones before '-' are your
//                                  own widgets that are not on the board (shown as "hidden" in the tray)
//     add(value)                 put a new widget on the board
//     arranging, onArrange(on)   whether the board is being arranged, and how to switch (the page keeps the state)
//     tray                       a title for the tray ("Heute anordnen"); no title: no tray
//     phoneHidden                ids hidden on a phone when this board has no list of its own yet (0.33.1)
//   })
//
// For Python readers: the board does not keep a model of its own; every action calls save/remove/add, which write
// the file, and the page is drawn again from the file (like re-rendering a template after each POST).
import { h, actionSheet, confirmDialog, toast, loadPref, savePref } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t } from '../i18n/i18n.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
export const SIZES = ['1x1', '2x1', '1x2', '2x2'];
const LONG_PRESS = 520;

// { id: size } from a stored map and the older `wide` list; only sizes it knows, 1×1 left out
export function sizesOf(stored, wide = []) {
  const out = {};
  for (const id of wide || []) out[id] = '2x1';
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const [id, v] of Object.entries(stored)) if (/^[a-z0-9]{2,16}$/.test(id) && SIZES.includes(v)) out[id] = v;
  }
  for (const id of Object.keys(out)) if (out[id] === '1x1') delete out[id];
  return out;
}
const colsOf = (size) => Number(String(size || '1x1')[0]) || 1;
// { id: column 0…3 } as stored (anything else left out)
export function cleanCol(col) {
  const out = {};
  if (col && typeof col === 'object' && !Array.isArray(col)) for (const [id, x] of Object.entries(col)) if (/^[a-z0-9]{2,16}$/.test(id) && Number.isInteger(x) && x >= 0 && x <= 3) out[id] = x;
  return out;
}
// the phone (0.33.1): narrow screen; its own list of hidden widgets per board, on this device only
export const isPhone = () => window.matchMedia('(max-width: 759px)').matches;
function phoneList(scope, fallback) {
  const all = loadPref('widgets.phone', {});
  const v = all && typeof all === 'object' ? all[scope] : null;
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [...fallback];
}
function setPhoneList(scope, list) {
  const all = loadPref('widgets.phone', {});
  const next = all && typeof all === 'object' && !Array.isArray(all) ? { ...all } : {};
  next[scope] = [...new Set(list)].slice(0, 60);
  savePref('widgets.phone', Object.fromEntries(Object.entries(next).slice(-40)));
}
const rowsOf = (size) => Number(String(size || '1x1')[2]) || 1;

export function widgetGrid({ scope, list, sizes = null, wide = [], col = {}, render, save, remove, edit, choices, add, arranging = false, onArrange = null, tray = '', phoneHidden = [] }) {
  const size = sizesOf(sizes, sizes ? [] : wide);
  const phone = isPhone();
  const hiddenHere = phone ? phoneList(scope, phoneHidden) : [];
  const area = h('div', { class: `widgets sized${arranging ? ' arranging' : ''}${phone ? ' phone' : ''}`, dataset: { scope } });
  const all = list.map((id) => ({ id, w: render(id) })).filter((x) => x.w);
  const shown = all.filter((x) => !hiddenHere.includes(x.id));
  // the order is kept for every widget, also the ones hidden on this phone
  const ids = all.map((x) => x.id);
  // after hiding or showing on the phone the board draws itself again (whichever element stands for it now)
  const redraw = () => window.dispatchEvent(new CustomEvent('widgets:phone', { detail: scope }));
  const cols0 = cleanCol(col);
  const store = (next, nextSizes = size, nextAt = cols0) => save({ list: next, sizes: nextSizes, col: nextAt, wide: Object.keys(nextSizes).filter((k) => colsOf(nextSizes[k]) === 2) });
  const setSize = (id, v) => { const next = { ...size }; if (v === '1x1') delete next[id]; else next[id] = v; store(ids, next); };

  const takeAway = async (id, w) => {
    // on the phone: hidden on this phone only, the Mac keeps it
    if (phone) {
      setPhoneList(scope, [...phoneList(scope, phoneHidden), id]);
      redraw();
      toast(t('widget.hiddenPhone', { name: w.title }), 'ok', 7000, { label: t('delete.undo'), run: () => { setPhoneList(scope, phoneList(scope, phoneHidden).filter((x) => x !== id)); redraw(); } });
      return;
    }
    // a building block with something written in it asks first: its content goes with it
    if (w.hasContent && !(await confirmDialog(t('widget.remove'), t('widget.remove.confirm', { name: w.title }), { okLabel: t('widget.remove'), danger: true }))) return;
    const undo = await remove(id);
    if (typeof undo === 'function') toast(t('widget.removed', { name: w.title }), 'ok', 8000, { label: t('delete.undo'), run: undo });
  };

  shown.forEach(({ id, w }) => {
    const i = ids.indexOf(id);
    const sz = size[id] || '1x1';
    const menu = h('button', { type: 'button', class: 'icon-btn small widget-menu no-drag', title: t('widget.menu'), 'aria-label': `${t('widget.menu')}: ${w.title}`, html: icon('more') });
    menu.addEventListener('click', async () => {
      const pick = await actionSheet(w.title, [
        ...(i > 1 ? [{ label: t('widget.first'), value: 'first', icon: 'arrowLeft' }] : []),
        { label: t('widget.earlier'), value: 'up', icon: 'arrowLeft', disabled: i === 0 },
        { label: t('widget.later'), value: 'down', icon: 'arrowRight', disabled: i === ids.length - 1 },
        '-',
        ...(phone ? [] : SIZES.map((v) => ({ label: t('widget.size', { size: v.replace('x', '×') }), value: `size:${v}`, icon: v === sz ? 'check' : colsOf(v) > 1 ? 'expand' : 'shrink', disabled: v === sz }))),
        ...(w.editable ? ['-', { label: t('widget.edit'), value: 'edit', icon: 'edit' }] : []),
        ...(onArrange ? ['-', { label: t('start.arrange'), value: 'arrange', icon: 'blocks' }] : []),
        '-', { label: t(phone ? 'widget.hidePhone' : 'widget.remove'), value: 'remove', icon: 'close', danger: !phone },
      ]);
      if (!pick) return;
      if (pick === 'edit') { edit?.(id); return; }
      if (pick === 'arrange') { onArrange(true); return; }
      if (pick.startsWith('size:')) { setSize(id, pick.slice(5)); return; }
      if (pick === 'remove') { takeAway(id, w); return; }
      const next = [...ids];
      if (pick === 'first') next.unshift(...next.splice(i, 1));
      else { const j = pick === 'up' ? i - 1 : i + 1; [next[i], next[j]] = [next[j], next[i]]; }
      store(next);
    });
    const head = h('header', { class: 'widget-head' }, iconEl(w.icon, 'widget-icon'), h('h3', { text: w.title }), menu);
    const xLabel = t(phone ? 'widget.hidePhone' : 'widget.remove');
    const x = h('button', { type: 'button', class: 'widget-x no-drag', 'aria-label': `${xLabel}: ${w.title}`, title: xLabel, html: icon('close') });
    x.addEventListener('click', (e) => { e.stopPropagation(); takeAway(id, w); });
    const grip = h('span', { class: 'widget-size no-drag', title: t('widget.resize'), 'aria-hidden': 'true' });
    const el = h('section', { class: `widget widget-${w.kind} s-${sz}${colsOf(sz) > 1 ? ' wide' : ''}${w.bare ? ' bare' : ''}`, dataset: { widget: id, size: sz } }, x, head, w.body, grip);
    el.style.setProperty('--wc', String(colsOf(sz)));
    el.style.setProperty('--wr', String(rowsOf(sz)));
    // by its head with the mouse; anywhere while arranging (a finger rests a moment first, then the widget follows)
    freeDrag(el, id);
    resizable(grip, el, area, (v) => { if (v !== sz) setSize(id, v); });
    if (onArrange) longPress(el, area, () => onArrange(true));
    area.append(el);
  });

  // the columns follow the width of the board: four on a wide Mac, one on the phone (0.33.1: every widget the whole
  // width there, so each one stays readable)
  const fitCols = () => {
    const w = area.getBoundingClientRect().width;
    if (!w) return;
    const cols = w >= 1000 ? 4 : w >= 700 ? 3 : w >= 520 ? 2 : 1;
    area.style.setProperty('--cols', String(cols));
    area.classList.toggle('one-col', cols === 1);
    pack();
  };
  // Laid out like a dashboard (0.33.2, ENTE: "die Seite wirklich so gestalten, wie ich will"): every widget has a
  // column (`col`, on a board of four) and a place in the order (`list`, top to bottom); its height is what its content
  // needs. Going down the order, each widget sits in its column(s) right under what lies there already (a skyline:
  // per column, how far down it is filled). So a widget can lie under any other, in any column; nothing hangs in
  // the air (things move up as far as they can). Rows are 4 px, so heights fit closely.
  // For Python readers: layout() is a pure function from (order, columns, sizes, heights) to grid places.
  const ROW = 4;
  let packing = 0;
  let current = null;   // the last layout: { order, place: Map(id → { x, w, top, span }) }
  const cellsOf = () => [...area.children].filter((el) => el.dataset.widget || el.classList.contains('widget-add'));
  const keyOf = (el) => el.dataset.widget || '+add';
  function measure() {
    const gap = parseFloat(getComputedStyle(area).columnGap) || 14;
    const hs = new Map();
    for (const el of cellsOf()) if (!el.classList.contains('lifted')) hs.set(keyOf(el), Math.max(1, Math.ceil((el.getBoundingClientRect().height + gap) / ROW)));
    return hs;
  }
  function layout(order, colsAt, heights, cols) {
    const bottoms = new Array(cols).fill(0);
    const place = new Map();
    for (const id of order) {
      const w = id === '+add' ? 1 : Math.min(colsOf(size[id]), cols);
      let x = colsAt[id];
      if (x == null || cols === 1) {
        // no column of its own: the lowest place where it fits (leftmost when two are equal)
        let best = 0; let bestTop = Infinity;
        for (let c = 0; c + w <= cols; c++) { const top = Math.max(...bottoms.slice(c, c + w)); if (top < bestTop) { best = c; bestTop = top; } }
        x = best;
      } else x = Math.max(0, Math.min(Number(x) || 0, cols - w));
      const top = Math.max(...bottoms.slice(x, x + w));
      const span = heights.get(id) || 20;
      for (let c = x; c < x + w; c++) bottoms[c] = top + span;
      place.set(id, { x, w, top, span });
    }
    return place;
  }
  // the others glide to their new places (FLIP: where they were → where they are; `translate` leaves the wiggle alone)
  const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function apply(place, glide = false) {
    const before = glide && !calm() ? new Map(cellsOf().map((el) => [el, el.getBoundingClientRect()])) : null;
    for (const el of cellsOf()) {
      const p = place.get(keyOf(el));
      if (!p) continue;
      el.style.gridColumn = `${p.x + 1} / span ${p.w}`;
      el.style.gridRow = `${p.top + 1} / span ${p.span}`;
    }
    if (!before) return;
    for (const [el, r0] of before) {
      if (el.classList.contains('lifted') || !el.animate) continue;
      const r = el.getBoundingClientRect();
      const dx = r0.left - r.left; const dy = r0.top - r.top;
      if (Math.abs(dx) + Math.abs(dy) > 1) el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 180, easing: 'ease-out' });
    }
  }
  // the order on screen (the board keeps it while it is saved, so nothing jumps back meanwhile)
  let orderNow = shown.map((x) => x.id);
  const visibleOrder = () => [...orderNow, ...(area.querySelector('.widget-add') ? ['+add'] : [])];
  function pack() {
    cancelAnimationFrame(packing);
    packing = requestAnimationFrame(() => {
      if (!area.isConnected || area.classList.contains('dragging-widget')) return;
      const cols = Number(area.style.getPropertyValue('--cols')) || 1;
      area.classList.add('stacked');
      const order = visibleOrder();
      const place = layout(order, cols0, measure(), cols);
      apply(place);
      current = { order, place, cols };
    });
  }

  // ---- taking a widget and laying it somewhere else
  function freeDrag(el, id) {
    // while arranging, links and pictures inside must not start the browser's own dragging
    el.addEventListener('dragstart', (e) => { if (area.classList.contains('arranging')) e.preventDefault(); });
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('input, textarea, select, [contenteditable="true"], .no-drag')) return;
      const mouse = e.pointerType === 'mouse';
      if (!area.classList.contains('arranging') && !(mouse && e.target.closest('.widget-head'))) return;
      const at0 = { x: e.clientX, y: e.clientY };
      let started = false; let timer = 0; let ghost = null; let grab = null; let frame = 0; let last = null; let scrollBy = 0;
      const main = area.closest('.main');
      const scroller = main && main.scrollHeight > main.clientHeight + 1 ? main : document.scrollingElement;
      const cols = () => Number(area.style.getPropertyValue('--cols')) || 1;
      const begin = () => {
        if (started) return;
        started = true;
        const r = el.getBoundingClientRect();
        grab = { dx: at0.x - r.left, dy: at0.y - r.top };
        ghost = h('div', { class: 'widget-ghost', 'aria-hidden': 'true' });
        ghost.style.gridColumn = el.style.gridColumn; ghost.style.gridRow = el.style.gridRow;
        ghost.style.height = `${r.height}px`;
        area.append(ghost);
        area.classList.add('dragging-widget');
        el.classList.add('lifted');
        document.body.classList.add('dragging-now');
        try { window.getSelection()?.removeAllRanges(); } catch { /* nothing selected */ }
      };
      // where it would land: the column under its left edge, before the first widget (in its columns) whose middle
      // lies below its top edge (plus a little); the others keep their order as they lie now (top to bottom)
      const target = (px, py) => {
        const n = cols();
        const box = area.getBoundingClientRect();
        const gap = parseFloat(getComputedStyle(area).columnGap) || 14;
        const colW = (box.width - gap * (n - 1)) / n;
        const w = Math.min(colsOf(size[id]), n);
        const x = Math.max(0, Math.min(n - w, Math.floor((px - grab.dx + colW / 2 - box.left) / (colW + gap))));
        const y = (py - grab.dy - box.top + 24) / ROW;
        const lay = current?.place || new Map();
        const others = visibleOrder().filter((k) => k !== id).map((k) => {
          const p = lay.get(k) || { x: 0, w: 1, top: 0, span: 1 };
          const overlaps = p.x < x + w && x < p.x + p.w;
          return { k, key: overlaps ? p.top + p.span / 2 : p.top, x: p.x };
        }).sort((a, b) => a.key - b.key || a.x - b.x);
        const pos = others.findIndex((o) => o.key > y);
        const order = others.map((o) => o.k);
        order.splice(pos < 0 ? order.length : pos, 0, id);
        if (order.includes('+add')) { order.splice(order.indexOf('+add'), 1); order.push('+add'); }
        const colsAt = {};
        for (const k of order) if (k !== '+add') colsAt[k] = k === id ? x : lay.get(k)?.x ?? cols0[k];
        return { order, colsAt };
      };
      const follow = () => {
        frame = 0;
        if (!last) return;
        const t0 = target(last.x, last.y);
        const heights = measure();
        heights.set(id, current?.place.get(id)?.span || 20);
        const place = layout(t0.order, t0.colsAt, heights, cols());
        const key = JSON.stringify([t0.order, t0.colsAt]);
        if (key !== last.key) apply(place, true);
        last.key = key;
        const p = place.get(id);
        ghost.style.gridColumn = `${p.x + 1} / span ${p.w}`;
        ghost.style.gridRow = `${p.top + 1} / span ${p.span}`;
        // the widget itself lies in that place too and floats under the finger (transform from its place)
        el.style.transform = 'none';
        const r = el.getBoundingClientRect();
        el.style.transform = `translate(${last.x - grab.dx - r.left}px, ${last.y - grab.dy - r.top}px)`;
        last.result = t0;
        if (scrollBy && scroller) { scroller.scrollTop += scrollBy; frame = requestAnimationFrame(follow); }
      };
      const move = (ev) => {
        if (!started) {
          const d = Math.hypot(ev.clientX - at0.x, ev.clientY - at0.y);
          if (mouse && d > 6) begin(); else if (!mouse && d > 10) { cleanup(); return; } else return;
        }
        ev.preventDefault();
        last = { x: ev.clientX, y: ev.clientY, key: last?.key };
        // near the top or bottom edge the page scrolls along
        const vr = scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
        scrollBy = ev.clientY < vr.top + 60 ? -14 : ev.clientY > vr.bottom - 60 ? 14 : 0;
        if (!frame) frame = requestAnimationFrame(follow);
      };
      const noScroll = (ev) => { if (started) ev.preventDefault(); };
      const up = () => {
        const result = started && last?.result;
        const was = started;
        cleanup();
        if (!was) return;
        if (!result) { pack(); return; }
        // the order of every widget (the ones hidden on this phone keep their places) and every column
        const hidden = ids.filter((k) => hiddenHere.includes(k));
        const next = result.order.filter((k) => k !== '+add');
        for (const k of hidden) next.splice(Math.min(ids.indexOf(k), next.length), 0, k);
        const nextAt = { ...cols0 };
        if (!phone) for (const [k, x] of Object.entries(result.colsAt)) nextAt[k] = x;
        if (next.join() === ids.join() && JSON.stringify(cleanCol(nextAt)) === JSON.stringify(cols0)) { pack(); return; }
        // keep what you laid down on screen until the page is drawn again from the file
        orderNow = result.order.filter((k) => k !== '+add');
        for (const k of Object.keys(cols0)) delete cols0[k];
        Object.assign(cols0, cleanCol(nextAt));
        store(next, size, { ...cols0 });
      };
      function cleanup() {
        clearTimeout(timer);
        cancelAnimationFrame(frame);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        window.removeEventListener('touchmove', noScroll);
        if (started) {
          ghost?.remove();
          el.classList.remove('lifted');
          el.style.transform = '';
          area.classList.remove('dragging-widget');
          document.body.classList.remove('dragging-now');
          // a click right after letting go must not open what lies under the pointer
          const eat = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
          window.addEventListener('click', eat, { capture: true, once: true });
          setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 300);
        }
        started = false;
      }
      if (!mouse) timer = setTimeout(begin, 220);
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      window.addEventListener('touchmove', noScroll, { passive: false });
    });
  }
  if (window.ResizeObserver) {
    new ResizeObserver(fitCols).observe(area);
    // a widget whose content grows or shrinks (a list, a picture that loads) takes its new height
    const each = new ResizeObserver(pack);
    for (const el of area.children) each.observe(el);
  }
  requestAnimationFrame(fitCols);

  const offer = choices?.() || [];
  if (offer.length) {
    const btn = h('button', { type: 'button', class: 'widget-add', id: 'widget-add' }, iconEl('plus'), h('span', { text: t('widget.add') }));
    btn.addEventListener('click', async () => {
      const pick = await actionSheet(t('widget.add'), offer);
      if (pick) add(pick);
    });
    area.append(btn);
  }
  const opts = { scope, list, sizes, wide, col, render, save, remove, edit, choices, add, arranging, onArrange, tray, phoneHidden };
  const listen = (root) => {
    const again = (e) => {
      if (!root.isConnected) { window.removeEventListener('widgets:phone', again); return; }
      if (e.detail !== scope) return;
      window.removeEventListener('widgets:phone', again);
      root.replaceWith(widgetGrid(opts));
    };
    window.addEventListener('widgets:phone', again);
    return root;
  };
  if (!tray) return listen(area);
  const wrap = h('div', { class: 'widget-board' });
  const onPhone = phone ? all.filter((x) => hiddenHere.includes(x.id)).map((x) => ({ value: x.id, label: x.w.title, icon: x.w.icon })) : [];
  const showAgain = (id) => { setPhoneList(scope, phoneList(scope, phoneHidden).filter((x) => x !== id)); redraw(); };
  if (arranging) wrap.append(trayOf({ title: tray, offer, add, done: () => onArrange?.(false), onPhone, showAgain }));
  wrap.append(area);
  return listen(wrap);
}

// The tray while arranging: everything you can lay down, and "Fertig".
function trayOf({ title, offer, add, done, onPhone = [], showAgain }) {
  const cut = offer.indexOf('-');
  const own = (cut < 0 ? offer : offer.slice(0, cut)).filter((x) => x && x !== '-');
  const blocks = cut < 0 ? [] : offer.slice(cut + 1).filter((x) => x && x !== '-');
  const chip = (x) => h('button', { type: 'button', class: 'chip tray-chip', dataset: { value: x.value }, title: x.detail || x.label, onclick: () => add(x.value) }, iconEl(x.icon || 'plus'), h('span', { text: x.label }));
  const fertig = h('button', { type: 'button', class: 'btn primary small tray-done', onclick: done }, iconEl('check'), h('span', { text: t('start.arranged') }));
  return h('section', { class: 'widget-tray', 'aria-label': title },
    h('div', { class: 'tray-top' }, h('b', { text: title }), h('span', { class: 'muted small', text: t(onPhone.length || isPhone() ? 'tray.hint.phone' : 'tray.hint') }), fertig),
    onPhone.length ? h('div', { class: 'tray-row' }, h('span', { class: 'tray-label muted small', text: t('tray.phone') }),
      ...onPhone.map((x) => h('button', { type: 'button', class: 'chip tray-chip', dataset: { value: x.value, phone: '1' }, onclick: () => showAgain(x.value) }, iconEl(x.icon || 'plus'), h('span', { text: x.label })))) : null,
    own.length ? h('div', { class: 'tray-row' }, h('span', { class: 'tray-label muted small', text: t('tray.hidden') }), ...own.map(chip)) : null,
    blocks.length ? h('div', { class: 'tray-row' }, h('span', { class: 'tray-label muted small', text: t('tray.blocks') }), ...blocks.map(chip)) : null);
}

// The corner: drag it and the widget grows or shrinks by whole columns and rows of the board; on letting go it
// snaps to the nearest size (one or two columns, one or two rows).
function resizable(grip, el, area, done) {
  grip.addEventListener('pointerdown', (e) => {
    if (!area.classList.contains('arranging') || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const r0 = el.getBoundingClientRect();
    const cols = Math.max(1, getComputedStyle(area).gridTemplateColumns.split(' ').filter(Boolean).length);
    const gap = parseFloat(getComputedStyle(area).columnGap) || 12;
    const colW = (area.getBoundingClientRect().width - gap * (cols - 1)) / cols;
    const rowH = Math.max(120, r0.height / (Number(el.style.getPropertyValue('--wr')) || 1));
    const start = { x: e.clientX, y: e.clientY };
    el.classList.add('resizing');
    try { grip.setPointerCapture(e.pointerId); } catch { /* a pointer made up by a test */ }
    let v = el.dataset.size || '1x1';
    const move = (ev) => {
      const w = r0.width + ev.clientX - start.x;
      const hgt = r0.height + ev.clientY - start.y;
      const c = Math.min(Math.min(2, cols), Math.max(1, Math.round((w + gap) / (colW + gap))));
      const rr = Math.min(2, Math.max(1, Math.round((hgt + gap) / (rowH + gap))));
      v = `${c}x${rr}`;
      el.style.width = `${Math.max(colW * 0.6, w)}px`;
      el.style.height = `${Math.max(80, hgt)}px`;
      el.dataset.preview = v;
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      el.classList.remove('resizing');
      el.style.width = ''; el.style.height = '';
      delete el.dataset.preview;
      done(v);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
}

// A finger resting on a widget (not moving) starts arranging, like the home screen.
function longPress(el, area, start) {
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || area.classList.contains('arranging')) return;
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const at = { x: e.clientX, y: e.clientY };
    const timer = setTimeout(() => {
      cleanup();
      if (navigator.vibrate) { try { navigator.vibrate(10); } catch { /* not here */ } }
      // the finger lifting after the long press must not tap what lies below it (only there: a tap elsewhere, an ×
      // say, goes through)
      const eat = (ev) => { if (Math.hypot(ev.clientX - at.x, ev.clientY - at.y) < 24) { ev.preventDefault(); ev.stopPropagation(); } };
      document.addEventListener('click', eat, true);
      setTimeout(() => document.removeEventListener('click', eat, true), 700);
      start();
    }, LONG_PRESS);
    const move = (ev) => { if (Math.hypot(ev.clientX - at.x, ev.clientY - at.y) > 8) cleanup(); };
    function cleanup() { clearTimeout(timer); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', cleanup); window.removeEventListener('pointercancel', cleanup); }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  });
}
