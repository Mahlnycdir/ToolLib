// The formula palette (0.17.0): every LaTeX command of the catalog with its picture, by group, found by command or by
// what it does ("Bruch", "Pfeil mit Text", "unsichtbar"). A tap puts it at the cursor (outside a formula in $ … $);
// "as its own formula" puts it in $$ … $$. Handy on the iPhone, where the backslash is far away.
import { h, modal } from '../services/ui.js';
import { t } from '../i18n/i18n.js';
import { normalize } from '../services/search.js';
import { typeset, ownMacros } from './math.js';
import { texCatalog, TEX_GROUPS, sampleOf } from './tex-catalog.js';

let lastGroup = 'structure';

export function openTexPalette(onPick, { inMath = false } = {}) {
  const own = Object.entries(ownMacros()).map(([label, expansion]) => ({ label, template: label, words: expansion, group: 'own' }));
  const all = [...texCatalog(), ...own];
  const search = h('input', { class: 'field tp-search', type: 'search', placeholder: t('palette.search'), 'aria-label': t('palette.search'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const display = h('label', { class: 'tp-display small' }, h('input', { type: 'checkbox', checked: null, disabled: inMath ? true : null }), h('span', { text: t('palette.display') }));
  const groups = h('div', { class: 'tp-groups chips', role: 'tablist' });
  const grid = h('div', { class: 'tp-grid', role: 'listbox' });
  const body = h('div', { class: 'tp' }, h('div', { class: 'tp-top' }, search, display), groups, grid);
  let close = () => {};

  const names = [...TEX_GROUPS, ...(own.length ? ['own'] : [])];
  function drawGroups() {
    groups.replaceChildren(...names.map((g) => h('button', {
      type: 'button', role: 'tab', class: `chip${g === lastGroup && !search.value.trim() ? ' on' : ''}`, 'aria-selected': String(g === lastGroup), text: t(`tex.group.${g}`),
      onclick: () => { lastGroup = g; search.value = ''; draw(); },
    })));
  }
  function draw() {
    drawGroups();
    const q = normalize(search.value.trim());
    const words = q.split(/\s+/).filter(Boolean);
    const hits = words.length
      ? all.filter((e) => { const hay = normalize(`${e.label} ${e.words}`); return words.every((w) => hay.includes(w)); }).slice(0, 120)
      : all.filter((e) => e.group === lastGroup);
    grid.replaceChildren(...(hits.length ? hits.map((e) => {
      const b = h('button', { type: 'button', class: 'tp-item', role: 'option', title: `${e.label}${e.words ? ` · ${e.words}` : ''}` },
        typeset(h('span', { class: 'tp-pic' }), sampleOf(e.template), false),
        h('code', { class: 'tp-cmd', text: e.label }));
      b.addEventListener('click', () => { close(); onPick(e, { display: !inMath && display.firstChild.checked }); });
      return b;
    }) : [h('p', { class: 'muted small', text: t('palette.none') })]));
  }
  search.addEventListener('input', draw);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); grid.querySelector('.tp-item')?.click(); } });
  draw();
  return modal({ title: t('palette.title'), body, actions: [], wide: true, onOpen: (content, c) => { close = () => c(null); setTimeout(() => search.focus(), 50); } });
}
