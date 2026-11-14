// The building blocks for widgets (0.28.0): what a block shows and how you set it up. Where they are kept is
// widget-store.js; the frame around them is widget-frame.js. A block works the same on Start and in a project.
//
//   blockBody(cfg, api)   → the element. cfg: the block's config and content; api: { saveContent(text),
//                           go(href), focus } (focus: the project in focus, for a network without a centre)
//   editBlock(cfg)        → a changed config (or null when you cancel): a small dialog per kind
//   blockTitle(cfg), BLOCK_ICON, blockChoices()  for heads and the "Add a widget" menu
//
// For Python readers: one small function per kind, picked from a dict (BODY[kind]), like a dispatch table.
import { h, modal, debounce } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { READY, paintAccent } from './modules.js';
import { nodeByPath, searchNodes, onNodesChange } from '../services/search.js';
import { BLOCKS, checkItems, checkText, cleanConfig } from '../services/widget-store.js';
import { nodeHref, nodeTitle, typeLabel, typeTile } from './node-view.js';
import { renderMarkdown } from './markdown.js';
import { pickNode } from './link-ui.js';
import { miniNet } from './net-view.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
export const BLOCK_ICON = { link: 'link', search: 'search', note: 'edit', check: 'check', net: 'net', countdown: 'target' };
export const blockTitle = (cfg) => cfg.title || t(`block.${cfg.kind}`);
export const blockChoices = () => BLOCKS.map((k) => ({ value: `block:${k}`, label: t(`block.${k}`), icon: BLOCK_ICON[k], detail: t(`block.${k}.hint`) }));
// a search typed in a link tile opens the command bar with it (shell.js listens)
export const searchFor = (q) => window.dispatchEvent(new CustomEvent('toollib:search', { detail: String(q) }));
const days = (date) => Math.round((new Date(`${date}T00:00:00`) - new Date(new Date().toDateString())) / 864e5);

