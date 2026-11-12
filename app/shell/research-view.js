// The research window (0.14.0): left your research folders, in the middle the hits of a search or what a folder
// keeps, on the right the work you picked with all its versions and the notes of the folder. On the iPhone the three
// areas are tabs. "Own window" opens the same view alone (index.html?solo=1). "Read" (0.14.1) turns the whole window into the reader.
import { h, toast, copyText, debounce, loadPref, savePref, promptDialog, confirmDialog, modal } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { SOURCES, sourceById } from '../services/research-sources.js';
import { bestFree, rankWorks, parseQuery, webUrl } from '../services/research-merge.js';
import { canWebSearch, findVersions, hasFetcher, helperReady, helperState, researchSettings, setSourceOn, sourceOn, startSearch, webSearch } from '../services/research.js';
import { importInbox, onInbox, openOriginal } from '../services/pdf-inbox.js';
import {
  clipFor, clipsIn, createFolder, deleteClips, deleteFolder, folderNotes, folders, foldersWith, keepWork, looseClips, orphanPages, removeFromFolder, runPages,
  saveFolderNotes, updateClipVersions, workFromClip,
} from '../services/research-store.js';
import { mark } from '../services/trail.js';
import { LEARN_GROUPS, LEARN_SOURCES, learnOn, learnSearch, setLearnOn } from '../services/learn.js';
import { nodeByPath, onIndexChange } from '../services/search.js';
import { nodeHref } from './node-view.js';
import { renderMarkdown } from './markdown.js';
import { planFor } from '../services/reader.js';
import { mountReader } from './reader-view.js';
import { libraries, } from '../services/library-store.js';
import { mountLibrary } from './library-view.js';
import { createFromWork } from './card-dialog.js';
import { crawlState, onCrawl, pageWork, parseStart } from '../services/crawl.js';
import { crawlDialog, crawlPanel, pageTree } from './crawl-view.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const solo = () => new URLSearchParams(location.search).has('solo');
const narrow = () => window.matchMedia('(max-width: 759px)').matches;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// What stays while the app is open, also when you look at something else in between.
const st = {
  query: loadPref('research.query', ''),
  result: null,          // { query, works, status, finished }
  search: null,          // the running search
  selected: null,        // key of the work on the right
  extra: new Map(),      // key -> work with more versions found later
  kept: null,            // work of a kept clip on the right
  folder: loadPref('research.folder', ''),
  list: 'hits',          // hits | kept
  pane: 'results',       // folders | results | detail (iPhone)
  onlyFree: loadPref('research.onlyFree', false),
  kind: loadPref('research.kind', 'all'),
  sort: loadPref('research.sort', 'relevance'),
  versions: new Map(),   // key -> 'busy' | { added, failed }
  read: null,            // { work, version }: the reader is open
  lib: null,             // { path, page, at }: your library is open (0.14.2), kept in library.open
  libSeen: 0,
  address: '',           // an address in the search field (0.14.3): go through the website or read the page
  web: null,             // the same search on the web through SearXNG (0.14.4): { query, state, results, error }
  mode: loadPref('research.mode', 'learn'),   // learn | papers (0.15.1): what a search of words looks for first
  learn: null,           // { query, groups, finished }: the search for learning
  learnSearch: null,
  webPdf: new Map(),     // key of a work -> { state, results }: "Search the web for a PDF"
};
let view = null;         // the mounted view: { root, draw* }
let panel = null;        // the panel of the crawl folder that is open (0.14.3)
let inboxLine = '';      // what the last look into the PDF inbox found (0.14.4)

// The original of a clip in your PDF folder on the Mac (0.14.4), through the Mac helper.
export function originalButton(d) {
  const b = h('button', { type: 'button', class: 'btn small rs-original', title: t('inbox.original.hint') }, iconEl('file'), h('span', { text: t('inbox.original') }));
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!(await openOriginal(d.file, d.fileSha1))) toast(t('inbox.originalFailed'), 'warn', 5000);
  });
  return b;
}
onInbox((x) => { if (!x.busy && view?.root.isConnected && (x.added || x.known)) view.drawAll(); });

const KIND_LABEL = { published: 'research.kind.published', accepted: 'research.kind.accepted', preprint: 'research.kind.preprint', other: 'research.kind.other' };
// Why a source did not answer, in words for this source when there are any ("DOAB refuses servers").
export function errorText(id, code, status = '') {
  const own = `research.err.${code}.${id}`;
  const text = t(own, { status: status || '' });
  return (text !== own ? text : t(`research.err.${code}`, { status: status || '' })).replace(/\s+/g, ' ').trim();
}
export const versionLabel = (v) => `${t(KIND_LABEL[v.kind] || KIND_LABEL.other)} · ${t(v.free ? 'research.free' : 'research.paid')}`;
const LEARN_ICON = { overview: 'globe', intro: 'sparkle', books: 'book', courses: 'list', practice: 'code', web: 'search' };
const authorLine = (a, n = 3) => (a.length > n ? `${a.slice(0, n).join(', ')} ${t('research.etal')}` : a.join(', '));
const currentFolder = () => folders().find((f) => f.path === st.folder) || null;
const workOf = (w) => st.extra.get(w.key) || w;

function shownWorks() {
  if (!st.result) return [];
  const works = st.result.works.map(workOf);
  return rankWorks(works, st.result.query, { sort: st.sort }).filter((w) => {
    if (st.onlyFree && !w.free) return false;
    if (st.kind === 'articles') return w.type === 'article' || w.type === 'other';
    if (st.kind === 'books') return w.type === 'book' || w.type === 'chapter';
    if (st.kind === 'preprints') return w.versions.some((v) => v.kind === 'preprint');
    return true;
  });
}
const learnWorks = () => (st.learn ? LEARN_GROUPS.flatMap((g) => st.learn.groups[g]?.works || []) : []);
const selectedWork = () => {
  if (st.kept) return st.kept;
  const w = st.result?.works.find((x) => x.key === st.selected) || (st.mode === 'learn' ? learnWorks().find((x) => x.key === st.selected) : null);
  return w ? workOf(w) : null;
};
// A search of words in learning mode; a DOI, an arXiv id and the like always look for papers.
const learning = () => st.mode === 'learn' && (!st.query || parseQuery(st.query).kind === 'text');

