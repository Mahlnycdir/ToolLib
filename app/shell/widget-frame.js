// One frame for every widget (0.28.0): on Heute and in projects. A widget has a head (icon, name, menu ⋯) and a
// body. 0.33.0 ("Anordnen vollständig"): the board can be arranged like the home screen of a phone.
//
//   Normal         the head moves a widget (mouse), the menu ⋯ moves it, sizes it, edits or removes it.
//   Anordnen       the widgets wiggle; each has an × (top left: away at once, "Undo" in the message) and a corner
//                  (bottom right: drag it, the widget snaps to 1×1, 2×1, 1×2 or 2×2); you take a widget anywhere and
//                  drop it where the light bar shows; what is inside rests meanwhile. A tray above the board offers
//                  everything you can lay down: widgets you hid (to show again) and building blocks.
//   iPhone         a long press on a widget starts Anordnen (like the home screen); "Fertig" ends it.
//
//   widgetGrid({
//     scope,                     a name for this board (drags only land on the same board)
//     list,                      ids in order
//     sizes,                     { id: '2x1' | '1x2' | '2x2' } (1×1 is left out); `wide: [ids]` still works (= 2×1)
//     render(id)                 → { kind, title, icon, body, editable, hasContent, bare } or null (left out);
//                                  bare: no frame of its own (the focus card, Loom), the head shows only while arranging
//     save({ list, sizes })      store a new order or sizes
//     remove(id)                 take a widget away; may return a function that brings it back (the "Undo")
//     edit(id)                   change a building block
//     choices()                  → [{ value, label, icon, detail }] for "Add a widget"; the ones before '-' are your
//                                  own widgets that are not on the board (shown as "hidden" in the tray)
//     add(value)                 put a new widget on the board
//     arranging, onArrange(on)   whether the board is being arranged, and how to switch (the page keeps the state)
//     tray                       a title for the tray ("Heute anordnen"); no title: no tray
//   })
//
// For Python readers: the board does not keep a model of its own; every action calls save/remove/add, which write
// the file, and the page is drawn again from the file (like re-rendering a template after each POST).
import { h, actionSheet, confirmDialog, toast } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t } from '../i18n/i18n.js';
import { draggable, dropZone } from './drag.js';

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
const rowsOf = (size) => Number(String(size || '1x1')[2]) || 1;

