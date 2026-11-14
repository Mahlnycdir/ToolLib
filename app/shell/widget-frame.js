// One frame for every widget (0.28.0): on Start and in projects. A widget has a head (icon, name, menu ⋯) and a
// body. You drag it by its head onto another widget to swap places; the menu moves it, makes it wide or narrow,
// edits a building block or takes it away. Below the widgets: "Add a widget".
//
//   widgetGrid({
//     scope,                     a name for this board (drags only land on the same board)
//     list, wide,                ids in order, ids that are two columns wide
//     render(id)                 → { kind, title, icon, body, editable } or null (left out)
//     save({ list, wide })       store a new order or width; returns true when it worked
//     remove(id)                 take a widget away (a building block with its content)
//     edit(id)                   change a building block
//     choices()                  → [{ value, label, icon, detail }] for "Add a widget" (none: no button)
//     add(value)                 put a new widget on the board
//   })
//
// For Python readers: the board does not keep a model of its own; every action calls save/remove/add, which write
// the file, and the page is drawn again from the file (like re-rendering a template after each POST).
import { h, actionSheet, confirmDialog } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t } from '../i18n/i18n.js';
import { draggable, dropZone } from './drag.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

export function widgetGrid({ scope, list, wide = [], render, save, remove, edit, choices, add }) {
  const area = h('div', { class: 'widgets' });
  const shown = list.map((id) => ({ id, w: render(id) })).filter((x) => x.w);
  const ids = shown.map((x) => x.id);
  shown.forEach(({ id, w }, i) => {
    const isWide = wide.includes(id);
    const menu = h('button', { type: 'button', class: 'icon-btn small widget-menu no-drag', title: t('widget.menu'), 'aria-label': `${t('widget.menu')}: ${w.title}`, html: icon('more') });
    menu.addEventListener('click', async () => {
      const pick = await actionSheet(w.title, [
        ...(i > 1 ? [{ label: t('widget.first'), value: 'first', icon: 'arrowLeft' }] : []),
        { label: t('widget.earlier'), value: 'up', icon: 'arrowLeft', disabled: i === 0 },
        { label: t('widget.later'), value: 'down', icon: 'arrowRight', disabled: i === ids.length - 1 },
        '-',
        { label: t(isWide ? 'widget.narrow' : 'widget.wide'), value: 'wide', icon: isWide ? 'shrink' : 'expand' },
        ...(w.editable ? [{ label: t('widget.edit'), value: 'edit', icon: 'edit' }] : []),
        '-', { label: t('widget.remove'), value: 'remove', icon: 'close', danger: true },
      ]);
      if (!pick) return;
      if (pick === 'edit') { edit?.(id); return; }
      if (pick === 'wide') { save({ list: ids, wide: isWide ? wide.filter((x) => x !== id) : [...wide, id] }); return; }
      if (pick === 'remove') {
        // a building block with something written in it asks first: its content goes with it
        if (w.hasContent && !(await confirmDialog(t('widget.remove'), t('widget.remove.confirm', { name: w.title }), { okLabel: t('widget.remove'), danger: true }))) return;
        remove(id);
        return;
      }
      const next = [...ids];
      if (pick === 'first') next.unshift(...next.splice(i, 1));
      else { const j = pick === 'up' ? i - 1 : i + 1; [next[i], next[j]] = [next[j], next[i]]; }
      save({ list: next, wide });
    });
    const head = h('header', { class: 'widget-head' }, iconEl(w.icon, 'widget-icon'), h('h3', { text: w.title }), menu);
    const el = h('section', { class: `widget widget-${w.kind}${isWide ? ' wide' : ''}`, dataset: { widget: id } }, head, w.body);
    draggable(head, { data: { kind: 'widget', id, scope }, label: w.title });
    dropZone(el, {
      accept: (x) => x.kind === 'widget' && x.scope === scope && x.id !== id,
      // a widget dropped on another takes its place (0.19.0)
      place: (x) => (ids.indexOf(x.id) > i ? 'before' : 'after'),
      drop: (x, place) => {
        const next = ids.filter((y) => y !== x.id);
        next.splice(next.indexOf(id) + (place === 'after' ? 1 : 0), 0, x.id);
        save({ list: next, wide });
      },
    });
    area.append(el);
  });
  const offer = choices?.() || [];
  if (offer.length) {
    const btn = h('button', { type: 'button', class: 'widget-add', id: 'widget-add' }, iconEl('plus'), h('span', { text: t('widget.add') }));
    btn.addEventListener('click', async () => {
      const pick = await actionSheet(t('widget.add'), offer);
      if (pick) add(pick);
    });
    area.append(btn);
  }
  return area;
}
