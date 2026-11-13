// Settings (0.25.0): a control centre and small pages instead of one long list.
//
//   #/settings            the control centre: how this device is connected (knowledge on GitHub, Mac helper, research,
//                         Kobra, Python, later the hub), drawn as a small network with a status light per link,
//                         and below it every page as a tile. A search finds any setting on any page.
//   #/settings/<page>     one page, e.g. #/settings/helper; on a wide screen the list of pages stays on the left.
//   #/settings/<card>     old addresses still work: #/settings/sync opens the page that holds the card with the id
//                         "settings-sync" and scrolls to it (other views and older notes link that way).
//
// A new page is one line in PAGES (and its texts settings.sec.<id> and settings.sec.<id>.hint in strings.json);
// its cards are functions in the files of this folder that return an element.
//
// For Python readers: PAGES is a list of dicts; `cards: (o) => [...]` is a lambda that builds the page's cards when
// the page is opened (o holds the callbacks the shell passes in: onChange, onCheckUpdate, onSync).
import { h } from '../../services/ui.js';
import { icon } from '../../services/icons.js';
import { t } from '../../i18n/i18n.js';
import { hasKeyboard } from '../../services/keys.js';
import { normalize } from '../../services/search.js';
import { colourVar } from '../colors.js';
import { connectionsMap } from './status.js';
import { languageCard, searchCard, aboutCard, planCard } from './general.js';
import { appearanceCard, accentsCard } from './look.js';
import { editorCard, commandsCard, macrosCard } from './write.js';
import { keysCard, keyboardCard } from './keys.js';
import { syncCard, syncBehaviourCard } from './knowledge.js';
import { researchCard, helperCard, researchSourcesCard, learnCard } from './research.js';
import { kobraCard } from './kobra.js';
import { pythonCard } from './python.js';
import { deviceCard } from './device.js';
import { backupCard } from './backup.js';

// group: where the tile stands in the control centre; colour: from the one colour system (colors.js);
// anchors: older section names that now live on this page
export const PAGES = [
  { id: 'general', icon: 'settings', group: 'app', colour: 'blue', cards: (o) => [languageCard(), searchCard(), aboutCard(o.onCheckUpdate)] },
  { id: 'look', icon: 'palette', group: 'app', colour: 'rose', cards: (o) => [appearanceCard(), accentsCard(o.onChange)] },
  { id: 'write', icon: 'pen', group: 'app', colour: 'violet', cards: () => [editorCard(), commandsCard(), macrosCard()] },
  { id: 'keys', icon: 'keyboard', group: 'app', colour: 'teal', keyboard: true, cards: () => [keysCard()] },
  { id: 'knowledge', icon: 'git', group: 'links', colour: 'green', anchors: ['access'], cards: (o) => [syncCard(o), syncBehaviourCard(o)] },
  { id: 'helper', icon: 'server', group: 'links', colour: 'orange', cards: () => [helperCard()] },
  { id: 'research', icon: 'search', group: 'links', colour: 'sky', cards: () => [researchCard(), researchSourcesCard(), learnCard()] },
  { id: 'kobra', icon: 'code', group: 'links', colour: 'yellow', cards: () => [kobraCard()] },
  { id: 'python', icon: 'py', group: 'device', colour: 'yellow', cards: () => [pythonCard()] },
  { id: 'device', icon: 'device', group: 'device', colour: 'slate', cards: (o) => [deviceCard(o), keyboardCard()] },
  { id: 'backup', icon: 'shield', group: 'device', colour: 'blue', cards: () => [backupCard()] },
  { id: 'plan', icon: 'list', group: 'device', colour: 'slate', cards: () => [planCard()] },
];
const GROUPS = ['links', 'app', 'device'];
const shown = () => PAGES.filter((p) => !p.keyboard || hasKeyboard());
export const pageById = (id) => PAGES.find((p) => p.id === id) || null;

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
function pageIcon(p, cls = '') {
  const el = iconEl(p.icon, `set-page-icon ${cls}`);
  el.style.setProperty('--pc', colourVar(p.colour));
  return el;
}

// Which page shows `id`: a page of that name, an older name (anchors), or the page holding the card #settings-<id>.
// The last one builds the pages in memory to look; that happens only for old addresses.
export function resolvePage(id, o = {}) {
  if (!id) return { page: null, card: '' };
  const direct = pageById(id) || PAGES.find((p) => (p.anchors || []).includes(id));
  if (direct) return { page: direct, card: direct.id === id ? '' : id };
  for (const p of shown()) {
    const box = h('div', {}, ...p.cards(o));
    if (box.querySelector(`#settings-${CSS.escape(id)}`)) return { page: p, card: id };
  }
  return { page: null, card: '' };
}

