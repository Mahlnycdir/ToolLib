// The formulary (0.12.0): small linked cards on formulas, definitions, theorems and conventions, grouped in two
// levels. The area (area: physics, math, numerics …) is the first level, the topic (topic: anomalies …) the second.
// Every topic has an overview card (type: topic, file name = topic id) that links its cards in reading order.
// A card says what it follows from (derived_from) and which conventions it uses (conventions); "Leads to" is
// computed from the other cards. These fields are also the data for the network view that comes later.
import { h } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { allNodes, bestProblem, indexState, nodeBySlug, onIndexChange, searchNodes } from '../services/search.js';
import { linksOf } from '../services/nodes.js';
import { typeset } from './math.js';
import { inline } from './markdown.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

export const CARD_TYPES = new Set(['formula', 'definition', 'theorem', 'convention', 'term', 'topic']);
export const AREA_ORDER = ['physics', 'math', 'numerics', 'electronics'];
export const isCard = (d) => d && CARD_TYPES.has(d.type) && !d.conflict;
export const areaLabel = (a) => (t(`area.${a}`) === `area.${a}` ? a : t(`area.${a}`));

const hrefOf = (path) => `#/n/${path.split('/').map(encodeURIComponent).join('/')}`;
const titleIn = (d, lang = getLang()) => (lang === 'de' && d.title_de) || d.title || d.title_de || d.slug;
const leadIn = (d, lang = getLang()) => d.lead?.[lang] || d.lead?.en || '';
const byTitle = (a, b) => titleIn(a).localeCompare(titleIn(b));

// The overview card of a topic, and the label of a topic without one.
export const topicCard = (id) => {
  const d = nodeBySlug(id);
  return d && d.type === 'topic' ? d : null;
};
export const topicLabel = (id) => (topicCard(id) ? titleIn(topicCard(id)) : id);
export const membersOf = (id) => allNodes().filter((d) => isCard(d) && d.type !== 'topic' && d.topics.includes(id));

function link(d, lang) {
  return h('a', { class: 'related-link', href: hrefOf(d.path) },
    h('span', { class: `card-dot type-${d.type}`, 'aria-hidden': 'true' }),
    h('span', {}, h('span', { text: titleIn(d, lang) }), !d.verified ? h('span', { class: 'snip-open', text: t('cheatsheet.unverified') }) : null));
}
const linkList = (list, lang) => h('div', { class: 'related card-links' }, list.map((d) => link(d, lang)));

// ------------------------------------------------------------------ in the node view
// Chips under the title: the card's topics, each linking to its overview card.
export function topicChips(d) {
  return (d.topics || []).filter((id) => id !== d.slug).map((id) => {
    const tc = topicCard(id);
    return tc ? h('a', { class: 'chip chip-topic', href: hrefOf(tc.path), text: titleIn(tc) }) : h('span', { class: 'chip', text: id });
  });
}

// Slugs the node view should not list again under "Related".
export function shownElsewhere(node, d) {
  const out = new Set([...(d.derived || []), ...(d.conventions || [])]);
  if (d.type === 'topic') for (const s of linksOf({ meta: {}, body: node.body })) out.add(s);
  return out;
}

// Symbols, Follows from, Leads to, Conventions and, for a topic, the cards its text does not mention yet.
export function cardSections(node, d, lang = getLang()) {
  const out = [];
  const symbols = Array.isArray(node.meta.symbols) ? node.meta.symbols : [];
  if (symbols.length) {
    const rows = symbols.filter((s) => s && typeof s === 'object' && s.sym != null).map((s) => {
      const meaning = (lang === 'de' && s.de) || s.en || s.de || '';
      return h('tr', {},
        h('td', {}, typeset(h('span', { class: 'math-inline' }), String(s.sym), false)),
        h('td', {}, inline(String(meaning))),
        h('td', { class: 'muted' }, s.dim != null ? typeset(h('span', { class: 'math-inline' }), String(s.dim), false) : ''));
    });
    out.push(h('h2', { text: t('formulary.symbols') }), h('div', { class: 'table-wrap' }, h('table', { class: 'symbols' },
      h('thead', {}, h('tr', {}, h('th', { text: t('formulary.symbol') }), h('th', { text: t('formulary.meaning') }), h('th', { text: t('formulary.dim') }))),
      h('tbody', {}, rows))));
  }
  const from = (d.derived || []).map(nodeBySlug).filter(Boolean);
  if (from.length) out.push(h('h2', { class: 'follows-from', text: t('formulary.from') }), linkList(from, lang));
  const to = allNodes().filter((x) => isCard(x) && (x.derived || []).includes(d.slug)).sort(byTitle);
  if (to.length) out.push(h('h2', { class: 'leads-to', text: t('formulary.to') }), linkList(to, lang));
  const conv = (d.conventions || []).map(nodeBySlug).filter(Boolean);
  if (conv.length) out.push(h('h2', { class: 'uses-conventions', text: t('formulary.conventions') }), linkList(conv, lang));
  if (d.type === 'topic') {
    const named = new Set(linksOf({ meta: {}, body: node.body }));
    const rest = membersOf(d.slug).filter((x) => !named.has(x.slug)).sort(byTitle);
    if (rest.length) out.push(h('h2', { class: 'more-cards', text: t('formulary.more') }), linkList(rest, lang));
  }
  return out;
}

