// The library to browse (0.29.0, Etappe 4b). Four shelves that stay apart (ENTE: "übersichtlich voneinander
// getrennt"): Weiterlesen, Deine Texte, Dokumentationen, Papers & Funde, each as a row of book cards. The overview
// shows all four one below the other; a tab shows one shelf whole. A book opens where it belongs: a work in the
// reader, a text in the writing view, a documentation as its table of contents (the pages of the run as a tree).
// Above the shelves: a search over the titles and the projects as chips, so you see what one project reads.
// "Get a documentation" goes through a website (crawl.js), with suggestions (Python, NumPy, SciPy, Matplotlib, the
// Rust book) or your own address.
//
// For Python readers: the data comes from services/shelf.js as lists of dicts; this file only draws them. What you
// chose (tab, project, open documentation) lives in `st` while the app is open, so the reader comes back to it.
import { h } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { getLang, t } from '../i18n/i18n.js';
import { loadPref, savePref } from '../services/prefs.js';
import { indexState, onIndexChange, onNodesChange } from '../services/search.js';
import { DOC_SUGGESTIONS, READ_AT, continueItems, docByKey, docFor, docs, progressOf, texts, works } from '../services/shelf.js';
import { focusProject, projectLibrary, projects } from '../services/projects.js';
import { crawlDialog, crawlPanel, pageTree } from './crawl-view.js';
import { openWriting } from './library-home.js';
import { projectAccent } from './projects-view.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
export const SHELVES = ['continue', 'texts', 'docs', 'works'];
const SHELF_ICON = { continue: 'history', texts: 'file', docs: 'globe', works: 'book' };
const HERE = '#/m/shelf';
const ROW_MAX = 10;   // books per shelf in the overview

// Covers in fixed deep colours (white letters stay readable in light and dark), chosen by a name: the same work,
// website or author always gets the same cover.
const COVERS = ['#1f63e0', '#0b7bbd', '#0f8078', '#1e7e3a', '#c2410c', '#6d4aff', '#c0265e', '#4338ca', '#4d7c0f', '#9a3412', '#0e7490', '#475569'];
const coverOf = (text) => { let n = 0; for (const c of String(text)) n = (n * 31 + c.charCodeAt(0)) >>> 0; return COVERS[n % COVERS.length]; };
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

// what stays while the app is open (also while you read a page and come back)
const st = {
  tab: ['all', ...SHELVES].includes(loadPref('shelf.tab', 'all')) ? loadPref('shelf.tab', 'all') : 'all',
  project: String(loadPref('shelf.project', '') || ''),   // slug of the project the shelves show, '' = all
  filter: '',
  works: 'all',      // all | new | started | read
  doc: '',           // key of the documentation that is open
};
let panel = null;    // the progress of a run, in an open documentation (crawl-view.js crawlPanel)

// "vor 2 Stunden" / "2 hours ago"
function ago(ms) {
  if (!ms) return '';
  const s = (Date.now() - ms) / 1000;
  const lang = getLang() === 'de' ? 'de' : 'en';
  if (s < 60) return t('shelf.ago.now');
  try {
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
    if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
    if (s < 86400 * 30) return rtf.format(-Math.round(s / 86400), 'day');
  } catch { /* an old browser: the date below */ }
  return new Date(ms).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium' });
}
const byLine = (authors, year) => [authors.length ? `${authors[0]}${authors.length > 1 ? ' et al.' : ''}` : '', year].filter(Boolean).join(' · ');
const pagesText = (n) => t(n === 1 ? 'shelf.pages.one' : 'shelf.pages', { n });

// The name a documentation shows: yours, or the suggestion it came from when it still has the name of its address.
function docTitle(doc) {
  const plain = !doc.title || doc.title === doc.scope.replace(/\/$/, '');
  const sugg = plain ? DOC_SUGGESTIONS.find((s) => docFor(s, [doc])) : null;
  return sugg ? sugg.title : doc.title || doc.scope;
}

