// Kobra in Toollib (0.11.0): die Bausteine kommen aus Toollibs Spickzettel, also aus dem Wissen auf diesem Gerät
// (Toollibs Speicher, gleiche Adresse). Suche nach Problem wie in Toollibs Befehlszeile; ein Tipp fügt den Code an
// der Schreibmarke ein. Ohne abgeglichenes Wissen gibt renderSpickzettel false zurück, dann zeigt Kobra seine eigenen.
// Texte bewusst deutsch wie der Rest von Kobra (später nach strings.json, siehe fundament.md „Später angleichen“).
import { allNodes, bestProblem, buildIndex, indexState, searchNodes } from '../../app/services/search.js';
import { getNode, runParts } from '../../app/services/nodes.js';
import { h } from './ui.js';
import { t as tr } from '../../app/i18n/i18n.js';

const groupNames = () => ({
  'control-flow': tr('kobra.group.flow'), 'functions-classes': tr('kobra.group.functions'), 'errors-files': tr('kobra.group.errors'), data: tr('kobra.group.data'),
  'data-structures': tr('kobra.group.structures'), numpy: 'NumPy', scipy: 'SciPy', matplotlib: 'Matplotlib', animation: tr('kobra.group.animation'),
  lattice: tr('kobra.group.lattice'), sympy: 'SymPy', debugging: tr('kobra.group.debugging'), threading: tr('kobra.group.threads'), gui: 'GUI',
  science: tr('kobra.group.science'), imports: tr('kobra.group.imports'),
});
const ORDER = Object.keys(groupNames());
const title = (d) => d.title_de || d.title;
let ready = null;

async function loadIndex() {
  if (!ready) ready = (async () => { if (!indexState().ready) await buildIndex(); return indexState().count > 0; })().catch(() => false);
  return ready;
}

// Python-Snippets (keine Terminal-Befehle wie git)
const isPython = (d) => d.type === 'snippet' && d.group !== 'git';

export async function renderSpickzettel(search, list, insert) {
  search.placeholder = tr('kobra.blocks.search');
  list.textContent = '';
  list.append(h('p', { class: 'muted small', text: tr('kobra.blocks.loading') }));
  if (!(await loadIndex())) { list.textContent = ''; return false; }
  const row = (d, q) => {
    const why = q ? bestProblem(d, q, 'de') : '';
    const b = h('button', { class: 'snippet', type: 'button' }, h('code', { text: title(d) }), h('span', { text: why ? tr('kobra.blocks.helpsWith', { why }) : (d.lead?.de || d.lead?.en || '') }));
    b.addEventListener('click', async () => {
      const code = runParts(await getNode(d.path)).code;
      if (code) insert(code);
    });
    const open = h('a', { class: 'snippet-open small', href: `#/n/${d.path.split('/').map(encodeURIComponent).join('/')}`, text: tr('kobra.blocks.inCheatsheet'), title: tr('kobra.blocks.inCheatsheetHint') });
    return h('div', { class: 'snippet-row' }, b, open);
  };
  const render = () => {
    const q = search.value.trim();
    list.textContent = '';
    if (q) {
      const hits = searchNodes(q, { limit: 24 }).filter(isPython);
      if (!hits.length) list.append(h('p', { class: 'muted small', text: tr('kobra.blocks.nothing') }));
      list.append(h('div', { class: 'snippet-grid one' }, hits.map((d) => row(d, q))));
      return;
    }
    const byGroup = new Map();
    for (const d of allNodes().filter(isPython)) {
      const g = d.group || 'science';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(d);
    }
    for (const g of [...ORDER, ...[...byGroup.keys()].filter((k) => !ORDER.includes(k))]) {
      const items = byGroup.get(g);
      if (!items?.length) continue;
      items.sort((a, b) => title(a).localeCompare(title(b), 'de'));
      list.append(h('h4', { text: groupNames()[g] || g }), h('div', { class: 'snippet-grid one' }, items.map((d) => row(d, ''))));
    }
  };
  search.addEventListener('input', render);
  render();
  return true;
}