// ------------------------------------------------------------------ the module
export function renderFormulary(main, mod) {
  const head = h('div', { class: 'module-head' },
    iconEl(mod.icon, 'tile big'),
    h('div', {}, h('h1', { class: 'view-title', text: t(`module.${mod.id}.name`) }), h('p', { class: 'lead', text: t(`module.${mod.id}.desc`) })));
  const input = h('input', { class: 'field', type: 'search', placeholder: t('formulary.filter'), 'aria-label': t('formulary.filter'), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const count = h('p', { class: 'muted small formulary-count' });
  const list = h('div', { class: 'formulary' });
  main.append(head, h('div', { class: 'filter-row' }, iconEl('search'), input), count, list);

  const row = (d, lead, open = d.choices?.length) => h('a', { class: 'snip-row snip-main topic-row', href: hrefOf(d.path) },
    h('span', { class: 'snip-title' }, h('span', { text: titleIn(d) }),
      !d.verified && d.type !== 'topic' ? h('span', { class: 'snip-open', text: t('cheatsheet.unverified') }) : null,
      open ? h('span', { class: 'snip-choice', text: t('formulary.choiceOpen') }) : null),
    h('span', { class: 'snip-lead muted', text: lead }));

  // Open conventions (0.13.0): one row per convention with the cards that wait for it; the row opens the first.
  function openChoices(cards) {
    const byId = new Map();
    for (const d of cards) for (const c of d.choices || []) {
      if (!byId.has(c.id)) byId.set(c.id, { c, cards: [] });
      byId.get(c.id).cards.push(d);
    }
    return [...byId.values()];
  }
  const choiceSection = (open) => h('section', { class: 'card snip-card open-choices' },
    h('h2', {}, h('span', { class: 'icon', html: icon('vars') }), t('formulary.openChoices'), h('span', { class: 'count', text: String(open.length) })),
    h('p', { class: 'muted small', text: t('formulary.openChoices.hint') }),
    open.map(({ c, cards: list }) => {
      const sorted = [...list].sort(byTitle);
      return h('a', { class: 'snip-row snip-main topic-row', href: hrefOf(sorted[0].path) },
        h('span', { class: 'snip-title' }, h('span', { text: getLang() === 'de' ? c.de : c.en })),
        h('span', { class: 'snip-lead muted', text: `${t('formulary.cards', { n: sorted.length })}: ${sorted.map((d) => titleIn(d)).join(' · ')}` }));
    }));

  function draw() {
    const s = indexState();
    list.replaceChildren();
    if (!s.ready) { list.append(h('p', { class: 'muted', text: t('commandbar.indexing') })); return; }
    const cards = allNodes().filter(isCard);
    const plain = cards.filter((d) => d.type !== 'topic');
    const open = plain.filter((d) => !d.verified).length;
    const choices = openChoices(plain);
    count.textContent = t('formulary.count', { cards: plain.length, topics: cards.length - plain.length }) + (open ? ` · ${t('formulary.open', { open })}` : '')
      + (choices.length ? ` · ${t(choices.length === 1 ? 'formulary.choicesOne' : 'formulary.choices', { n: choices.length })}` : '');
    const q = input.value.trim();
    if (q) {
      const hits = searchNodes(q, { limit: 200, filter: isCard });
      list.append(hits.length ? h('div', { class: 'card snip-card' }, hits.map((d) => row(d, bestProblem(d, q, getLang()) ? t('commandbar.solves', { problem: bestProblem(d, q, getLang()) }) : leadIn(d))))
        : h('p', { class: 'muted', text: t('formulary.none') }));
      return;
    }
    if (!plain.length) { list.append(h('p', { class: 'muted', text: t('formulary.empty') })); return; }
    if (choices.length) list.append(choiceSection(choices));
    // Each card is listed under its first area; further areas are for the network view later.
    const primary = (d) => d.area[0] || 'other';
    const areas = [...new Set([...AREA_ORDER, ...cards.map(primary)])];
    for (const a of areas) {
      const inArea = cards.filter((d) => primary(d) === a);
      if (!inArea.length) continue;
      const topics = inArea.filter((d) => d.type === 'topic').sort((x, y) => (x.order ?? 999) - (y.order ?? 999) || byTitle(x, y));
      const covered = new Set(topics.map((d) => d.slug));
      const loose = inArea.filter((d) => d.type !== 'topic' && !d.topics.some((id) => covered.has(id) || topicCard(id))).sort(byTitle);
      const sec = h('section', { class: `card snip-card area-card area-${a}` },
        h('h2', {}, h('span', { class: 'area-dot', 'aria-hidden': 'true' }), areaLabel(a), h('span', { class: 'count', text: String(inArea.filter((d) => d.type !== 'topic').length) })));
      for (const tc of topics) sec.append(row(tc, `${t('formulary.cards', { n: membersOf(tc.slug).length })} · ${leadIn(tc)}`, membersOf(tc.slug).some((d) => d.choices?.length)));
      for (const d of loose) sec.append(row(d, leadIn(d)));
      list.append(sec);
    }
  }
  input.value = history.state?.formFilter || '';
  input.addEventListener('input', () => {
    try { history.replaceState({ ...(history.state || {}), formFilter: input.value }, ''); } catch { /* ignore */ }
    draw();
  });
  const stop = onIndexChange((s) => { if (!list.isConnected) stop(); else if (!s.building) draw(); });
  draw();
}