const BODY = {
  // tiles to a tool, a node or a project, or a search
  link(cfg) {
    const lang = getLang();
    if (!cfg.items.length) return h('p', { class: 'muted small', text: t('block.link.empty') });
    return h('div', { class: 'block-links' }, cfg.items.map((it) => {
      if (it.t === 'tool') {
        const m = READY.find((x) => x.id === it.v);
        if (!m) return null;
        const tile = iconEl(m.icon, 'tile small');
        paintAccent(tile, m.id);
        return h('a', { class: 'block-link', href: m.href || `#/m/${m.id}` }, tile, h('span', { text: it.label || t(`module.${m.id}.name`) }));
      }
      if (it.t === 'node') {
        const d = nodeByPath(it.v);
        return h('a', { class: `block-link${d ? '' : ' gone'}`, href: nodeHref(it.v) }, typeTile(d?.type || 'note', 'small'), h('span', { text: it.label || (d ? nodeTitle(d, lang) : it.v) }));
      }
      const b = h('button', { type: 'button', class: 'block-link' }, iconEl('search', 'tile small'), h('span', { text: it.label || it.v }));
      b.addEventListener('click', () => searchFor(it.v));
      return b;
    }));
  },

  // a list from a search; it follows the knowledge (a new card that fits shows up)
  search(cfg) {
    const lang = getLang();
    const box = h('div', { class: 'block-search' });
    const draw = () => {
      const hits = cfg.q ? searchNodes(cfg.q, { limit: cfg.max, filter: (n) => n && !n.conflict && !(n.type === 'clip' && n.run) }) : [];
      box.replaceChildren(hits.length ? h('ul', { class: 'block-hits' }, hits.map((n) => h('li', {}, h('a', { class: 'block-hit', href: nodeHref(n.path) }, typeTile(n.type, 'small'),
        h('span', { class: 'block-hit-text' }, h('span', { class: 'block-hit-title', text: nodeTitle(n, lang) }), h('span', { class: 'muted small', text: typeLabel(n.type) }))))))
        : h('p', { class: 'muted small', text: cfg.q ? t('block.search.none', { q: cfg.q }) : t('block.search.empty') }));
    };
    draw();
    const stop = onNodesChange(() => { if (!box.isConnected) { stop(); return; } draw(); });
    return box;
  },

  // a few lines of Markdown: shown as text, a tap edits them
  note(cfg, api) {
    const box = h('div', { class: 'block-note' });
    let text = cfg.content || '';
    const view = () => {
      const shown = text.trim() ? renderMarkdown(text) : h('p', { class: 'muted small', text: t('block.note.empty') });
      const edit = h('button', { type: 'button', class: 'block-note-view', title: t('block.note.edit'), 'aria-label': t('block.note.edit') }, shown);
      edit.addEventListener('click', (e) => { if (!e.target.closest('a')) write(); });
      box.replaceChildren(edit);
    };
    const write = () => {
      const area = h('textarea', { class: 'field block-note-text', rows: String(Math.min(14, Math.max(4, text.split('\n').length + 1))), 'aria-label': t('block.note'), placeholder: t('block.note.placeholder') });
      area.value = text;
      const saved = h('span', { class: 'muted small' });
      const save = async () => { if (area.value === text) return; text = area.value; try { await api.saveContent(text); saved.textContent = t('research.saved'); } catch { saved.textContent = t('research.saveFailed'); } };
      const later = debounce(save, 1200);
      area.addEventListener('input', () => { saved.textContent = ''; later(); });
      area.addEventListener('blur', async () => { later.cancel?.(); await save(); view(); });
      area.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); area.blur(); } });
      box.replaceChildren(area, saved);
      area.focus();
    };
    view();
    return box;
  },

  // a checklist: tick, take away, add
  check(cfg, api) {
    let items = checkItems(cfg.content || '');
    const list = h('ul', { class: 'steps-list block-check' });
    const store = () => api.saveContent(checkText(items));
    const draw = () => {
      list.replaceChildren(...items.map((it, i) => {
        const box = h('input', { type: 'checkbox', checked: it.done ? true : null, 'aria-label': it.text });
        box.addEventListener('change', () => { items[i] = { ...it, done: box.checked }; store(); draw(); });
        const del = h('button', { type: 'button', class: 'icon-btn small step-del', title: t('action.remove'), 'aria-label': `${t('action.remove')}: ${it.text}`, html: icon('close') });
        del.addEventListener('click', () => { items = items.filter((_, j) => j !== i); store(); draw(); });
        return h('li', { class: it.done ? 'done' : '' }, h('label', {}, box, h('span', { text: it.text })), del);
      }));
    };
    draw();
    const input = h('input', { class: 'field step-input', type: 'text', placeholder: t('block.check.add'), 'aria-label': t('block.check.add'), enterkeyhint: 'done' });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      e.preventDefault();
      items = [...items, { done: false, text: input.value.trim() }];
      input.value = '';
      store();
      draw();
    });
    return h('div', { class: 'project-steps' }, list, input);
  },

  // a piece of the network around a node, or around the project in focus
  net(cfg, api) {
    const d = cfg.center ? nodeByPath(cfg.center) : api.focus;
    if (!d) return h('p', { class: 'muted small', text: t('block.net.none') });
    const net = miniNet(d, { depth: cfg.depth });
    return h('div', { class: 'block-net' }, net, h('p', { class: 'muted small', text: t('block.net.around', { title: nodeTitle(d, getLang()) }) }));
  },

  // the days until a date
  countdown(cfg) {
    if (!cfg.date) return h('p', { class: 'muted small', text: t('block.countdown.empty') });
    const n = days(cfg.date);
    const box = h('div', { class: `due${n <= 3 ? ' soon' : ''}` });
    box.append(h('div', { class: 'due-days' }, n === 0 ? h('b', { text: t('due.today') }) : [h('b', { text: String(Math.abs(n)) }), h('span', { text: t(n < 0 ? 'due.ago' : n === 1 ? 'due.day' : 'due.days') })]),
      h('p', { class: 'small', text: `${cfg.what ? `${cfg.what} · ` : ''}${new Date(`${cfg.date}T00:00:00`).toLocaleDateString(getLang() === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium' })}` }));
    return box;
  },
};

export const blockBody = (cfg, api) => BODY[cfg.kind]?.(cfg, api) || null;
export const blockHasContent = (cfg) => !!String(cfg.content || '').trim();

// ------------------------------------------------------------------ setting a block up
const field = (id, label, input) => h('label', { class: 'set-field', for: id }, h('span', { class: 'field-label', text: label }), input);

