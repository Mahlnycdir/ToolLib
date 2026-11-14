// Connections you can see and make (0.25.0): the "Connections" part of the context panel beside every node, and the
// picker that draws a new connection from anywhere (button, command bar, later the network and the board).
//
// The facts come from services/relations.js; this file only shows them. The panel listens to onRelationsChange, so a
// connection made in another view, another window or brought by a sync shows here without reloading.
//
// For Python readers: h('div', { class: 'x' }, child1, child2) builds an HTML element, like a small template
// function; t('rel.title') looks up a text in app/i18n/strings.json in the language you chose.
import { h, toast, modal, debounce } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { nodeBySlug, searchNodes } from '../services/search.js';
import { connect, disconnect, isDrawn, onRelationsChange, relationsOf } from '../services/relations.js';
import { nodeHref, nodeTitle, typeLabel, typeTile } from './node-view.js';
import { isCard } from './formulary.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const SHOW = 6;   // rows per group before "n more"

// ------------------------------------------------------------------ picking a node
// A search over the whole knowledge; resolves with the chosen node (its summary) or null.
// exclude: slugs that cannot be chosen (the node itself, what it is linked to already).
export function pickNode({ title, exclude = new Set(), query = '' } = {}) {
  const lang = getLang();
  const input = h('input', { class: 'field rel-pick-input', type: 'search', value: query, placeholder: t('rel.pick.search'), 'aria-label': t('rel.pick.search'), autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go' });
  const list = h('ul', { class: 'members suggestions rel-pick-list', role: 'listbox' });
  let hits = [];
  let close = null;
  const draw = () => {
    const q = input.value.trim();
    hits = q ? searchNodes(q, { limit: 12, filter: (n) => n && !n.conflict && !exclude.has(n.slug) && !(n.type === 'clip' && n.run) }) : [];
    list.replaceChildren(...(hits.length ? hits.map((n, i) => {
      const row = h('li', { class: 'member rel-pick-row', role: 'option', dataset: { slug: n.slug } },
        h('button', { type: 'button', class: 'member-main rel-pick-btn', onclick: () => close?.(n) }, typeTile(n.type, 'small'),
          h('span', { class: 'member-text' }, h('span', { class: 'member-title', text: nodeTitle(n, lang) }), h('span', { class: 'muted small member-lead', text: typeLabel(n.type) }))));
      if (i === 0) row.classList.add('first');
      return row;
    }) : [h('li', { class: 'muted small', text: t(q ? 'rel.pick.none' : 'rel.pick.empty') })]));
  };
  input.addEventListener('input', debounce(draw, 120));
  // Enter takes the first hit, so linking with the keyboard is: type, Enter
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && hits[0]) { e.preventDefault(); close?.(hits[0]); } });
  draw();
  return modal({
    title, body: h('div', { class: 'project-suggest rel-pick' }, input, list), dismissValue: null,
    actions: [{ label: t('action.cancel'), value: null }],
    // focus at once (keys typed right after Alt+L land in the field, not on the page) and again once the dialog is in
    onOpen: (_content, c) => { close = c; input.focus(); setTimeout(() => input.focus(), 60); },
  });
}

// Draws a connection from node d to one you pick; tells what happened with a way back.
export async function linkFrom(d) {
  if (!d) return false;
  const has = new Set([d.slug, ...(d.links || [])]);
  const other = await pickNode({ title: t('rel.pick.title', { title: nodeTitle(d) }), exclude: has });
  if (!other) return false;
  const ok = await connect(d.slug, other.slug);
  if (ok) toast(t('rel.added', { title: nodeTitle(other) }), 'ok', 4000, { label: t('delete.undo'), run: () => disconnect(d.slug, other.slug) });
  return ok;
}