export function widgetGrid({ scope, list, sizes = null, wide = [], render, save, remove, edit, choices, add, arranging = false, onArrange = null, tray = '' }) {
  const size = sizesOf(sizes, sizes ? [] : wide);
  const area = h('div', { class: `widgets sized${arranging ? ' arranging' : ''}`, dataset: { scope } });
  const shown = list.map((id) => ({ id, w: render(id) })).filter((x) => x.w);
  const ids = shown.map((x) => x.id);
  const store = (next, nextSizes = size) => save({ list: next, sizes: nextSizes, wide: Object.keys(nextSizes).filter((k) => colsOf(nextSizes[k]) === 2) });
  const setSize = (id, v) => { const next = { ...size }; if (v === '1x1') delete next[id]; else next[id] = v; store(ids, next); };

  const takeAway = async (id, w) => {
    // a building block with something written in it asks first: its content goes with it
    if (w.hasContent && !(await confirmDialog(t('widget.remove'), t('widget.remove.confirm', { name: w.title }), { okLabel: t('widget.remove'), danger: true }))) return;
    const undo = await remove(id);
    if (typeof undo === 'function') toast(t('widget.removed', { name: w.title }), 'ok', 8000, { label: t('delete.undo'), run: undo });
  };

  shown.forEach(({ id, w }, i) => {
    const sz = size[id] || '1x1';
    const menu = h('button', { type: 'button', class: 'icon-btn small widget-menu no-drag', title: t('widget.menu'), 'aria-label': `${t('widget.menu')}: ${w.title}`, html: icon('more') });
    menu.addEventListener('click', async () => {
      const pick = await actionSheet(w.title, [
        ...(i > 1 ? [{ label: t('widget.first'), value: 'first', icon: 'arrowLeft' }] : []),
        { label: t('widget.earlier'), value: 'up', icon: 'arrowLeft', disabled: i === 0 },
        { label: t('widget.later'), value: 'down', icon: 'arrowRight', disabled: i === ids.length - 1 },
        '-',
        ...SIZES.map((v) => ({ label: t('widget.size', { size: v.replace('x', '×') }), value: `size:${v}`, icon: v === sz ? 'check' : colsOf(v) > 1 ? 'expand' : 'shrink', disabled: v === sz })),
        ...(w.editable ? ['-', { label: t('widget.edit'), value: 'edit', icon: 'edit' }] : []),
        ...(onArrange ? ['-', { label: t('start.arrange'), value: 'arrange', icon: 'blocks' }] : []),
        '-', { label: t('widget.remove'), value: 'remove', icon: 'close', danger: true },
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
    const x = h('button', { type: 'button', class: 'widget-x no-drag', 'aria-label': `${t('widget.remove')}: ${w.title}`, title: t('widget.remove'), html: icon('close') });
    x.addEventListener('click', (e) => { e.stopPropagation(); takeAway(id, w); });
    const grip = h('span', { class: 'widget-size no-drag', title: t('widget.resize'), 'aria-hidden': 'true' });
    const el = h('section', { class: `widget widget-${w.kind} s-${sz}${colsOf(sz) > 1 ? ' wide' : ''}${w.bare ? ' bare' : ''}`, dataset: { widget: id, size: sz } }, x, head, w.body, grip);
    el.style.setProperty('--wc', String(colsOf(sz)));
    el.style.setProperty('--wr', String(rowsOf(sz)));
    // by its head with the mouse; anywhere while arranging (a finger rests a moment first, then the widget follows)
    draggable(el, {
      data: { kind: 'widget', id, scope }, label: w.title, hold: 200,
      when: (e) => area.classList.contains('arranging') || (e.pointerType === 'mouse' && !!e.target.closest('.widget-head')),
    });
    dropZone(el, {
      accept: (d) => d.kind === 'widget' && d.scope === scope && d.id !== id,
      // a widget dropped on another takes its place (0.19.0)
      place: (d) => (ids.indexOf(d.id) > i ? 'before' : 'after'),
      drop: (d, place) => {
        const next = ids.filter((y) => y !== d.id);
        next.splice(next.indexOf(id) + (place === 'after' ? 1 : 0), 0, d.id);
        store(next);
      },
    });
    resizable(grip, el, area, (v) => { if (v !== sz) setSize(id, v); });
    if (onArrange) longPress(el, area, () => onArrange(true));
    area.append(el);
  });

  // the columns follow the width of the board: four on a wide Mac, two on the phone (a widget spans one or two)
  const fitCols = () => { const w = area.getBoundingClientRect().width; if (!w) return; area.style.setProperty('--cols', String(w >= 1000 ? 4 : w >= 700 ? 3 : 2)); };
  if (window.ResizeObserver) new ResizeObserver(fitCols).observe(area);
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
  if (!tray) return area;
  const wrap = h('div', { class: 'widget-board' });
  if (arranging) wrap.append(trayOf({ title: tray, offer, add, done: () => onArrange?.(false) }));
  wrap.append(area);
  return wrap;
}

// The tray while arranging: everything you can lay down, and "Fertig".
function trayOf({ title, offer, add, done }) {
  const cut = offer.indexOf('-');
  const own = (cut < 0 ? offer : offer.slice(0, cut)).filter((x) => x && x !== '-');
  const blocks = cut < 0 ? [] : offer.slice(cut + 1).filter((x) => x && x !== '-');
  const chip = (x) => h('button', { type: 'button', class: 'chip tray-chip', dataset: { value: x.value }, title: x.detail || x.label, onclick: () => add(x.value) }, iconEl(x.icon || 'plus'), h('span', { text: x.label }));
  const fertig = h('button', { type: 'button', class: 'btn primary small tray-done', onclick: done }, iconEl('check'), h('span', { text: t('start.arranged') }));
  return h('section', { class: 'widget-tray', 'aria-label': title },
    h('div', { class: 'tray-top' }, h('b', { text: title }), h('span', { class: 'muted small', text: t('tray.hint') }), fertig),
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
      // the finger lifting after the long press must not tap what lies below it
      const eat = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
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