// The view. o: { onChange, onCheckUpdate, onSync, section } from the shell; section is the part after #/settings/.
export function renderSettings(main, o) {
  main.dataset.view = 'settings';
  const { page, card } = resolvePage(o.section, o);
  const wrap = h('div', { class: `settings${page ? ' on-page' : ' on-centre'}` });
  wrap.append(nav(page), h('div', { class: 'set-body' }, page ? pageView(page, o, card) : centre(main, o)));
  main.append(wrap);
}

// The list of pages on the left (wide screens) with the control centre at the top.
function nav(current) {
  const link = (href, iconNode, label, on, sec) => h('a', { href, class: `set-link${on ? ' on' : ''}`, dataset: { sec }, 'aria-current': on ? 'page' : null }, iconNode, h('span', { text: label }));
  const box = h('nav', { class: 'set-nav', 'aria-label': t('settings.title') },
    link('#/settings', iconEl('dot', 'set-page-icon centre'), t('control.title'), !current, 'centre'));
  for (const g of GROUPS) {
    const list = shown().filter((p) => p.group === g);
    box.append(h('div', { class: 'set-links' }, h('span', { class: 'set-group-label', text: t(`control.group.${g}`) }),
      ...list.map((p) => link(`#/settings/${p.id}`, pageIcon(p), t(`settings.sec.${p.id}`), current?.id === p.id, p.id))));
  }
  return box;
}

// One page: back to the control centre (on the phone), its head, its cards.
function pageView(p, o, card) {
  const box = h('section', { class: 'set-page set-sec', dataset: { sec: p.id }, id: `set-${p.id}` },
    h('a', { class: 'btn small set-back', href: '#/settings' }, iconEl('undo'), h('span', { text: t('control.back') })),
    h('header', { class: 'set-sec-head' }, pageIcon(p, 'big'),
      h('div', {}, h('h1', { class: 'set-sec-title view-title', text: t(`settings.sec.${p.id}`) }), h('p', { class: 'muted small', text: t(`settings.sec.${p.id}.hint`) }))),
    ...p.cards(o));
  if (card) {
    requestAnimationFrame(() => {
      const el = box.querySelector(`#settings-${CSS.escape(card)}`);
      if (!el) return;
      el.scrollIntoView({ block: 'start' });
      el.classList.add('set-flash');
      setTimeout(() => el.classList.remove('set-flash'), 1600);
    });
  }
  return box;
}

// The control centre: the connections as a small network, then every page as a tile, and the search.
function centre(main, o) {
  const box = h('div', { class: 'set-centre' });
  const search = h('input', { class: 'field set-search', type: 'search', id: 'settings-search', placeholder: t('settings.search'), 'aria-label': t('settings.search'), autocomplete: 'off' });
  const results = h('div', { class: 'set-results', hidden: true });
  const rest = h('div', { class: 'set-centre-rest' });
  box.append(h('header', { class: 'set-centre-head' }, h('h1', { class: 'view-title', text: t('settings.title') }), search), results, rest);

  const map = connectionsMap({ onOpen: (id) => { location.hash = `#/settings/${id}`; } });
  main.cleanup = map.stop;
  rest.append(h('section', { class: 'card set-map-card' }, h('h2', { text: t('control.links') }), h('p', { class: 'muted small', text: t('control.links.hint') }), map.el));
  for (const g of GROUPS) {
    const tiles = shown().filter((p) => p.group === g).map((p) => h('a', { class: 'set-tile', href: `#/settings/${p.id}`, dataset: { sec: p.id } },
      pageIcon(p), h('span', { class: 'set-tile-text' }, h('strong', { text: t(`settings.sec.${p.id}`) }), h('span', { class: 'muted small', text: t(`settings.sec.${p.id}.hint`) }))));
    rest.append(h('section', { class: 'set-group' }, h('h2', { class: 'set-group-title', text: t(`control.group.${g}`) }), h('div', { class: 'set-tiles' }, ...tiles)));
  }

  // search: every card on every page that holds all the words, under the name of its page
  let built = null;
  search.addEventListener('input', () => {
    const words = normalize(search.value.trim()).split(/\s+/).filter(Boolean);
    rest.hidden = words.length > 0;
    results.hidden = !words.length;
    if (!words.length) return;
    if (!built) built = shown().map((p) => ({ p, cards: p.cards(o) }));
    const out = [];
    for (const { p, cards } of built) {
      const hits = cards.filter((c) => {
        const hay = normalize(`${c.textContent} ${[...c.querySelectorAll('input')].map((i) => `${i.placeholder || ''} ${i.getAttribute('aria-label') || ''}`).join(' ')}`);
        return words.every((w) => hay.includes(w));
      });
      if (hits.length) out.push(h('section', { class: 'set-sec', dataset: { sec: p.id } },
        h('a', { class: 'set-sec-head set-result-head', href: `#/settings/${p.id}` }, pageIcon(p), h('h2', { class: 'set-sec-title', text: t(`settings.sec.${p.id}`) })), ...hits));
    }
    results.replaceChildren(...(out.length ? out : [h('p', { class: 'muted set-none', text: t('settings.search.none') })]));
  });
  return box;
}