// ------------------------------------------------------------------ the panel
// "Points to" and "Linked from" with every kind of relation. A formula card shows its "follows from" and its
// conventions in its own text (formulary.js), so here they are left out for cards; for everything else they count.
// The other way round, what follows from a card ("leads to") is not written in the card: it stands here, first
// among "Linked from", marked "leads to" (0.27.1; until then a heading in the card's text).
export function relationsPanel(d) {
  const box = h('section', { class: 'ctx-rel', 'aria-live': 'polite' });
  const draw = () => {
    const now = nodeBySlug(d.slug) || d;
    const r = relationsOf(d.slug);
    const card = isCard(now);
    const skipOut = (x) => card && (x.kind === 'derived' || x.kind === 'convention');
    const skipIn = (x) => card && x.kind === 'convention';
    const out = r.out.filter((x) => !skipOut(x));
    // incoming "follows from" = this card leads to that one; those first
    const inn = r.in.filter((x) => !skipIn(x)).map((x) => (x.kind === 'derived' ? { ...x, kind: 'leadsTo' } : x))
      .sort((a, b) => (b.kind === 'leadsTo') - (a.kind === 'leadsTo'));
    const add = h('button', { type: 'button', class: 'btn small rel-add', title: t('rel.link.hint') }, iconEl('link'), h('span', { text: t('rel.link') }));
    add.addEventListener('click', () => linkFrom(nodeBySlug(d.slug) || d));
    const count = out.length + inn.length;
    box.replaceChildren(h('div', { class: 'ctx-rel-head' }, h('h3', {}, h('span', { text: t('rel.title') }), count ? h('span', { class: 'count', text: String(count) }) : ''), add));
    if (!count && !r.missing.length) box.append(h('p', { class: 'muted small rel-none', text: t('rel.none') }));
    if (out.length) box.append(group('rel.out', out, (x) => (isDrawn(d.slug, x.d.slug) ? x.d.slug : null), 'rel-out'));
    if (inn.length) box.append(group('rel.in', inn, null, 'rel-in ctx-back'));
    if (r.missing.length) {
      box.append(h('div', { class: 'rel-group rel-missing' }, h('h4', { text: t('rel.missing') }),
        h('div', { class: 'rel-chips' }, ...r.missing.slice(0, 12).map((s) => h('span', { class: 'chip muted', title: t('rel.missing.hint'), text: s })))));
    }
  };
  // one group: up to SHOW rows, the rest behind "n more"; removable(x) names the slug a row may let go of
  function group(key, list, removable, cls) {
    const lang = getLang();
    const rows = h('div', { class: 'related rel-list' });
    const row = (x) => {
      const kind = ['cite', 'page', 'derived', 'convention', 'leadsTo'].includes(x.kind) ? h('span', { class: `rel-kind k-${x.kind}`, text: t(`rel.kind.${x.kind}`) }) : null;
      const a = h('a', { class: 'related-link', href: nodeHref(x.d.path), title: typeLabel(x.d.type) }, typeTile(x.d.type, 'small'), h('span', { class: 'rel-title', text: nodeTitle(x.d, lang) }), kind);
      const target = removable?.(x);
      if (!target) return h('div', { class: 'rel-row' }, a);
      const rm = h('button', { type: 'button', class: 'chip-x rel-rm', title: t('rel.remove'), 'aria-label': `${t('rel.remove')}: ${nodeTitle(x.d, lang)}`, html: icon('close') });
      rm.addEventListener('click', async (e) => {
        e.preventDefault();
        const res = await disconnect(d.slug, target);
        if (res === true) toast(t('rel.removed'), 'ok', 4000, { label: t('delete.undo'), run: () => connect(d.slug, target) });
        else if (res === 'text') toast(t('rel.inText'), 'info');
      });
      return h('div', { class: 'rel-row' }, a, rm);
    };
    rows.append(...list.slice(0, SHOW).map(row));
    if (list.length > SHOW) {
      const more = h('button', { type: 'button', class: 'link-btn rel-more', text: t('rel.more', { n: list.length - SHOW }) });
      more.addEventListener('click', () => { more.remove(); rows.append(...list.slice(SHOW).map(row)); });
      rows.append(more);
    }
    return h('div', { class: `rel-group ${cls}` }, h('h4', { text: t(key) }), rows);
  }
  draw();
  // live: redraw when the relations change; stop once the panel is gone from the page
  const stop = onRelationsChange(() => { if (!box.isConnected) { stop(); return; } draw(); });
  return box;
}
