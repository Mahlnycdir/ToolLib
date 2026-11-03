// Reading the knowledge: the view of one node and the Python cheatsheet with all snippets.
import { h, toast, copyText } from '../services/ui.js';
import { loadPref, savePref } from '../services/prefs.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { getNode, linksOf, localize, sourcesOf, summary, titleOf } from '../services/nodes.js';
import { allNodes, indexState, nodeByPath, nodeBySlug, onIndexChange, searchNodes } from '../services/search.js';
import { githubRepo, repoUrl } from '../services/sync.js';
import { paintAccent } from './modules.js';
import { renderMarkdown } from './markdown.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

// ------------------------------------------------------------------ kinds of nodes
const TYPE_ICON = {
  snippet: 'code', formula: 'vars', convention: 'outline', definition: 'book', term: 'book', theorem: 'book',
  rule: 'warn', part: 'chip', device: 'chip', pin_map: 'board', tool: 'wand', note: 'edit', project: 'folder',
  card: 'chalkboard', clip: 'globe', research: 'search',
};
const TYPE_ACCENT = { snippet: 'cheatsheet', part: 'parts', device: 'parts', rule: 'pins', pin_map: 'pins', card: 'workmode', clip: 'scraper', research: 'scraper' };
export const typeIcon = (type) => TYPE_ICON[type] || 'file';
export const typeAccent = (type) => TYPE_ACCENT[type] || 'shell';
export const typeLabel = (type) => (t(`type.${type}`) === `type.${type}` ? type : t(`type.${type}`));
export const groupLabel = (group) => (t(`group.${group}`) === `group.${group}` ? group : t(`group.${group}`));
export const GROUP_ORDER = ['control-flow', 'functions-classes', 'errors-files', 'data', 'gui', 'science', 'imports'];

export const nodeHref = (path) => `#/n/${path.split('/').map(encodeURIComponent).join('/')}`;
export const nodeTitle = (d, lang = getLang()) => titleOf(d, lang, d.slug);
export const nodeLead = (d, lang = getLang()) => d.lead?.[lang] || d.lead?.en || '';

export function typeTile(type, cls = '') {
  const tile = iconEl(typeIcon(type), `tile ${cls}`);
  paintAccent(tile, typeAccent(type));
  return tile;
}

export async function copyWithToast(text) {
  const ok = await copyText(text);
  toast(t(ok ? 'node.copied' : 'node.copyFailed'), ok ? 'ok' : 'error');
}

// ------------------------------------------------------------------ recently opened
export const recentPaths = () => loadPref('recent', []);
function pushRecent(path) {
  savePref('recent', [path, ...recentPaths().filter((p) => p !== path)].slice(0, 10));
}

// ------------------------------------------------------------------ node view
export async function renderNode(main, path, { isCurrent, go, onSync }) {
  const box = h('article', { class: 'node' });
  const back = h('button', { type: 'button', class: 'btn small back-btn', onclick: () => (history.length > 1 ? history.back() : go('#/home')) },
    iconEl('chevronLeft'), h('span', { text: t('action.back') }));
  box.append(back);
  main.append(box);

  const node = await getNode(path);
  if (!isCurrent()) return;
  if (!node) {
    box.append(h('h1', { class: 'view-title', text: t('node.notFound') }), h('p', { class: 'muted', text: t('node.notFound.hint') }),
      h('code', { class: 'path', text: path }));
    if (onSync) box.append(h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn primary', onclick: onSync }, iconEl('refresh'), h('span', { text: t('action.sync') }))));
    return;
  }
  pushRecent(path);
  const lang = getLang();
  const d = summary(node);
  const other = lang === 'de' ? (d.title_de && d.title !== d.title_de ? d.title : '') : d.title_de;

  // Head: kind, title, the title in the other language, status
  const chips = h('div', { class: 'node-chips' }, h('span', { class: 'chip', text: typeLabel(d.type) }));
  if (d.group) chips.append(h('span', { class: 'chip', text: groupLabel(d.group) }));
  for (const a of d.area) chips.append(h('span', { class: 'chip', text: a }));
  box.append(h('header', { class: 'node-head' },
    typeTile(d.type, 'big'),
    h('div', { class: 'node-titles' },
      h('h1', { class: 'view-title', text: nodeTitle(d, lang) }),
      other ? h('p', { class: 'muted other-title', text: other }) : null,
      chips)));

  if (!d.verified) {
    const who = t(`node.source.${d.source}`) === `node.source.${d.source}` ? d.source : t(`node.source.${d.source}`);
    box.append(h('div', { class: 'note unverified' }, iconEl('info'), h('p', { text: who ? t('node.unverifiedFrom', { who }) : t('node.unverified') })));
  }
  if (node.error) box.append(h('div', { class: 'note warn' }, iconEl('warn'), h('p', { text: t('node.yamlError', { error: node.error }) })));
  if (node.conflict) {
    const original = path.replace(/\.conflict-[a-z0-9-]+(\.[^./]+)?$/, '$1');
    box.append(h('div', { class: 'note warn' }, iconEl('warn'), h('p', {},
      t('node.conflictCopy'), ' ', h('a', { href: nodeHref(original), text: original }))));
  }

  if (d.type === 'snippet' && d.code) {
    box.append(h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn primary copy-main', onclick: () => copyWithToast(d.code) }, iconEl('copy'), h('span', { text: t('node.copyCode') }))));
  }

  // Body in the chosen language
  const onNodeLink = (slug) => {
    const target = nodeBySlug(slug);
    return target ? { href: nodeHref(target.path), label: nodeTitle(target, lang) } : null;
  };
  box.append(renderMarkdown(localize(node.body, lang), { onCopy: (text) => copyWithToast(text), onNodeLink }));

  // Related nodes
  const related = linksOf(node).map((slug) => nodeBySlug(slug)).filter((n) => n && n.path !== path);
  if (related.length) {
    box.append(h('h2', { text: t('node.related') }),
      h('div', { class: 'related' }, related.map((n) => h('a', { class: 'related-link', href: nodeHref(n.path) }, typeTile(n.type, 'small'), h('span', { text: nodeTitle(n, lang) })))));
  }

  // Sources with links and the exact place
  const sources = sourcesOf(node.meta);
  box.append(h('h2', { text: t('node.sources') }));
  if (sources.length) {
    box.append(h('ol', { class: 'sources' }, sources.map((s) => h('li', {},
      s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title }) : h('span', { text: s.title }),
      s.at ? h('span', { class: 'muted', text: ` · ${s.at}` }) : null))));
  } else {
    box.append(h('p', { class: 'muted small', text: t('node.noSources') }));
  }

  // Other names, file and GitHub
  const foot = h('footer', { class: 'node-foot' });
  if (d.aliases.length) foot.append(h('p', { class: 'muted small' }, h('span', { text: `${t('node.aliases')}: ` }), d.aliases.join(' · ')));
  if (d.tags.length) foot.append(h('p', { class: 'muted small' }, h('span', { text: `${t('node.tags')}: ` }), d.tags.join(' · ')));
  const gh = githubRepo(repoUrl());
  foot.append(h('p', { class: 'muted small' }, h('code', { class: 'path', text: path }),
    gh ? h('a', { class: 'gh-link', href: `https://github.com/${gh.owner}/${gh.name}/blob/HEAD/${path.split('/').map(encodeURIComponent).join('/')}`, target: '_blank', rel: 'noopener noreferrer', text: t('node.onGithub') }) : null));
  box.append(foot);
}