export function renderShelf(main, mod, { go }) {
  main.dataset.view = 'shelf';
  const root = h('div', { class: 'shelf' });
  const top = h('div', { class: 'shelf-top' });
  const tabs = h('div', { class: 'shelf-tabs segmented', role: 'tablist', 'aria-label': t('shelf.title') });
  const chips = h('div', { class: 'shelf-projects', role: 'group', 'aria-label': t('shelf.projects') });
  const filter = h('input', { class: 'field shelf-filter', type: 'search', placeholder: t('shelf.filter'), 'aria-label': t('shelf.filter'), value: st.filter, enterkeyhint: 'search', autocomplete: 'off' });
  const body = h('div', { class: 'shelf-body' });
  const head = h('div', { class: 'module-head' }, iconEl(mod.icon, 'tile big'),
    h('div', {}, h('h1', { class: 'view-title', text: t('module.shelf.name') }), h('p', { class: 'lead', text: t('shelf.lead') })));
  top.append(head, tabs, h('div', { class: 'shelf-filters' }, filter, chips));
  root.append(top, body);
  main.append(root);

  let timer = 0;
  filter.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { st.filter = filter.value.trim(); drawAll(); }, 160); });

  // ---------------------------------------------------------------- opening a book
  const readClip = (path) => { savePref('research.read', path); savePref('research.readFrom', HERE); go('#/m/scraper'); };
  async function openText(lib, page = '', project = null) {
    if (project) { await openWriting(project.path, { page, go, from: HERE }); return; }
    savePref('library.open', { path: lib, page, at: Date.now(), from: HERE });
    go('#/m/library');
  }
  const openDoc = (key) => { st.doc = key; drawAll(); main.scrollTop = 0; };
  async function fetchDoc(start) {
    const path = await crawlDialog({ start });
    if (!path || !root.isConnected) return;
    st.tab = 'docs';
    savePref('shelf.tab', st.tab);
    openDoc(path);
  }
  const setTab = (tab) => { st.tab = tab; savePref('shelf.tab', tab); st.doc = ''; drawAll(); };
  const setProject = (slug) => { st.project = st.project === slug ? '' : slug; savePref('shelf.project', st.project); drawAll(); };

  // ---------------------------------------------------------------- what the shelves hold
  function gather() {
    const docList = docs();
    const all = { docs: docList, texts: texts(), works: works(), continue: continueItems(12, docList) };
    const f = st.filter.toLowerCase();
    const inProject = (list) => !st.project || list.some((p) => p.slug === st.project);
    const said = (...xs) => !f || xs.join(' ').toLowerCase().includes(f);
    return {
      all,
      continue: all.continue.filter((x) => inProject(x.projects) && said(x.title, x.doc ? docTitle(x.doc) : '', x.lib?.title || '', (x.authors || []).join(' '))),
      texts: all.texts.filter((x) => inProject(x.project ? [x.project] : []) && said(x.title, x.project?.title || '')),
      docs: all.docs.filter((x) => inProject(x.projects) && said(docTitle(x), x.scope)),
      works: all.works.filter((x) => inProject(x.projects) && said(x.title, x.authors.join(' '), x.year)),
    };
  }

  // ---------------------------------------------------------------- one book
  // kind: text | doc | work; the cover is a button, the line below says how far you are and to which project it belongs
  function book({ kind, title, sub, cover, progress = null, done = false, state = '', projects: ps = [], open, label }) {
    const bar = progress == null ? null : h('span', { class: 'book-bar', 'aria-hidden': 'true' }, h('span', { style: { width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` } }));
    const coverBtn = h('button', { type: 'button', class: 'book-cover', style: { '--cv': cover }, 'aria-label': [label, title, sub, state].filter(Boolean).join(', ') },
      h('span', { class: 'book-kind', 'aria-hidden': 'true' }, iconEl(kind === 'doc' ? 'globe' : kind === 'text' ? 'edit' : 'book')),
      h('span', { class: 'book-title', text: title }),
      sub ? h('span', { class: 'book-sub', text: sub }) : null,
      bar);
    coverBtn.addEventListener('click', open);
    const tags = ps.slice(0, 2).map((p) => {
      const chip = h('button', { type: 'button', class: 'book-project', title: t('shelf.onlyProject', { project: p.title }) }, h('span', { class: 'book-dot', style: { background: projectAccent(p.slug).color } }), h('span', { text: p.title }));
      chip.addEventListener('click', () => setProject(p.slug));
      return chip;
    });
    if (ps.length > 2) tags.push(h('span', { class: 'muted small', text: `+${ps.length - 2}` }));
    return h('article', { class: `book book-${kind}${done ? ' done' : ''}` }, coverBtn,
      h('div', { class: 'book-meta' }, state ? h('span', { class: `book-state${done ? ' ok' : ''}`, text: state }) : null, ...tags));
  }
  const workState = (w) => (w.read ? t('shelf.state.read') : w.progress > 0 ? t('shelf.state.percent', { n: Math.round(w.progress * 100) }) : t('shelf.state.new'));

  const cards = {
    continue: (x) => {
      if (x.kind === 'write') {
        return book({
          kind: 'text', title: x.title, sub: x.project?.title || x.lib?.title || '', cover: x.project ? projectAccent(x.project.slug).color : coverOf(x.lib?.slug || x.title),
          state: `${t('shelf.kind.write')} · ${ago(x.at)}`, projects: x.projects, label: t('shelf.kind.write'),
          open: () => openText(x.lib?.path || '', x.path, x.project),
        });
      }
      const done = x.progress >= READ_AT;
      return book({
        kind: x.doc ? 'doc' : 'work', title: x.title, sub: x.doc ? docTitle(x.doc) : byLine(x.authors, x.year), cover: coverOf(x.doc ? x.doc.scope : (x.authors[0] || x.title)),
        progress: x.progress, done, state: `${done ? t('shelf.state.read') : t('shelf.state.percent', { n: Math.round(x.progress * 100) })} · ${ago(x.at)}`,
        projects: x.projects, label: t('shelf.kind.read'), open: () => readClip(x.path),
      });
    },
    texts: (x) => book({
      kind: 'text', title: x.title, sub: x.last ? t('shelf.lastWrote', { title: x.last.title }) : '', cover: x.project ? projectAccent(x.project.slug).color : coverOf(x.slug),
      state: [pagesText(x.pages), x.at ? ago(x.at) : ''].filter(Boolean).join(' · '), projects: x.project ? [x.project] : [],
      open: () => openText(x.path, x.last?.path || '', x.project),
    }),
    docs: (x) => book({
      kind: 'doc', title: docTitle(x), sub: x.scope.replace(/\/$/, ''), cover: coverOf(x.scope),
      progress: x.pages ? x.read / x.pages : 0, done: x.pages > 0 && x.read === x.pages,
      state: x.running ? t('shelf.doc.running') : t('shelf.docRead', { read: x.read, n: x.pages }), projects: x.projects,
      open: () => openDoc(x.key),
    }),
    works: (x) => book({
      kind: 'work', title: x.title, sub: byLine(x.authors, x.year) || hostOf(x.url), cover: coverOf(x.authors[0] || x.title),
      progress: x.read ? 1 : x.progress, done: x.read, state: workState(x), projects: x.projects,
      open: () => readClip(x.path),
    }),
  };

  // ---------------------------------------------------------------- the shelves
  function shelfHead(id, n, { more = false } = {}) {
    const tile = iconEl(SHELF_ICON[id], 'tile small');
    const titleEl = h('h2', { class: 'shelf-name' }, h('span', { text: t(`shelf.${id}`) }), h('span', { class: 'shelf-count', text: String(n) }));
    const all = more ? h('button', { type: 'button', class: 'link-btn small shelf-more', onclick: () => setTab(id) }, h('span', { text: t('shelf.showAll', { n }) }), iconEl('chevronRight')) : null;
    return h('header', { class: 'shelf-head' }, tile, h('div', { class: 'shelf-head-text' }, titleEl, h('p', { class: 'muted small', text: t(`shelf.${id}.hint`) })), all);
  }
  const emptyLine = (id, data) => h('p', { class: 'muted shelf-empty', text: data.all[id].length ? t('shelf.noMatch') : t(`shelf.empty.${id}`) });

  // the overview: the four shelves one below the other, each as a row
  function drawOverview(data) {
    for (const id of SHELVES) {
      const list = data[id];
      const sec = h('section', { class: `shelf-row shelf-${id}`, dataset: { shelf: id } }, shelfHead(id, list.length, { more: list.length > 0 }));
      if (list.length) sec.append(h('div', { class: 'books row' }, list.slice(0, ROW_MAX).map(cards[id])));
      else sec.append(emptyLine(id, data));
      if (id === 'docs' && !data.all.docs.length) sec.append(getPanel(data.all.docs, { compact: true }));
      if (id === 'texts') { const w = writeCard(data); if (w && !list.length) sec.append(h('div', { class: 'books row' }, w)); }
      body.append(sec);
    }
  }

  // one shelf, whole
  function drawShelf(id, data) {
    const list = data[id];
    const sec = h('section', { class: `shelf-row shelf-${id} whole`, dataset: { shelf: id } }, shelfHead(id, list.length));
    body.append(sec);
    if (id === 'works') { drawWorks(sec, data); return; }
    const grid = h('div', { class: 'books grid' }, list.map(cards[id]));
    if (id === 'texts') { const w = writeCard(data); if (w) grid.append(w); }
    sec.append(grid.childElementCount ? grid : emptyLine(id, data));
    if (id === 'docs') sec.append(getPanel(data.all.docs));
  }

  // Papers & Funde: new, started, read; without a project chosen, grouped by the project they belong to
  function drawWorks(sec, data) {
    const pick = { all: () => true, new: (w) => !w.read && !w.progress, started: (w) => !w.read && w.progress > 0, read: (w) => w.read };
    const seg = h('div', { class: 'segmented shelf-works-filter', role: 'group', 'aria-label': t('shelf.works') }, ['all', 'new', 'started', 'read'].map((k) => h('button', {
      type: 'button', class: st.works === k ? 'on' : '', 'aria-pressed': String(st.works === k),
      text: `${t(`shelf.works.${k}`)} ${data.works.filter(pick[k]).length}`,
      onclick: () => { st.works = k; drawAll(); },
    })));
    sec.append(seg);
    const list = data.works.filter(pick[st.works] || pick.all);
    if (!list.length) { sec.append(emptyLine('works', data)); return; }
    if (st.project) { sec.append(h('div', { class: 'books grid' }, list.map(cards.works))); return; }
    const groups = new Map();
    for (const w of list) {
      const key = w.projects[0]?.slug || '';
      if (!groups.has(key)) groups.set(key, { project: w.projects[0] || null, items: [] });
      groups.get(key).items.push(w);
    }
    const order = [...projects().map((p) => p.slug).filter((s) => groups.has(s)), ...(groups.has('') ? [''] : [])];
    for (const key of order) {
      const g = groups.get(key);
      sec.append(h('h3', { class: 'shelf-group' }, g.project ? h('span', { class: 'book-dot', style: { background: projectAccent(g.project.slug).color } }) : null,
        h('span', { text: g.project ? g.project.title : t('shelf.noProject') }), h('span', { class: 'shelf-count', text: String(g.items.length) })));
      sec.append(h('div', { class: 'books grid' }, g.items.map(cards.works)));
    }
  }

  // a blank book: writing in the project in focus, when it has no pages yet
  function writeCard() {
    const f = focusProject();
    if (!f || projectLibrary(f) || (st.project && st.project !== f.slug)) return null;
    const b = h('button', { type: 'button', class: 'book-cover book-new' }, iconEl('plus'), h('span', { class: 'book-title', text: t('shelf.write', { project: f.title }) }));
    b.addEventListener('click', () => openWriting(f.path, { go, from: HERE }));
    return h('article', { class: 'book book-text new' }, b);
  }

  // "Get a documentation": the suggestions, each marked when it already stands on the shelf, and your own address
  function getPanel(list, { compact = false } = {}) {
    const items = DOC_SUGGESTIONS.map((s) => {
      const have = docFor(s, list);
      const b = h('button', { type: 'button', class: `shelf-sugg${have ? ' have' : ''}`, dataset: { sugg: s.id } },
        iconEl(have ? 'check' : 'download'),
        h('span', { class: 'shelf-sugg-text' }, h('span', { class: 'shelf-sugg-title', text: s.title }), h('span', { class: 'muted small', text: hostOf(s.start) })),
        h('span', { class: `rs-tag${have ? ' ok' : ''}`, text: t(have ? 'shelf.get.have' : 'shelf.get.fetch') }));
      b.addEventListener('click', () => (have ? openDoc(have.key) : fetchDoc(s.start)));
      return b;
    });
    const own = h('button', { type: 'button', class: 'btn small shelf-own' }, iconEl('globe'), h('span', { text: t('shelf.get.own') }));
    own.addEventListener('click', () => fetchDoc(''));
    return h('div', { class: `shelf-get${compact ? ' compact' : ''}` },
      h('h3', { class: 'shelf-get-title' }, iconEl('download'), h('span', { text: t('shelf.get') })),
      h('p', { class: 'muted small', text: t('shelf.get.hint') }),
      h('div', { class: 'shelf-suggs' }, items), own);
  }

  // ---------------------------------------------------------------- an open documentation
  function drawDoc(doc) {
    const back = h('button', { type: 'button', class: 'btn small shelf-back', onclick: () => { st.doc = ''; drawAll(); } }, iconEl('chevronLeft'), h('span', { text: t('module.shelf.name') }));
    if (!doc) {
      // just started (the folder comes into the index a moment later) or gone
      body.append(h('div', { class: 'shelf-doc' }, back, h('p', { class: 'muted', text: indexState().building ? t('commandbar.indexing') : t('shelf.doc.gone') })));
      return;
    }
    const link = /^https:\/\//.test(doc.start) ? doc.start : `https://${doc.scope}`;
    const research = doc.folder ? h('button', { type: 'button', class: 'btn small', onclick: () => { savePref('research.showFolder', doc.folder.path); go('#/m/scraper'); } }, iconEl('globe'), h('span', { text: t('shelf.doc.inResearch') })) : null;
    const bar = h('div', { class: 'shelf-doc-bar' }, back, h('span', { class: 'spacer' }), research);
    const cover = h('span', { class: 'shelf-doc-cover', style: { '--cv': coverOf(doc.scope) }, 'aria-hidden': 'true' }, iconEl('globe'));
    const title = h('div', { class: 'shelf-doc-title' }, cover, h('div', {},
      h('h1', { class: 'view-title', text: docTitle(doc) }),
      h('a', { class: 'muted small shelf-doc-scope', href: link, target: '_blank', rel: 'noopener noreferrer', text: doc.scope.replace(/\/$/, '') })));
    const box = h('div', { class: 'shelf-doc', dataset: { doc: doc.key } }, bar, title);
    if (doc.folder) {
      if (panel?.folder !== doc.folder.path) { panel?.destroy(); panel = crawlPanel(doc.folder); } else panel.setFolder(doc.folder);
      box.append(panel.el);
    } else box.append(h('p', { class: 'muted small shelf-doc-lost', text: t('shelf.doc.lost') }));
    const share = doc.pages ? doc.read / doc.pages : 0;
    box.append(h('div', { class: 'shelf-doc-progress' }, h('span', { class: 'meter' }, h('span', { style: { width: `${Math.round(share * 100)}%` } })),
      h('span', { class: 'small', text: t('shelf.doc.progress', { read: doc.read, n: doc.pages }) })));
    // go on where you were, or begin at the start page
    const first = doc.clips.find((c) => c.url && doc.start && c.url.replace(/\/$/, '') === doc.start.replace(/\/$/, '')) || [...doc.clips].sort((a, b) => (a.url || '').length - (b.url || '').length)[0];
    const goOn = doc.last ? { path: doc.last.path, label: t('shelf.doc.continue', { title: doc.last.title }) } : first ? { path: first.path, label: t('shelf.doc.start') } : null;
    if (goOn) box.append(h('button', { type: 'button', class: 'btn primary shelf-doc-go', onclick: () => readClip(goOn.path) }, iconEl('book'), h('span', { text: goOn.label })));
    if (!doc.clips.length) box.append(h('p', { class: 'muted', text: t('crawl.noPages') }));
    else {
      const folder = doc.folder || { path: doc.key, crawl: { scope: doc.scope } };
      const badge = (d) => { const p = progressOf(d.path); return p >= READ_AT ? h('span', { class: 'rs-tag ok', text: t('shelf.state.read') }) : p > 0 ? h('span', { class: 'rs-tag', text: t('shelf.state.percent', { n: Math.round(p * 100) }) }) : null; };
      box.append(h('div', { class: 'shelf-toc' }, h('h2', { class: 'shelf-toc-title', text: t('shelf.doc.toc') }),
        pageTree(folder, doc.clips, { selected: doc.last?.path || '', onPick: (d) => readClip(d.path), onRead: (d) => readClip(d.path), badge })));
    }
    body.append(box);
  }

  // ---------------------------------------------------------------- drawing
  function drawTabs(data) {
    tabs.replaceChildren(...['all', ...SHELVES].map((id) => h('button', {
      type: 'button', role: 'tab', class: st.tab === id ? 'on' : '', 'aria-selected': String(st.tab === id), dataset: { tab: id },
      onclick: () => setTab(id),
    }, h('span', { text: t(id === 'all' ? 'shelf.tab.all' : `shelf.${id}`) }), id === 'all' ? null : h('span', { class: 'shelf-count', text: String(data[id].length) }))));
    // on the phone the row scrolls sideways: the chosen tab comes into view
    const on = tabs.querySelector('.on');
    if (on && (on.offsetLeft < tabs.scrollLeft || on.offsetLeft + on.offsetWidth > tabs.scrollLeft + tabs.clientWidth)) tabs.scrollLeft = Math.max(0, on.offsetLeft - 8);
  }
  function drawChips(data) {
    // the projects that have something on the shelves, the one in focus first
    const has = new Set([...data.all.docs.flatMap((d) => d.projects), ...data.all.works.flatMap((w) => w.projects), ...data.all.texts.map((x) => x.project).filter(Boolean)].map((p) => p.slug));
    const f = focusProject();
    const list = projects().filter((p) => has.has(p.slug) && (p.state !== 'done' || p.slug === st.project)).sort((a, b) => Number(b.slug === f?.slug) - Number(a.slug === f?.slug));
    if (st.project && !list.some((p) => p.slug === st.project)) { st.project = ''; savePref('shelf.project', ''); }
    chips.hidden = !list.length;
    chips.replaceChildren(
      h('button', { type: 'button', class: `chip shelf-chip${st.project ? '' : ' on'}`, 'aria-pressed': String(!st.project), onclick: () => { if (st.project) setProject(st.project); } }, h('span', { text: t('shelf.allProjects') })),
      ...list.map((p) => h('button', { type: 'button', class: `chip shelf-chip${st.project === p.slug ? ' on' : ''}`, 'aria-pressed': String(st.project === p.slug), dataset: { project: p.slug }, onclick: () => setProject(p.slug) },
        h('span', { class: 'book-dot', style: { background: projectAccent(p.slug).color } }), h('span', { text: p.title }))));
  }

  function drawAll() {
    if (!root.isConnected && body.childElementCount) return;
    // keep the height while the content is drawn again, so the page does not jump
    body.style.minHeight = `${body.offsetHeight}px`;
    body.replaceChildren();
    root.dataset.tab = st.doc ? 'doc' : st.tab;
    if (!indexState().ready) {
      top.hidden = false;
      tabs.replaceChildren();
      body.append(h('p', { class: 'muted', text: t('commandbar.indexing') }));
      body.style.minHeight = '';
      return;
    }
    if (st.doc) {
      top.hidden = true;
      drawDoc(docByKey(st.doc));
    } else {
      top.hidden = false;
      panel?.destroy();
      panel = null;
      const data = gather();
      drawTabs(data);
      drawChips(data);
      if (st.tab === 'all') drawOverview(data);
      else drawShelf(st.tab, data);
    }
    requestAnimationFrame(() => { body.style.minHeight = ''; });
  }

  // Knowledge changed (a sync, a run that brings pages, another window): draw again a moment later. The search field
  // keeps what you type; it is not drawn again.
  let later = 0;
  const soon = () => { clearTimeout(later); later = setTimeout(() => { if (root.isConnected) drawAll(); }, 700); };
  const offNodes = onNodesChange(() => { if (!root.isConnected) { offNodes(); offIndex(); return; } soon(); });
  const offIndex = onIndexChange((s) => { if (!root.isConnected) { offNodes(); offIndex(); return; } if (!s.building) soon(); });
  drawAll();
}