// ------------------------------------------------------------------ the view
export function renderResearch(main) {
  main.dataset.view = 'research';
  const root = h('div', { class: 'rs', dataset: { pane: st.pane, mode: st.read ? 'read' : '' } });
  const tabs = h('div', { class: 'rs-tabs segmented', role: 'tablist' });
  const left = h('aside', { class: 'rs-folders', 'aria-label': t('research.folders') });
  const mid = h('section', { class: 'rs-results', 'aria-label': t('research.results') });
  const right = h('section', { class: 'rs-detail', 'aria-label': t('research.details') });
  const readerHost = h('div', { class: 'rs-reader' });
  const libHost = h('div', { class: 'rs-library' });
  root.append(tabs, left, mid, right, readerHost, libHost);
  main.append(root);

  // search bar
  const input = h('input', {
    class: 'field rs-input', type: 'search', enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: t('research.placeholder'), 'aria-label': t('research.placeholder'), value: st.query,
  });
  const go = h('button', { type: 'submit', class: 'btn primary rs-go' }, iconEl('search'), h('span', { text: t('research.search') }));
  const form = h('form', { class: 'rs-search', role: 'search' }, input, go);
  // Learn or papers (0.15.1): learning asks for overviews, introductions, books, courses and code; papers asks the
  // seven paper sources. The choice stays; switching runs the same words in the other way.
  const modes = h('div', { class: 'segmented small rs-mode', role: 'group', 'aria-label': t('research.mode') });
  const drawModes = () => modes.replaceChildren(...['learn', 'papers'].map((m) => {
    const b = h('button', { type: 'button', class: st.mode === m ? 'on' : '', 'aria-pressed': String(st.mode === m), dataset: { mode: m } }, iconEl(m === 'learn' ? 'sparkle' : 'file'), h('span', { text: t(`research.mode.${m}`) }));
    b.addEventListener('click', () => {
      if (st.mode === m) return;
      st.mode = m;
      savePref('research.mode', m);
      drawModes();
      st.selected = null;
      if (st.query) run(st.query, { keep: true }); else view.drawAll();
    });
    return b;
  }));
  drawModes();
  form.addEventListener('submit', (e) => { e.preventDefault(); run(input.value); input.blur(); });
  const filters = h('div', { class: 'rs-filters' });
  const sources = h('div', { class: 'rs-sources', 'aria-live': 'polite' });
  const notice = h('div', { class: 'rs-notice' });
  const switcher = h('div', { class: 'segmented rs-switch', role: 'group' });
  const list = h('ol', { class: 'rs-list' });
  // on the phone the filters and the sources stay folded away until you ask for them (0.15.0)
  const moreBtn = h('button', { type: 'button', class: 'btn small rs-more-btn', 'aria-expanded': 'false' }, iconEl('format'), h('span', { text: t('research.more.filters') }));
  moreBtn.addEventListener('click', () => { const on = mid.classList.toggle('more'); moreBtn.setAttribute('aria-expanded', String(on)); });
  const keysHint = h('span', { class: 'rs-keys muted small', text: t('research.keys') });
  mid.append(modes, form, h('div', { class: 'rs-switch-row' }, switcher, moreBtn, keysHint), filters, sources, notice, list);
  // Going through the hits with the keyboard (0.15.1): ↑↓ or j/k move, Enter shows the details, L reads, M keeps.
  root.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.modal-backdrop, .sheet-backdrop')) return;
    const rows = [...list.querySelectorAll('.rs-hit')];
    if (!rows.length) return;
    const focusRow = (i) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      r.querySelector('button.rs-hit-main, a.rs-hit-title')?.focus();
      r.scrollIntoView({ block: 'nearest' });
    };
    if (e.target === input) { if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(0); } return; }
    if (e.target.matches('input, textarea, select, [contenteditable]')) return;
    const cur = rows.findIndex((r) => r.contains(document.activeElement));
    const key = e.key.toLowerCase();
    if (e.key === 'ArrowDown' || key === 'j') { e.preventDefault(); focusRow(cur + 1); return; }
    if (e.key === 'ArrowUp' || key === 'k') { e.preventDefault(); if (cur <= 0) input.focus(); else focusRow(cur - 1); return; }
    if (cur < 0) return;
    const row = rows[cur];
    if (key === 'l') {
      e.preventDefault();
      const web = row.querySelector('.rs-web-read');
      if (web) { web.click(); return; }
      const w = [...(st.result?.works || []), ...learnWorks()].find((x) => x.key === row.dataset.key);
      if (w) { st.kept = null; st.selected = w.key; openReader(workOf(w)); }
    } else if (key === 'm') {
      e.preventDefault();
      row.querySelector('.rs-keep-quick, .rs-web-keep')?.click();
    }
  });

  view = {
    root, input,
    drawAll() { drawTabs(); drawFolders(); drawFilters(); drawSwitch(); drawSources(); drawNotice(); drawList(); drawDetail(); },
    drawList: () => drawList(),
    drawFolders: () => drawFolders(),
    folderPath: () => st.folder,
    listMode: () => st.list,
  };

  function setPane(p) { st.pane = p; root.dataset.pane = p; drawTabs(); }

  // ---------------------------------------------------------------- the reader (0.14.1)
  let reading = null;
  function showReader() {
    reading?.destroy();
    reading = null;
    readerHost.replaceChildren();
    applyMode();
    if (!st.read) return;
    const { work, version } = st.read;
    reading = mountReader(readerHost, {
      work, version, folderPath: st.folder, query: st.result?.query.text || st.query || '',
      onBack: closeReader,
      onSearch: async (term) => { await closeReader(); input.value = term; run(term); },
      // a link to another page you went through (0.14.3) opens that page here
      onOpenClip: async (path) => {
        const next = await workFromClip(path).catch(() => null);
        if (next) { st.kept = next; st.selected = null; openReader(next); }
      },
      onChange: () => { if (view?.root.isConnected) drawList(); },
    });
  }
  async function closeReader() {
    const clipPath = st.read?.work.clip?.path || (st.read && clipFor(st.read.work)?.path) || '';
    if (clipPath) mark('read', { path: clipPath, title: st.read.work.title });
    st.read = null;
    showReader();
    if (st.kept?.clip && clipPath === st.kept.clip.path) { try { st.kept = await workFromClip(clipPath) || st.kept; } catch { /* keep what is shown */ } }
    view.drawAll();
  }
  function openReader(work, version = null) {
    const kept = work.clip?.path || clipFor(work)?.path;
    if (kept) mark('read', { path: kept, title: work.title });
    st.read = { work, version };
    showReader();
  }

  // ---------------------------------------------------------------- your library (0.14.2)
  let library = null;
  function applyMode() {
    root.dataset.mode = st.read ? 'read' : st.lib ? 'lib' : '';
    const want = st.lib && !st.read ? st.lib.path : '';
    if (library && library.key !== want) { library.destroy(); library = null; libHost.replaceChildren(); }
    if (want && !library) {
      library = mountLibrary(libHost, {
        path: st.lib.path, page: st.lib.page || '',
        onBack: () => closeLibrary(),
        onRead: async (clipPath) => {
          const work = await workFromClip(clipPath).catch(() => null);
          if (!work) return;
          st.lib = { ...st.lib, ...(loadPref('library.open', null) || {}) };
          st.kept = work; st.selected = null;
          openReader(work);
        },
      });
      library.key = want;
    }
  }
  function openLibrary(path, page = '') {
    savePref('library.open', { path, page, at: Date.now() });
    location.hash = '#/m/library';
  }
  function closeLibrary() {
    st.lib = null;
    savePref('library.open', null);
    applyMode();
    view.drawAll();
  }
  // A clip node hands over its path ("Read" there): open the reader on it here.
  async function readQueued() {
    const path = loadPref('research.read', '');
    if (!path) return;
    savePref('research.read', '');
    try {
      const work = await workFromClip(path);
      if (work) { st.kept = work; st.selected = null; openReader(work); view.drawAll(); }
    } catch (e) { console.warn('Could not open the reader', e); }
  }

  function drawTabs() {
    const sel = selectedWork();
    tabs.replaceChildren(...[['folders', 'research.tab.folders'], ['results', 'research.tab.results'], ['detail', 'research.tab.detail']].map(([id, key]) => h('button', {
      type: 'button', role: 'tab', class: st.pane === id ? 'on' : '', 'aria-selected': String(st.pane === id),
      disabled: id === 'detail' && !sel && !currentFolder() ? true : null, text: t(key), onclick: () => setPane(id),
    })));
  }

  // ---------------------------------------------------------------- folders
  function drawFolders() {
    const all = folders();
    const add = h('button', { type: 'button', class: 'icon-btn', title: t('research.folder.new'), 'aria-label': t('research.folder.new'), html: icon('plus') });
    add.addEventListener('click', async () => {
      const path = await newFolder(st.query);
      if (path) { st.folder = path; savePref('research.folder', path); st.list = 'kept'; view.drawAll(); }
    });
    const crawlBtn = h('button', { type: 'button', class: 'icon-btn rs-crawl-new', title: t('crawl.title'), 'aria-label': t('crawl.title'), html: icon('globe') });
    crawlBtn.addEventListener('click', () => openCrawl(''));
    const items = h('ul', { class: 'rs-folder-list' });
    for (const f of all) {
      const on = f.path === st.folder;
      const running = f.crawl && (crawlState(f.path)?.status === 'running' || (f.crawl.on === 'mac' && f.crawl.state === 'running'));
      const b = h('button', { type: 'button', class: `rs-folder${on ? ' on' : ''}${f.crawl ? ' crawl' : ''}`, 'aria-current': on ? 'true' : null },
        iconEl(running ? 'refresh' : f.crawl ? 'globe' : f.pdfInbox ? 'download' : on ? 'folderOpen' : 'folder', running ? 'spin' : ''), h('span', { class: 'rs-folder-name', text: f.title }), h('span', { class: 'rs-count', text: String(f.clips.length) }));
      b.addEventListener('click', () => {
        st.folder = on ? '' : f.path;
        savePref('research.folder', st.folder);
        st.list = on ? 'hits' : 'kept';
        st.kept = null;
        view.drawAll();
        if (!on && narrow()) setPane('results');
      });
      items.append(h('li', {}, b));
    }
    // works you kept without a folder, and pages left over from deleted runs
    const loose = looseClips();
    if (loose.length) {
      const on = !st.folder && st.list === 'kept';
      const b = h('button', { type: 'button', class: `rs-folder rs-loose${on ? ' on' : ''}`, 'aria-current': on ? 'true' : null },
        iconEl('inbox'), h('span', { class: 'rs-folder-name', text: t('research.loose') }), h('span', { class: 'rs-count', text: String(loose.length) }));
      b.addEventListener('click', () => {
        st.folder = ''; savePref('research.folder', '');
        st.list = on ? 'hits' : 'kept'; st.kept = null;
        view.drawAll();
        if (!on && narrow()) setPane('results');
      });
      items.append(h('li', {}, b));
    }
    // your libraries moved into a tool of their own (0.15.1); the research window is for finding and reading
    left.replaceChildren(
      h('div', { class: 'rs-head' }, h('h2', { text: t('research.folders') }), h('div', { class: 'rs-head-btns' }, crawlBtn, add)),
      all.length || loose.length ? items : h('p', { class: 'muted small', text: t('research.folder.none') }),
      h('div', { class: 'rs-left-foot' },
        !solo() && !isIos() && !narrow() ? h('button', { type: 'button', class: 'btn small', onclick: openWindow }, iconEl('window'), h('span', { text: t('research.ownWindow') })) : null,
        h('a', { class: 'small', href: '#/settings/research', text: t('research.settings') })));
  }

  // ---------------------------------------------------------------- filters and the switch hits / kept
  function drawFilters() {
    const free = h('label', { class: 'rs-check' }, h('input', { type: 'checkbox', checked: st.onlyFree ? true : null }), h('span', { text: t('research.onlyFree') }));
    free.firstChild.addEventListener('change', (e) => { st.onlyFree = e.target.checked; savePref('research.onlyFree', st.onlyFree); drawList(); });
    const select = (key, value, options, onChange) => {
      const s = h('select', { class: 'field small', 'aria-label': t(key) }, options.map(([v, k]) => h('option', { value: v, selected: v === value ? true : null, text: t(k) })));
      s.addEventListener('change', () => onChange(s.value));
      return h('label', { class: 'rs-select' }, h('span', { class: 'muted small', text: t(key) }), s);
    };
    filters.replaceChildren(free,
      select('research.kindFilter', st.kind, [['all', 'research.kind.all'], ['articles', 'research.kind.articles'], ['books', 'research.kind.books'], ['preprints', 'research.kind.preprints']],
        (v) => { st.kind = v; savePref('research.kind', v); drawList(); }),
      select('research.sort', st.sort, [['relevance', 'research.sort.relevance'], ['year', 'research.sort.year'], ['cited', 'research.sort.cited']],
        (v) => { st.sort = v; savePref('research.sort', v); drawList(); }));
  }

  function drawSwitch() {
    const f = currentFolder();
    const n = learning() ? learnCount() : st.result ? shownWorks().length : 0;
    mid.dataset.mode = learning() ? 'learn' : 'papers';
    const loose = f ? 0 : looseClips().length;
    mid.dataset.list = st.list;
    switcher.replaceChildren(
      h('button', { type: 'button', class: st.list === 'hits' ? 'on' : '', 'aria-pressed': String(st.list === 'hits'), text: (learning() ? st.learn : st.result) ? t('research.hits', { n }) : t('research.hitsNone'), onclick: () => { st.list = 'hits'; drawAll2(); } }),
      h('button', { type: 'button', class: st.list === 'kept' ? 'on' : '', disabled: f || loose ? null : true, 'aria-pressed': String(st.list === 'kept'), text: f ? t('research.kept', { n: f.clips.length }) : loose ? `${t('research.loose')} (${loose})` : t('research.keptNone'), onclick: () => { st.list = 'kept'; drawAll2(); drawFolders(); } }));
  }
  const drawAll2 = () => { drawSwitch(); drawSources(); drawNotice(); drawList(); };

  // ---------------------------------------------------------------- sources and what they answered
  function drawSources() {
    sources.hidden = st.list !== 'hits';
    const s = researchSettings();
    sources.replaceChildren(...SOURCES.map((src) => {
      const on = sourceOn(src.id, s);
      const stat = st.result?.status?.[src.id];
      let state = on ? 'idle' : 'off';
      let text = '';
      if (on && stat) {
        state = stat.state;
        if (stat.state === 'ok') text = String(stat.n);
        else if (stat.state === 'none') text = '0';
        else if (stat.state === 'error') text = '!';
      }
      const tip = on ? (stat?.state === 'error' ? errorText(src.id, stat.error, stat.status) : stat?.state === 'skip' ? t('research.skip') : src.what[getLang()] || src.what.en) : t('research.sourceOff');
      const chip = h('button', { type: 'button', class: `rs-src ${state}`, title: `${src.name}: ${tip}`, 'aria-label': `${src.name}: ${tip}`, 'aria-pressed': String(on) },
        state === 'busy' ? iconEl('refresh', 'spin') : null, h('span', { text: src.name }), text ? h('span', { class: 'rs-src-n', text }) : null);
      chip.addEventListener('click', () => {
        setSourceOn(src.id, !on);
        drawSources();
        if (!on && st.query) toast(t('research.sourceOnAgain', { name: src.name }), 'info');
      });
      return chip;
    }));
  }

  function drawNotice() {
    notice.replaceChildren();
    if (st.list !== 'hits') return;
    const s = researchSettings();
    if (learning()) return;
    const errors = Object.entries(st.result?.status || {}).filter(([, v]) => v.state === 'error');
    const lines = [];
    // 0.15.1: what is missing and who did not answer, each in one line; why stands on the chip of each source
    const missing = [!hasFetcher(s) && (sourceOn('arxiv', s) || sourceOn('doab', s)) ? t('research.missing.fetcher') : '', !s.openalexKey && sourceOn('openalex', s) ? t('research.missing.key') : ''].filter(Boolean);
    if (missing.length) lines.push(['info', t('research.missing', { list: missing.join(', ') })]);
    if (errors.length) lines.push(['warn', t('research.silent', { list: errors.map(([id]) => sourceById(id).name).join(', ') })]);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) lines.unshift(['warn', t('research.offline')]);
    for (const [kind, text] of lines.slice(0, 4)) {
      notice.append(h('p', { class: `rs-line ${kind}` }, iconEl(kind === 'warn' ? 'warn' : 'info'), h('span', { text }),
        kind === 'info' ? h('a', { href: '#/settings/research', text: t('research.toSettings') }) : null));
    }
  }

  // ---------------------------------------------------------------- the list in the middle
  function drawList() {
    drawSwitch();
    list.replaceChildren();
    if (st.list === 'kept') return drawKept();
    if (st.address && !st.result) {
      const read = () => { const w = pageWork(st.address); st.kept = null; st.selected = null; openReader(w); };
      list.append(h('li', { class: 'rs-empty rs-address' },
        h('p', {}, iconEl('globe'), h('span', { text: ` ${t('crawl.address', { address: st.address.replace(/^https?:\/\//, '') })}` })),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn primary rs-address-crawl', onclick: () => openCrawl(st.address) }, iconEl('globe'), h('span', { text: t('crawl.title') })),
          h('button', { type: 'button', class: 'btn rs-address-read', onclick: read }, iconEl('book'), h('span', { text: t('crawl.readOne') })),
          h('button', { type: 'button', class: 'btn rs-address-words', onclick: () => run(st.query, { words: true }) }, iconEl('search'), h('span', { text: t('crawl.asWords') }))),
        h('p', { class: 'muted small', text: t('crawl.address.hint') })));
      return;
    }
    if (learning()) { drawLearn(); return; }
    if (!st.result) {
      list.append(h('li', { class: 'rs-empty' }, h('p', { text: t('research.intro') }),
        h('ul', { class: 'muted small' }, ['research.example.topic', 'research.example.doi', 'research.example.arxiv', 'research.example.pmid'].map((k) => h('li', { text: t(k) })))));
      return;
    }
    const works = shownWorks();
    if (!works.length) {
      list.append(h('li', { class: 'rs-empty muted', text: st.result.finished ? t(st.onlyFree && st.result.works.length ? 'research.noneFree' : 'research.none') : t('research.searching') }));
      appendWeb();
      return;
    }
    for (const w of works.slice(0, 80)) list.append(hitRow(w));
    if (!st.result.finished) list.append(h('li', { class: 'rs-empty muted small' }, iconEl('refresh', 'spin'), h('span', { text: ` ${t('research.more')}` })));
    appendWeb();
  }

  // ---------------------------------------------------------------- learning a subject (0.15.1)
  function drawLearn() {
    if (!st.learn) {
      list.append(h('li', { class: 'rs-empty' }, h('p', { text: t('learn.intro') }),
        h('ul', { class: 'muted small' }, LEARN_GROUPS.map((g) => h('li', { text: `${t(`learn.group.${g}`)}: ${t(`learn.group.${g}.hint`)}` }))),
        h('p', { class: 'muted small' }, t('learn.sources'), ' ', ...LEARN_SOURCES.map((s) => {
          const on = learnOn(s.id);
          const b = h('button', { type: 'button', class: `rs-src ${on ? 'idle' : 'off'}`, 'aria-pressed': String(on), text: s.name, title: s.helper ? t('learn.helperOnly') : '' });
          b.addEventListener('click', () => { setLearnOn(s.id, !on); drawList(); });
          return b;
        }))));
      return;
    }
    let any = false;
    for (const g of LEARN_GROUPS) {
      const grp = st.learn.groups[g];
      if (!grp || grp.state === 'off') continue;
      const n = grp.items.length + grp.works.length;
      if (grp.state !== 'busy' && !n) continue;
      any = any || n > 0;
      list.append(h('li', { class: `rs-learn-head learn-${g}` }, iconEl(LEARN_ICON[g]),
        h('span', { class: 'rs-learn-name' }, h('strong', { text: t(`learn.group.${g}`) }), h('span', { class: 'muted small', text: t(`learn.group.${g}.hint`) })),
        grp.state === 'busy' ? iconEl('refresh', 'spin') : h('span', { class: 'rs-count', text: String(n) })));
      for (const w of grp.works) list.append(hitRow(w));
      for (const r of grp.items) list.append(webRow(r, { crawl: g === 'courses' || g === 'web', overview: g === 'overview' }));
    }
    if (st.learn.finished && !any) list.append(h('li', { class: 'rs-empty muted', text: t('learn.none') }));
    if (st.learn.finished) {
      list.append(h('li', { class: 'rs-learn-foot muted small' }, h('span', { text: t('learn.papersToo') }), ' ',
        h('button', { type: 'button', class: 'link-btn', text: t('learn.toPapers'), onclick: () => modes.querySelector('[data-mode="papers"]').click() })));
    }
  }
  const learnCount = () => (st.learn ? LEARN_GROUPS.reduce((n, g) => n + (st.learn.groups[g]?.items.length || 0) + (st.learn.groups[g]?.works.length || 0), 0) : 0);

  // ---------------------------------------------------------------- on the web (SearXNG in the Mac helper, 0.14.4)
  function appendWeb() {
    const web = st.web;
    if (!web || web.query !== st.query) return;
    list.append(h('li', { class: 'rs-web-head' }, iconEl('globe'), h('strong', { text: t('research.web.title') }),
      web.state === 'busy' ? iconEl('refresh', 'spin') : h('span', { class: 'rs-count', text: String(web.results.length) })));
    if (web.state === 'error') { list.append(h('li', { class: 'rs-empty muted small', text: t('research.web.error') })); return; }
    if (web.state === 'done' && !web.results.length) {
      list.append(h('li', { class: 'rs-empty muted small', text: web.unresponsive?.length ? t('research.web.noneDown', { engines: web.unresponsive.join(', ') }) : t('research.web.none') }));
      return;
    }
    for (const r of web.results.slice(0, 30)) list.append(webRow(r));
  }

  function webWork(r) {
    const w = pageWork(r.url);
    return { ...w, title: String(r.title || '').trim() || w.title, abstract: String(r.content || '').trim() };
  }

  function webRow(r, { compact = false, crawl: canCrawl = true, overview = false } = {}) {
    let host = '';
    try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch { host = r.url; }
    const read = h('button', { type: 'button', class: 'btn small rs-web-read' }, iconEl('book'), h('span', { text: t('research.read') }));
    read.addEventListener('click', () => { st.kept = null; st.selected = null; openReader(webWork(r)); });
    const crawl = compact || !canCrawl ? null : h('button', { type: 'button', class: 'btn small rs-web-crawl', title: t('crawl.title') }, iconEl('globe'), h('span', { text: t('research.web.crawl') }));
    crawl?.addEventListener('click', () => openCrawl(r.url));
    const keep = compact ? null : h('button', { type: 'button', class: 'btn small rs-web-keep' }, iconEl('bookmark'), h('span', { text: t('research.keep') }));
    keep?.addEventListener('click', async () => {
      try {
        const k = await keepWork(webWork(r), { folderPath: st.folder, query: st.query });
        toast(st.folder ? t(k.existed ? 'research.keptToastAgain' : 'research.keptToast', { folder: currentFolder()?.title || '' }) : t('research.keptLoose'), 'ok');
      } catch (e) {
        console.warn('Could not keep the page', e);
        toast(t('research.keepFailed'), 'error', 5000);
      }
      view.drawAll();
    });
    return h('li', { class: `rs-hit rs-web${overview ? ' rs-overview' : ''}` },
      h('div', { class: 'rs-hit-main rs-web-main' },
        h('a', { class: 'rs-hit-title', href: r.url, target: '_blank', rel: 'noopener noreferrer', text: r.title || r.url }),
        h('span', { class: 'rs-hit-meta muted small', text: [host, r.published ? String(r.published).slice(0, 10) : ''].filter(Boolean).join(' · ') }),
        r.content ? h('span', { class: 'small rs-web-snippet', text: String(r.content).slice(0, overview ? 600 : 280) }) : null,
        /\.pdf($|[?#])/i.test(r.url) ? h('span', { class: 'rs-hit-tags' }, h('span', { class: 'rs-tag', text: 'PDF' })) : null),
      h('div', { class: 'rs-hit-actions' }, read, crawl, keep));
  }

  // a free copy somewhere on the web for a work without one: its title in quotes, only PDFs
  function pdfSearch(w) {
    const box = h('div', { class: 'rs-web-pdf' });
    const draw = () => {
      const x = st.webPdf.get(w.key);
      const go = h('button', { type: 'button', class: 'btn small rs-web-pdf-go', disabled: x?.state === 'busy' ? true : null }, iconEl(x?.state === 'busy' ? 'refresh' : 'search', x?.state === 'busy' ? 'spin' : ''), h('span', { text: t('research.web.pdf') }));
      go.addEventListener('click', async () => {
        st.webPdf.set(w.key, { state: 'busy', results: [] });
        draw();
        try {
          const r = await webSearch(`"${w.title}" filetype:pdf`);
          st.webPdf.set(w.key, { state: 'done', results: r.results.filter((x) => /\.pdf($|[?#])|\/pdf\b/i.test(x.url)).slice(0, 8) });
        } catch {
          st.webPdf.set(w.key, { state: 'error', results: [] });
        }
        draw();
      });
      box.replaceChildren(go, ...(x?.state === 'done' ? [x.results.length ? h('ol', { class: 'rs-list rs-web-pdf-list' }, x.results.map((r) => webRow(r, { compact: true }))) : h('p', { class: 'muted small', text: t('research.web.pdfNone') })]
        : x?.state === 'error' ? [h('p', { class: 'muted small', text: t('research.web.error') })] : []));
    };
    draw();
    return box;
  }

  function badge(v) {
    if (!v) return h('span', { class: 'rs-badge paid', text: t('research.noVersion') });
    return h('span', { class: `rs-badge ${v.free ? `free ${v.kind}` : 'paid'}`, text: versionLabel(v) });
  }

  function hitRow(w) {
    const best = bestFree(w) || w.versions[0];
    const clip = clipFor(w);
    const on = !st.kept && st.selected === w.key;
    const meta = [authorLine(w.authors), w.year, w.venue].filter(Boolean).join(' · ');
    const open = best ? h('a', { class: 'btn small', href: (best.pdf && best.free) || !best.url ? best.pdf : best.url, target: '_blank', rel: 'noopener noreferrer', title: best.url }, iconEl('external'), h('span', { text: t('research.open') })) : null;
    const keep = h('button', { type: 'button', class: `btn small rs-keep-quick${clip ? ' kept' : ''}`, title: t(clip ? 'research.keptAlready' : 'research.keep') }, iconEl(clip ? 'check' : 'bookmark'), h('span', { text: t(clip ? 'research.keptShort' : 'research.keep') }));
    keep.addEventListener('click', (e) => { e.stopPropagation(); keepQuick(w); });
    const row = h('li', { class: `rs-hit${on ? ' on' : ''}`, dataset: { key: w.key } },
      h('button', { type: 'button', class: 'rs-hit-main', 'aria-pressed': String(on) },
        h('span', { class: 'rs-hit-title', text: w.title || t('research.untitled') }),
        meta ? h('span', { class: 'rs-hit-meta muted small', text: meta }) : null,
        h('span', { class: 'rs-hit-tags' }, badge(best), w.versions.length > 1 ? h('span', { class: 'rs-tag', text: t('research.versions', { n: w.versions.length }) }) : null,
          h('span', { class: 'rs-tag muted', text: w.sources.map((s) => sourceById(s)?.name || s).join(' · ') }))),
      h('div', { class: 'rs-hit-actions' }, open, keep));
    row.firstChild.addEventListener('click', () => select(w));
    return row;
  }

  function drawKept() {
    const f = currentFolder();
    if (!f) { drawLoose(); return; }
    const clips = clipsIn(f);
    if (f.crawl) {
      // a folder of a run through a website (0.14.3): its progress on top, the pages as a tree by path
      if (panel?.folder !== f.path) { panel?.destroy(); panel = crawlPanel(f); } else panel.setFolder(f);
      list.append(h('li', { class: 'cr-wrap' }, panel.el));
      if (!clips.length) { list.append(h('li', { class: 'rs-empty muted', text: t('crawl.noPages') })); return; }
      const pick = async (d) => {
        st.kept = await workFromClip(d.path);
        st.selected = null;
        drawList(); drawDetail(); drawTabs();
        if (narrow()) setPane('detail');
      };
      const read = async (d) => { const w = await workFromClip(d.path).catch(() => null); if (w) { st.kept = w; st.selected = null; openReader(w); } };
      list.append(h('li', { class: 'cr-tree-wrap' }, pageTree(f, clips, { selected: st.kept?.clip?.path || '', onPick: pick, onRead: read })));
      return;
    }
    if (f.pdfInbox) list.append(inboxBar());
    if (!clips.length) { list.append(h('li', { class: 'rs-empty muted', text: t('research.folder.empty') })); return; }
    for (const d of clips) {
      const on = st.kept?.clip?.path === d.path;
      const row = h('li', { class: `rs-hit${on ? ' on' : ''}` },
        h('button', { type: 'button', class: 'rs-hit-main', 'aria-pressed': String(on) },
          h('span', { class: 'rs-hit-title', text: d.title }),
          d.lead?.en ? h('span', { class: 'rs-hit-meta muted small', text: d.lead.en }) : null,
          h('span', { class: 'rs-hit-tags' }, !d.verified ? h('span', { class: 'rs-tag', text: t('research.unchecked') }) : null)),
        h('div', { class: 'rs-hit-actions' }, webUrl(d.url) ? h('a', { class: 'btn small', href: webUrl(d.url), target: '_blank', rel: 'noopener noreferrer' }, iconEl('external'), h('span', { text: t('research.open') })) : null,
          d.file ? originalButton(d) : null));
      row.firstChild.addEventListener('click', async () => {
        st.kept = await workFromClip(d.path);
        st.selected = null;
        drawList(); drawDetail(); drawTabs();
        if (narrow()) setPane('detail');
      });
      list.append(row);
    }
  }

  // Works in no folder (0.15.0). Pages of runs whose folder you deleted can go in one step.
  function drawLoose() {
    const clips = looseClips();
    if (!clips.length) { st.list = 'hits'; drawAll2(); return; }
    const orphans = orphanPages();
    if (orphans.length) {
      const clean = h('button', { type: 'button', class: 'btn small rs-clean' }, iconEl('trash'), h('span', { text: t('research.loose.clean', { n: orphans.length }) }));
      clean.addEventListener('click', async () => {
        if (!(await confirmDialog(t('research.loose.clean', { n: orphans.length }), t('research.loose.clean.confirm', { n: orphans.length }), { okLabel: t('action.remove'), danger: true }))) return;
        clean.disabled = true;
        const n = await deleteClips(orphans.map((d) => d.path));
        toast(t('research.loose.cleaned', { n }), 'ok');
        st.kept = null;
        view.drawAll();
      });
      list.append(h('li', { class: 'rs-loose-bar' }, h('p', { class: 'small muted', text: t('research.loose.orphans', { n: orphans.length }) }), clean));
    }
    for (const d of clips.slice(0, 200)) {
      const on = st.kept?.clip?.path === d.path;
      const row = h('li', { class: `rs-hit${on ? ' on' : ''}` },
        h('button', { type: 'button', class: 'rs-hit-main', 'aria-pressed': String(on) },
          h('span', { class: 'rs-hit-title', text: d.title }),
          d.lead?.en ? h('span', { class: 'rs-hit-meta muted small', text: d.lead.en }) : null),
        h('div', { class: 'rs-hit-actions' }, webUrl(d.url) ? h('a', { class: 'btn small', href: webUrl(d.url), target: '_blank', rel: 'noopener noreferrer' }, iconEl('external'), h('span', { text: t('research.open') })) : null));
      row.firstChild.addEventListener('click', async () => {
        st.kept = await workFromClip(d.path);
        st.selected = null;
        drawList(); drawDetail(); drawTabs();
        if (narrow()) setPane('detail');
      });
      list.append(row);
    }
  }

  // the folder of your PDF inbox on the Mac (0.14.4): where to put PDFs, read them in now
  function inboxBar() {
    const info = helperState().info || {};
    const status = h('p', { class: 'muted small ib-status', role: 'status', text: inboxLine || '' });
    const now = h('button', { type: 'button', class: 'btn small ib-now' }, iconEl('download'), h('span', { text: t('inbox.now') }));
    now.addEventListener('click', async () => {
      now.disabled = true;
      status.textContent = t('inbox.looking');
      try {
        const r = await importInbox({
          title: t('inbox.folder'),
          onProgress: (p) => { status.textContent = p.page ? t('inbox.readingPage', p) : t('inbox.reading', p); },
        });
        inboxLine = !r ? t('inbox.noHelper') : r.added || r.known || r.failed ? t('inbox.result', r) : t('inbox.empty');
      } catch (e) {
        inboxLine = t('inbox.noHelper');
      }
      status.textContent = inboxLine;
      now.disabled = false;
      view.drawAll();
    });
    return h('li', { class: 'ib-wrap' }, h('div', { class: 'ib-panel' },
      h('p', { class: 'small', text: t('inbox.hint', { dir: info.inboxDir || '~/Toollib-PDFs/Eingang', own: info.ownDir || '~/Toollib-PDFs/Eigene' }) }),
      h('div', { class: 'btn-row' }, now), status));
  }

  // ---------------------------------------------------------------- details on the right
  function select(w) {
    st.selected = w.key;
    st.kept = null;
    for (const li of list.querySelectorAll('.rs-hit')) li.classList.toggle('on', li.dataset.key === w.key);
    drawDetail();
    drawTabs();
    if (narrow()) setPane('detail');
    // No free version yet: look for one right away (an arXiv preprint, a copy in PMC).
    if (!workOf(w).free && !st.versions.has(w.key)) moreVersions(workOf(w));
  }

  function drawDetail() {
    const w = selectedWork();
    const f = currentFolder();
    right.replaceChildren();
    if (narrow()) right.append(h('button', { type: 'button', class: 'btn small back-btn', onclick: () => setPane('results') }, iconEl('chevronLeft'), h('span', { text: t('research.backToList') })));
    if (w) right.append(workBox(w));
    else right.append(h('p', { class: 'muted rs-pick', text: t('research.pick') }));
    if (f) right.append(notesBox(f));
  }

  function workBox(w) {
    const box = h('article', { class: 'rs-work' });
    const ids = w.ids || {};
    box.append(h('h2', { class: 'rs-work-title', text: w.title || t('research.untitled') }));
    if (w.authors.length) box.append(h('p', { class: 'rs-authors', text: authorLine(w.authors, 12) }));
    const where = [w.venue, w.year].filter(Boolean).join(', ');
    if (where) box.append(h('p', { class: 'muted small', text: where }));
    const idRow = h('p', { class: 'rs-ids small' });
    const idLink = (label, href) => idRow.append(h('a', { href, target: '_blank', rel: 'noopener noreferrer', text: label }));
    if (ids.doi) idLink(`DOI ${ids.doi}`, `https://doi.org/${ids.doi}`);
    if (ids.arxiv) idLink(`arXiv:${ids.arxiv}`, `https://arxiv.org/abs/${ids.arxiv}`);
    if (ids.pmid) idLink(`PMID ${ids.pmid}`, `https://pubmed.ncbi.nlm.nih.gov/${ids.pmid}/`);
    if (ids.pmcid) idLink(ids.pmcid, `https://europepmc.org/article/PMC/${ids.pmcid}`);
    if (ids.isbn?.length) idRow.append(h('span', { text: `ISBN ${ids.isbn[0]}` }));
    if (idRow.childNodes.length) box.append(idRow);

    // versions, the most useful free one first
    box.append(h('h3', { text: t('research.versionsTitle') }));
    const vl = h('ul', { class: 'rs-versions' });
    for (const v of w.versions) {
      vl.append(h('li', { class: `rs-version${v.free ? ' free' : ''}` },
        h('div', { class: 'rs-version-head' }, badge(v), licenseName(v.license) ? h('span', { class: 'rs-tag', text: licenseName(v.license) }) : null),
        h('div', { class: 'rs-version-host small', text: v.host || hostOf(v.url) }),
        h('div', { class: 'rs-version-links' },
          v.url || v.pdf ? h('button', { type: 'button', class: 'btn small', onclick: () => openReader(w, v) }, iconEl('book'), h('span', { text: t('research.read') })) : null,
          v.url ? h('a', { class: 'btn small', href: v.url, target: '_blank', rel: 'noopener noreferrer' }, iconEl('external'), h('span', { text: t('research.openPage') })) : null,
          v.pdf ? h('a', { class: 'btn small', href: v.pdf, target: '_blank', rel: 'noopener noreferrer' }, iconEl('file'), h('span', { text: 'PDF' })) : null)));
    }
    if (!w.versions.length) vl.append(h('li', { class: 'muted small', text: t('research.noVersion') }));
    box.append(vl);
    const vs = st.versions.get(w.key);
    const more = h('button', { type: 'button', class: 'btn small', disabled: vs === 'busy' ? true : null },
      iconEl('refresh', vs === 'busy' ? 'spin' : ''), h('span', { text: t(vs === 'busy' ? 'research.versionsBusy' : 'research.versionsMore') }));
    more.addEventListener('click', () => moreVersions(w));
    const readable = !!w.text || planFor(w).steps.length > 0;
    const read = readable ? h('button', { type: 'button', class: 'btn small primary', onclick: () => openReader(w) }, iconEl('book'), h('span', { text: t('research.read') })) : null;
    // a page or a document you went through (0.14.3) has no other versions to look for
    const row = h('div', { class: 'btn-row rs-work-actions' }, read, ['page', 'document'].includes(w.type) ? null : more);
    if (vs && vs !== 'busy') {
      const why = vs.failed.filter((x) => x.error === 'no-worker').length ? ` ${t('research.versionsNoWorker')}` : '';
      box.append(h('p', { class: 'muted small rs-versions-note', text: `${vs.added ? t('research.versionsAdded', { n: vs.added }) : t('research.versionsNone')}${why}` }));
    }

    // keep it
    const clip = w.clip ? nodeByPath(w.clip.path) : clipFor(w);
    if (clip) {
      if (clip.file) row.append(originalButton(clip));
      row.append(h('a', { class: 'btn small', href: nodeHref(clip.path) }, iconEl('globe'), h('span', { text: t('research.toNode') })));
      const inFolders = foldersWith(clip.slug);
      box.append(h('p', { class: 'small rs-kept-in' }, iconEl('check'), h('span', { text: inFolders.length ? t('research.keptIn', { folders: inFolders.map((f) => f.title).join(', ') }) : t('research.keptNoFolder') })));
      if (st.folder && inFolders.some((f) => f.path === st.folder)) {
        const out = h('button', { type: 'button', class: 'btn small' }, iconEl('close'), h('span', { text: t('research.removeFromFolder') }));
        out.addEventListener('click', async () => {
          await removeFromFolder(st.folder, clip.slug);
          toast(t('research.removed'), 'ok');
          if (st.kept) st.kept = null;
          view.drawAll();
        });
        row.append(out);
      }
      if (!w.clip && vs && vs !== 'busy' && vs.added) {
        const upd = h('button', { type: 'button', class: 'btn small' }, iconEl('download'), h('span', { text: t('research.updateClip') }));
        upd.addEventListener('click', async () => { if (await updateClipVersions(clip.path, w)) toast(t('research.updated'), 'ok'); upd.remove(); });
        row.append(upd);
      }
    }
    if (!bestFree(w) && w.title && canWebSearch()) box.append(pdfSearch(w));
    if (!w.clip) box.append(keepForm(w, clip));
    const cite = h('button', { type: 'button', class: 'btn small' }, iconEl('copy'), h('span', { text: t('research.cite') }));
    cite.addEventListener('click', async () => { await copyText(citation(w)); toast(t('research.citeCopied'), 'ok'); });
    row.append(cite);
    box.append(row);
    // a card, a term or a snippet from the whole work (0.14.2); the work is kept first
    const make = (kind) => async () => {
      const r = await createFromWork(kind, w, { folderPath: st.folder, query: st.result?.query.text || st.query || '' });
      if (r && kind !== 'snippet') view.drawAll();
    };
    box.append(h('div', { class: 'btn-row rs-make' }, h('span', { class: 'small muted', text: t('library.make') }),
      h('button', { type: 'button', class: 'btn small rs-make-card', onclick: make('card') }, iconEl('plus'), h('span', { text: t('reader.card') })),
      h('button', { type: 'button', class: 'btn small rs-make-term', onclick: make('term') }, iconEl('plus'), h('span', { text: t('reader.card.kind.term') })),
      h('button', { type: 'button', class: 'btn small rs-make-snippet', onclick: make('snippet') }, iconEl('code'), h('span', { text: t('reader.snippet') }))));

    if (w.abstract) {
      box.append(h('h3', { text: t('research.abstract') }));
      box.append(h('div', { class: 'rs-abstract' }, renderMarkdown(w.abstract.replace(/^(:::|#)/gm, '\\$1'), {})));
    }
    if (w.sources?.length) box.append(h('p', { class: 'muted small', text: t('research.foundIn', { sources: w.sources.map((s) => sourceById(s)?.name || s).join(', ') }) }));
    if (w.clip) box.append(h('p', { class: 'muted small', text: t('research.clipFrom', { date: w.clip.fetched }) }));
    return box;
  }

  // Keep in a folder, with what it helps with (in your words; the search finds it by that).
  function keepForm(w, clip) {
    const all = folders();
    const sel = h('select', { class: 'field small', 'aria-label': t('research.keepIn') },
      h('option', { value: '', text: t('research.keepNoFolder') }),
      all.map((f) => h('option', { value: f.path, selected: f.path === st.folder ? true : null, text: f.title })),
      h('option', { value: '__new', text: t('research.folder.newOption') }));
    const helps = h('input', { class: 'field small', type: 'text', placeholder: t('research.helpsWith'), 'aria-label': t('research.helpsWith'), hidden: clip ? true : null });
    const btn = h('button', { type: 'button', class: 'btn small primary' }, iconEl('bookmark'), h('span', { text: t(clip ? 'research.keepAlso' : 'research.keep') }));
    btn.addEventListener('click', async () => {
      let folderPath = sel.value;
      if (folderPath === '__new') { folderPath = await newFolder(st.result?.query.text || ''); if (!folderPath) return; }
      btn.disabled = true;
      try {
        await keepWork(w, { folderPath, query: st.result?.query.text || '', problem: helps.value });
        const f = folders().find((x) => x.path === folderPath);
        toast(f ? t('research.keptToast', { folder: f.title }) : t('research.keptToastNoFolder'), 'ok');
        if (folderPath && folderPath !== st.folder) { st.folder = folderPath; savePref('research.folder', folderPath); }
          } catch (e) {
        console.warn('Could not keep the work', e);
        toast(t('research.keepFailed'), 'error', 5000);
      }
      view.drawAll();
    });
    return h('div', { class: 'rs-keep' }, h('span', { class: 'small muted', text: t('research.keepIn') }), sel, helps, btn);
  }

  // One tap keeps a work (0.15.0): in the open folder, otherwise without one ("No folder"); the project in focus takes it in.
  async function keepQuick(w) {
    try {
      const r = await keepWork(workOf(w), { folderPath: currentFolder() ? st.folder : '', query: st.result?.query.text || '' });
      toast(currentFolder() ? t(r.existed ? 'research.keptToastAgain' : 'research.keptToast', { folder: currentFolder().title }) : t(r.existed ? 'research.keptAlready' : 'research.keptLoose'), 'ok');
    } catch (e) {
      console.warn('Could not keep the work', e);
      toast(t('research.keepFailed'), 'error', 5000);
    }
    view.drawAll();
  }

  function moreVersions(w) {
    const key = w.key;
    st.versions.set(key, 'busy');
    if (selectedWork()?.key === key) drawDetail();
    findVersions(w, {
      onUpdate: (next) => {
        if (st.kept && st.kept.key === key) st.kept = { ...next, clip: st.kept.clip };
        else st.extra.set(key, next);
        if (view?.root.isConnected) { drawList(); if (selectedWork()?.key === key) drawDetail(); }
      },
    }).then((r) => {
      st.versions.set(key, { added: r.added, failed: r.failed });
      if (view?.root.isConnected) { drawList(); if (selectedWork()?.key === key) drawDetail(); }
    });
  }

  async function removeFolder(f) {
    // a run through a website: its pages go with the folder, unless you marked something in them or keep them elsewhere
    const pages = f.crawl ? runPages(f) : [];
    if (pages.length) {
      const pick = await modal({
        title: t('research.folder.delete'), body: h('p', { text: t('research.folder.delete.run', { title: f.title, n: pages.length }) }), dismissValue: null,
        actions: [{ label: t('action.cancel'), value: null }, { label: t('research.folder.delete.only'), value: 'folder' }, { label: t('research.folder.delete.pages', { n: pages.length }), kind: 'danger', value: 'all' }],
      });
      if (!pick) return;
      if (pick === 'all') await deleteClips(pages.map((d) => d.path));
    } else if (!(await confirmDialog(t('research.folder.delete'), t('research.folder.delete.confirm', { title: f.title, count: f.clips.length }), { okLabel: t('research.folder.delete'), danger: true }))) return;
    try {
      await deleteFolder(f.path);
      st.folder = '';
      savePref('research.folder', '');
      st.list = 'hits';
      st.kept = null;
      view.drawAll();
      toast(t('research.folder.deleted'), 'ok');
    } catch (e) {
      toast(t('snippet.failed', { error: e.message || String(e) }), 'error', 5000);
    }
  }

  // ---------------------------------------------------------------- notes of the folder
  function notesBox(f) {
    const box = h('section', { class: 'rs-notes' }, h('h3', {}, iconEl('folderOpen'), h('span', { text: f.title })));
    const question = h('input', { class: 'field', type: 'text', placeholder: t('research.question'), 'aria-label': t('research.question') });
    const notes = h('textarea', { class: 'field rs-notes-text', rows: '8', placeholder: t('research.notesHint'), 'aria-label': t('research.notes') });
    const state = h('span', { class: 'muted small rs-saved' });
    box.append(h('label', { class: 'set-field' }, h('span', { class: 'field-label', text: t('research.question') }), question),
      h('label', { class: 'set-field' }, h('span', { class: 'field-label', text: t('research.notes') }), notes),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn small', href: nodeHref(f.path) }, iconEl('search'), h('span', { text: t('research.folderNode') })),
        h('button', { type: 'button', class: 'btn small rs-folder-delete', onclick: () => removeFolder(f) }, iconEl('trash'), h('span', { text: t('research.folder.delete') })), state));
    let loaded = false;
    folderNotes(f.path).then((n) => { question.value = n.question; notes.value = n.notes; loaded = true; }).catch(() => {});
    const save = async () => {
      if (!loaded) return;
      try {
        if (await saveFolderNotes(f.path, { question: question.value, notes: notes.value })) state.textContent = t('research.saved');
      } catch { state.textContent = t('research.saveFailed'); }
    };
    const later = debounce(save, 1200);
    question.addEventListener('input', () => { state.textContent = ''; later(); });
    notes.addEventListener('input', () => { state.textContent = ''; later(); });
    question.addEventListener('blur', save);
    notes.addEventListener('blur', save);
    return box;
  }

  // going through a website (0.14.3): the dialog, then its folder
  async function openCrawl(start) {
    const folderPath = await crawlDialog({ start });
    if (!folderPath) return;
    st.folder = folderPath;
    savePref('research.folder', folderPath);
    st.list = 'kept';
    st.kept = null;
    st.address = '';
    st.lib = null;
    savePref('library.open', null);
    applyMode();
    view.drawAll();
    if (narrow()) setPane('results');
  }

  // a folder made elsewhere ("+", a project) comes to the front
  const show = loadPref('research.showFolder', '');
  if (show) { savePref('research.showFolder', ''); st.folder = show; st.list = 'kept'; st.kept = null; st.read = null; if (narrow()) st.pane = 'results'; root.dataset.pane = st.pane; }
  // a search handed over by the command bar, a project or a note, or a new folder: they come in front of a library
  // that was open the last time (before 0.15.0 the search ran unseen behind it)
  if (show || st.queued) st.read = null;
  view.drawAll();
  const pendingCrawl = loadPref('crawl.open', '');
  if (pendingCrawl) { savePref('crawl.open', ''); setTimeout(() => openCrawl(pendingCrawl), 50); }
  st.lib = null;   // libraries open in their own tool since 0.15.1
  if (st.read) showReader(); else applyMode();
  readQueued();
  if (st.queued) { st.queued = false; run(st.query); } else if (!st.result && st.query) input.focus();
  return view;
}

// The command bar hands over what you typed: the research window searches it when it opens.
export function queueSearch(q) {
  st.query = String(q || '').trim();
  st.queued = !!st.query;
}

// ------------------------------------------------------------------ searching
// A search for learning (0.15.1): see services/learn.js.
function runLearn(q) {
  st.learnSearch?.cancel();
  st.selected = null;
  st.kept = null;
  st.list = 'hits';
  st.learn = { query: q, groups: {}, finished: false };
  if (narrow()) st.pane = 'results';
  const handle = learnSearch(q, {
    onUpdate: (r) => {
      if (st.learnSearch !== handle) return;
      st.learn = r;
      if (view?.root.isConnected) { view.root.dataset.pane = st.pane; view.drawAll(); }
    },
  });
  st.learnSearch = handle;
  view?.drawAll();
}

// keep: the same words again after switching between learning and papers; an answer already there stays.
function run(raw, { words = false, keep = false } = {}) {
  const q = String(raw || '').trim();
  if (!q) return;
  st.query = q;
  savePref('research.query', q);
  st.search?.cancel();
  // an address (0.14.3): go through the website or read the page, instead of searching it as words
  const address = !words && parseQuery(q).kind === 'text' ? parseStart(q) : null;
  st.address = address || '';
  if (address) {
    st.search = null;
    st.result = null;
    st.selected = null;
    st.kept = null;
    st.list = 'hits';
    if (narrow()) st.pane = 'results';
    if (view?.root.isConnected) { view.root.dataset.pane = st.pane; view.drawAll(); }
    return;
  }
  if (st.mode === 'learn' && parseQuery(q).kind === 'text') {
    if (keep && st.learn?.query === q) { view?.drawAll(); return; }
    runLearn(q);
    return;
  }
  if (keep && st.paperQuery === q && st.result) { view?.drawAll(); return; }
  st.paperQuery = q;
  st.selected = null;
  st.kept = null;
  st.extra.clear();
  st.list = 'hits';
  st.result = { query: parseQuery(q), works: [], status: {}, finished: false };
  if (narrow()) st.pane = 'results';
  let handle = null;
  handle = startSearch(q, {
    onUpdate: (r) => {
      if (!handle || st.search !== handle) return;
      st.result = r;
      if (r.versions) st.versions.set(r.versions.key, r.versions.state === 'busy' ? 'busy' : { added: r.versions.added, failed: r.versions.failed });
      // A DOI or an arXiv id names one work: show it right away.
      if (r.query.kind !== 'text' && !st.selected && !st.kept && r.works.length) st.selected = (r.versions?.key) || shownWorks()[0]?.key || null;
      if (view?.root.isConnected) {
        view.root.dataset.pane = st.pane;
        view.drawAll();
      }
    },
  });
  st.search = handle;
  st.web = null;
  view?.drawAll();
  searchWeb(q);
}

// The same words on the web, when the Mac helper has SearXNG (0.14.4).
async function searchWeb(q) {
  if (!(await helperReady()) || !canWebSearch() || parseQuery(q).kind !== 'text') return;
  st.web = { query: q, state: 'busy', results: [] };
  if (view?.root.isConnected) view.drawList();
  try {
    const r = await webSearch(q);
    if (st.web?.query !== q) return;
    st.web = { query: q, state: 'done', results: r.results, unresponsive: r.unresponsive };
  } catch (e) {
    if (st.web?.query !== q) return;
    st.web = { query: q, state: 'error', results: [] };
  }
  if (view?.root.isConnected) view.drawList();
}

async function newFolder(suggestion) {
  const title = await promptDialog(t('research.folder.new'), { label: t('research.folder.title'), value: suggestion || '', placeholder: t('research.folder.placeholder'), okLabel: t('research.folder.create'), validate: (v) => (v.trim() ? '' : t('research.folder.needTitle')) });
  if (!title || !title.trim()) return '';
  try {
    const path = await createFolder({ title, question: '' });
    toast(t('research.folder.created', { title: title.trim() }), 'ok');
    return path;
  } catch (e) {
    console.warn('Could not create the folder', e);
    toast(t('research.keepFailed'), 'error', 5000);
    return '';
  }
}

function openWindow() {
  const url = `${location.pathname}?solo=1#/m/scraper`;
  const w = window.open(url, 'toollib-research', 'popup=yes,width=1360,height=880');
  if (!w) location.assign(url);
}

// Creative Commons licences as people know them ("CC BY 4.0"); other labels ("other-oa") say nothing and stay hidden.
export function licenseName(l) {
  const s = String(l || '').toLowerCase();
  const url = s.match(/creativecommons\.org\/(?:licenses\/([a-z-]+)\/([\d.]+)|publicdomain\/zero)/);
  if (url) return url[1] ? `CC ${url[1].toUpperCase()} ${url[2]}` : 'CC0';
  const code = s.match(/^cc[-\s]?(by(?:[-\s](?:nc|nd|sa))*|0|zero)$/);
  if (code) return code[1] === '0' || code[1] === 'zero' ? 'CC0' : `CC ${code[1].replace(/\s/g, '-').toUpperCase()}`;
  return '';
}

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

// "Coleman, S. (1975). Title. Venue. https://doi.org/…": what goes into notes and mails.
export function citation(w) {
  const names = w.authors.slice(0, 6).map((a) => {
    const parts = a.split(/\s+/);
    const last = parts.pop();
    return parts.length ? `${last}, ${parts.map((p) => `${p[0]}.`).join(' ')}` : last;
  });
  const who = names.length ? `${names.join(', ')}${w.authors.length > 6 ? ', et al.' : ''}` : '';
  const link = w.ids.doi ? `https://doi.org/${w.ids.doi}` : w.ids.arxiv ? `arXiv:${w.ids.arxiv}` : (bestFree(w) || w.versions[0])?.url || '';
  return [who && `${who}${w.year ? ` (${w.year})` : ''}.`, w.title && `${w.title}.`, w.venue && `${w.venue}.`, link].filter(Boolean).join(' ');
}

// The sync and other windows change folders and clips: draw the lists again.
onIndexChange((s) => { if (!s.building && view?.root.isConnected) view.drawAll(); });
window.addEventListener('toollib:nodes', () => { if (view?.root.isConnected) view.drawAll(); });

// A run through a website (0.14.3): new pages come into the tree, the folder list shows which one runs.
let lastCrawl = { status: '', pages: -1, at: 0 };
let crawlTimer = 0;
onCrawl((b) => {
  if (!view?.root.isConnected) return;
  const statusChanged = b.status !== lastCrawl.status;
  const pagesChanged = b.pages !== lastCrawl.pages;
  lastCrawl = { status: b.status, pages: b.pages, at: lastCrawl.at };
  if (statusChanged) view.drawFolders();
  if (!pagesChanged && !statusChanged) return;
  if (view.folderPath() !== b.folder || view.listMode() !== 'kept') { if (pagesChanged) view.drawFolders(); return; }
  clearTimeout(crawlTimer);
  const wait = Math.max(0, 1200 - (Date.now() - lastCrawl.at));
  crawlTimer = setTimeout(() => { lastCrawl.at = Date.now(); if (view?.root.isConnected) { view.drawFolders(); view.drawList(); } }, statusChanged ? 0 : wait);
});