export async function editBlock(cfg0) {
  const cfg = { ...cleanConfig(cfg0) };
  const title = h('input', { class: 'field', id: 'block-title', type: 'text', value: cfg.title, placeholder: t(`block.${cfg.kind}`), maxlength: '80' });
  const parts = [field('block-title', t('block.title'), title)];
  let read = () => ({});
  if (cfg.kind === 'search') {
    const q = h('input', { class: 'field', id: 'block-q', type: 'search', value: cfg.q, placeholder: t('block.search.placeholder'), autocapitalize: 'off' });
    const max = h('input', { class: 'field', id: 'block-max', type: 'number', min: '1', max: '12', value: String(cfg.max) });
    parts.push(field('block-q', t('block.search.q'), q), field('block-max', t('block.search.max'), max));
    read = () => ({ q: q.value, max: Number(max.value) });
  } else if (cfg.kind === 'countdown') {
    const date = h('input', { class: 'field', id: 'block-date', type: 'date', value: cfg.date });
    const what = h('input', { class: 'field', id: 'block-what', type: 'text', value: cfg.what, placeholder: t('due.whatHint') });
    parts.push(field('block-date', t('due.date'), date), field('block-what', t('due.what'), what));
    read = () => ({ date: date.value, what: what.value });
  } else if (cfg.kind === 'net') {
    let center = cfg.center;
    const label = h('span', {});
    const show = () => { const d = center && nodeByPath(center); label.textContent = d ? nodeTitle(d, getLang()) : t('block.net.focus'); };
    show();
    const pick = h('button', { type: 'button', class: 'btn small' }, iconEl('search'), h('span', { text: t('block.net.pick') }));
    pick.addEventListener('click', async () => { const d = await pickNode({ title: t('block.net.pick') }); if (d) { center = d.path; show(); } });
    const clear = h('button', { type: 'button', class: 'btn small' }, iconEl('target'), h('span', { text: t('block.net.focus') }));
    clear.addEventListener('click', () => { center = ''; show(); });
    const depth = h('select', { class: 'field', id: 'block-depth' }, ...[1, 2].map((n) => h('option', { value: String(n), selected: cfg.depth === n ? true : null, text: t('block.net.depth', { n }) })));
    parts.push(h('div', { class: 'set-field' }, h('span', { class: 'field-label', text: t('block.net.center') }), label, h('div', { class: 'btn-row' }, pick, clear)), field('block-depth', t('net.depth'), depth));
    read = () => ({ center, depth: Number(depth.value) });
  } else if (cfg.kind === 'link') {
    let items = [...cfg.items];
    const list = h('ul', { class: 'block-link-edit' });
    const draw = () => list.replaceChildren(...(items.length ? items.map((it, i) => {
      const rm = h('button', { type: 'button', class: 'icon-btn small', title: t('action.remove'), 'aria-label': t('action.remove'), html: icon('close') });
      rm.addEventListener('click', () => { items = items.filter((_, j) => j !== i); draw(); });
      const name = it.t === 'tool' ? t(`module.${it.v}.name`) : it.t === 'node' ? (nodeByPath(it.v) ? nodeTitle(nodeByPath(it.v), getLang()) : it.v) : `“${it.v}”`;
      return h('li', {}, iconEl(it.t === 'tool' ? 'blocks' : it.t === 'node' ? 'file' : 'search'), h('span', { text: name }), rm);
    }) : [h('li', { class: 'muted small', text: t('block.link.empty') })]));
    draw();
    const tool = h('select', { class: 'field', 'aria-label': t('block.link.tool') }, h('option', { value: '', text: t('block.link.tool') }), ...READY.map((m) => h('option', { value: m.id, text: t(`module.${m.id}.name`) })));
    tool.addEventListener('change', () => { if (tool.value) { items.push({ t: 'tool', v: tool.value, label: '' }); tool.value = ''; draw(); } });
    const node = h('button', { type: 'button', class: 'btn small' }, iconEl('file'), h('span', { text: t('block.link.node') }));
    node.addEventListener('click', async () => { const d = await pickNode({ title: t('block.link.node') }); if (d) { items.push({ t: 'node', v: d.path, label: '' }); draw(); } });
    const q = h('input', { class: 'field', type: 'search', placeholder: t('block.link.search'), 'aria-label': t('block.link.search'), autocapitalize: 'off' });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && q.value.trim()) { e.preventDefault(); items.push({ t: 'search', v: q.value.trim(), label: '' }); q.value = ''; draw(); } });
    parts.push(list, h('div', { class: 'block-link-add' }, tool, node, q));
    read = () => ({ items: items.slice(0, 12) });
  }
  const ok = await modal({ title: t('block.setup', { kind: t(`block.${cfg.kind}`) }), body: h('div', { class: 'form block-form' }, ...parts),
    actions: [{ label: t('action.cancel'), value: null }, { label: t('action.save'), value: 'save', kind: 'primary' }] });
  if (ok !== 'save') return null;
  return cleanConfig({ ...cfg, title: title.value, ...read() });
}