// ------------------------------------------------------------------ Python cheatsheet
export function renderCheatsheet(main, mod, { go }) {
  const head = h('div', { class: 'module-head' },
    iconEl(mod.icon, 'tile big'),
    h('div', {}, h('h1', { class: 'view-title', text: t(`module.${mod.id}.name`) }), h('p', { class: 'lead', text: t(`module.${mod.id}.desc`) })));
  const input = h('input', { class: 'field', type: 'search', placeholder: t('cheatsheet.filter'), 'aria-label': t('cheatsheet.filter'), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const list = h('div', { class: 'snippets' });
  main.append(head, h('div', { class: 'filter-row' }, iconEl('search'), input), list);

  const row = (d) => h('div', { class: 'snip-row' },
    h('a', { class: 'snip-main', href: nodeHref(d.path) },
      h('span', { class: 'snip-title', text: nodeTitle(d) }),
      h('span', { class: 'snip-lead muted', text: nodeLead(d) })),
    d.code ? h('button', { type: 'button', class: 'icon-btn', title: t('node.copyCode'), 'aria-label': `${t('node.copyCode')}: ${nodeTitle(d)}`, html: icon('copy'), onclick: () => copyWithToast(d.code) }) : null);

  function draw() {
    const s = indexState();
    list.replaceChildren();
    if (!s.ready) { list.append(h('p', { class: 'muted', text: t('commandbar.indexing') })); return; }
    if (!s.hasKnowledge) {
      list.append(h('div', { class: 'card' }, h('p', { class: 'muted', text: t('cheatsheet.noKnowledge') }),
        h('button', { type: 'button', class: 'btn primary', onclick: () => go('#/settings/sync') }, iconEl('settings'), h('span', { text: t('action.setup') }))));
      return;
    }
    const q = input.value.trim();
    if (q) {
      const hits = searchNodes(q, { limit: 200, filter: (d) => d?.type === 'snippet' });
      list.append(hits.length ? h('div', { class: 'card snip-card' }, hits.map(row)) : h('p', { class: 'muted', text: t('cheatsheet.none') }));
      return;
    }
    const snippets = allNodes().filter((d) => d.type === 'snippet' && !d.conflict);
    const groups = [...new Set([...GROUP_ORDER, ...snippets.map((d) => d.group || 'other')])];
    for (const g of groups) {
      const items = snippets.filter((d) => (d.group || 'other') === g).sort((a, b) => nodeTitle(a).localeCompare(nodeTitle(b)));
      if (!items.length) continue;
      list.append(h('section', { class: 'card snip-card' }, h('h2', {}, groupLabel(g), h('span', { class: 'count', text: String(items.length) })), items.map(row)));
    }
    if (!snippets.length) list.append(h('p', { class: 'muted', text: t('cheatsheet.none') }));
  }
  input.addEventListener('input', draw);
  const stop = onIndexChange((s) => { if (!list.isConnected) stop(); else if (!s.building) draw(); });
  draw();
}

// ------------------------------------------------------------------ recently opened, for Home
export function recentList() {
  const items = recentPaths().map((p) => nodeByPath(p)).filter(Boolean).slice(0, 6);
  if (!items.length) return null;
  return h('div', { class: 'recent' }, items.map((d) => h('a', { class: 'related-link', href: nodeHref(d.path) }, typeTile(d.type, 'small'), h('span', { text: nodeTitle(d) }))));
}
