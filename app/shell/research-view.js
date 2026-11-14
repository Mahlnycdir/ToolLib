// The research window (0.16.0). One bar on top: learn or papers, the search, where what you keep goes ("Keep in":
// the project in focus, or the inbox), and three lists: the hits, what the project kept, the inbox. Below, the list on
// the left and on the right what you picked, ready to read. Folders are gone (0.16.0): a project holds what you
// collect; a run through a website and the PDF inbox of the Mac are one entry each. On the iPhone the list and what
// you picked take turns. "Read" turns the whole window into the reader; "Own window" opens it alone (?solo=1).
import { matches, keyTitle } from '../services/keys.js';
import { h, toast, copyText, loadPref, savePref, promptDialog, confirmDialog, modal, actionSheet, keepScroll } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { SOURCES, sourceById } from '../services/research-sources.js';
import { bestFree, rankWorks, parseQuery, webUrl } from '../services/research-merge.js';
import { canWebSearch, findVersions, hasFetcher, helperReady, helperState, researchSettings, setSourceOn, sourceOn, startSearch, webSearch } from '../services/research.js';
import { importInbox, onInbox, openOriginal } from '../services/pdf-inbox.js';
import { clipFor, clipsIn, deleteClips, deleteFolder, dissolveFolder, folders, keepWork, orphanPages, runPages, updateClipVersions, workFromClip } from '../services/research-store.js';
import { mark } from '../services/trail.js';
import { LEARN_GROUPS, LEARN_SOURCES, learnOn, learnSearch, setLearnOn } from '../services/learn.js';
import { allNodes, nodeByPath, nodeBySlug, onIndexChange } from '../services/search.js';
import { addToProject, createProject, focusProject, onFocusChange, projectWorks, projects, projectsWith, removeFromProject, setFocus } from '../services/projects.js';
import { nodeHref } from './node-view.js';
import { renderMarkdown } from './markdown.js';
import { planFor } from '../services/reader.js';
import { mountReader } from './reader-view.js';
import { createFromWork } from './card-dialog.js';
import { crawlState, onCrawl, pageWork, parseStart } from '../services/crawl.js';
import { crawlDialog, crawlPanel, pageTree } from './crawl-view.js';
import { projectAccent } from './projects-view.js';
import { ownHelp } from './problem-ui.js';

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
  web1: null,            // a page from the web on the right (learning, SearXNG)
  extra: new Map(),      // key -> work with more versions found later
  kept: null,            // work of a kept clip on the right
  list: 'hits',          // hits | kept | inbox
  folder: '',            // a run through a website or the PDF inbox, open in the list (0.16.0)
  pane: 'results',       // results | detail (iPhone)
  filters: false,        // the filter panel is open
  onlyFree: loadPref('research.onlyFree', false),
  kind: loadPref('research.kind', 'all'),
  sort: loadPref('research.sort', 'relevance'),
  versions: new Map(),   // key -> 'busy' | { added, failed }
  read: null,            // { work, version }: the reader is open
  address: '',           // an address in the search field (0.14.3): go through the website or read the page
  web: null,             // the same search on the web through SearXNG (0.14.4): { query, state, results, error }
  mode: loadPref('research.mode', 'learn'),   // learn | papers (0.15.1): what a search of words looks for first
  learn: null,           // { query, groups, finished }: the search for learning
  learnSearch: null,
  webPdf: new Map(),     // key of a work -> { state, results }: "Search the web for a PDF"
};
let view = null;         // the mounted view: { root, draw* }
let panel = null;        // the panel of the run that is open (0.14.3)
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
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const quoted = (s) => (getLang() === 'de' ? `„${s}“` : `“${s}”`);

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

// ------------------------------------------------------------------ what a project kept, what waits in the inbox
// What you kept while no project was in focus, runs that belong to no project, and folders from before.
function inboxWorks() {
  const inProject = new Set(projects().flatMap((p) => p.links));
  const fs = folders();
  const sites = fs.filter((f) => (f.crawl || f.pdfInbox) && !inProject.has(f.slug));
  const olds = fs.filter((f) => !f.crawl && !f.pdfInbox && !inProject.has(f.slug));
  const covered = new Set(fs.filter((f) => !f.crawl && !f.pdfInbox).flatMap((f) => f.clips));
  const ofSite = new Set(fs.filter((f) => f.crawl || f.pdfInbox).flatMap((f) => f.clips));
  const clips = allNodes().filter((d) => d.type === 'clip' && !d.conflict && !inProject.has(d.slug) && !covered.has(d.slug) && !ofSite.has(d.slug))
    .sort((a, b) => a.title.localeCompare(b.title));
  return { sites, olds, clips, count: sites.length + olds.length + clips.length };
}
const keptIn = (slug) => projectsWith(slug);

// Asks which project; offers a new one named after the suggestion. Resolves to its path or ''.
async function pickProject(title, suggestion = '') {
  const list = projects().filter((p) => p.state !== 'done');
  const v = await actionSheet(title, [
    ...list.map((p) => ({ label: p.title, value: p.path, icon: 'target' })),
    '-',
    { label: suggestion ? t('research.adopt.new', { title: suggestion }) : t('research.into.new'), value: '__new', icon: 'plus' },
  ]);
  if (!v) return '';
  if (v !== '__new') return v;
  const name = suggestion || await promptDialog(t('research.into.new'), { label: t('project.title'), placeholder: t('project.titleHint'), okLabel: t('project.create'), validate: (x) => (x.trim() ? '' : t('project.needTitle')) });
  if (!name || !String(name).trim()) return '';
  return createProject({ title: String(name).trim() });
}

// ------------------------------------------------------------------ the view
export function renderResearch(main) {
  main.dataset.view = 'research';
  const root = h('div', { class: 'rs', dataset: { pane: st.pane, mode: st.read ? 'read' : '' } });
  const top = h('header', { class: 'rs-top' });
  // on the phone the list is hidden while you look at one work; back in the list you are where you were (0.22.0)
  const mid = keepScroll(h('section', { class: 'rs-results', 'aria-label': t('research.results') }));
  const right = h('section', { class: 'rs-detail', 'aria-label': t('research.details') });
  const readerHost = h('div', { class: 'rs-reader' });
  root.append(top, mid, right, readerHost);
  main.append(root);

  // ---------------------------------------------------------------- the bar on top
  const input = h('input', {
    class: 'field rs-input', type: 'search', enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: t(st.mode === 'learn' ? 'research.placeholder.learn' : 'research.placeholder'), 'aria-label': t('research.placeholder'), value: st.query,
  });
  const go = h('button', { type: 'submit', class: 'btn primary rs-go' }, iconEl('search'), h('span', { text: t('research.search') }));
  const form = h('form', { class: 'rs-search', role: 'search' }, input, go);
  form.addEventListener('submit', (e) => { e.preventDefault(); run(input.value); input.blur(); });
  // Learn or papers (0.15.1): learning asks for overviews, introductions, books, courses and code; papers asks the
  // seven paper sources. The choice stays; switching runs the same words in the other way.
  const modes = h('div', { class: 'segmented small rs-mode', role: 'group', 'aria-label': t('research.mode') });
  const drawModes = () => modes.replaceChildren(...['learn', 'papers'].map((m) => {
    const b = h('button', { type: 'button', class: st.mode === m ? 'on' : '', 'aria-pressed': String(st.mode === m), dataset: { mode: m } }, iconEl(m === 'learn' ? 'sparkle' : 'file'), h('span', { text: t(`research.mode.${m}`) }));
    b.addEventListener('click', () => {
      if (st.mode === m) return;
      st.mode = m;
      savePref('research.mode', m);
      input.placeholder = t(m === 'learn' ? 'research.placeholder.learn' : 'research.placeholder');
      drawModes();
      st.selected = null; st.web1 = null;
      st.list = 'hits'; st.folder = '';
      if (st.query) run(st.query, { keep: true }); else view.drawAll();
    });
    return b;
  }));
  drawModes();
  const filterBtn = h('button', { type: 'button', class: 'btn small rs-filter-btn', 'aria-expanded': String(st.filters) });
  filterBtn.addEventListener('click', () => { st.filters = !st.filters; drawFilterPanel(); });
  const crawlBtn = h('button', { type: 'button', class: 'btn small rs-crawl-new', title: t('crawl.title') }, iconEl('globe'), h('span', { text: t('research.site.new') }));
  crawlBtn.addEventListener('click', () => openCrawl(''));
  const tabs = h('div', { class: 'segmented rs-switch', role: 'tablist' });
  const into = h('button', { type: 'button', class: 'rs-into' });
  into.addEventListener('click', chooseInto);
  const filterPanel = h('div', { class: 'rs-filter-panel' });
  const filters = h('div', { class: 'rs-filters' });
  const sources = h('div', { class: 'rs-sources', 'aria-live': 'polite' });
  top.append(
    h('div', { class: 'rs-row1' }, modes, form),
    h('div', { class: 'rs-row2' }, tabs, h('div', { class: 'rs-row2-end' }, filterBtn, crawlBtn, into)),
    filterPanel);
  const notice = h('div', { class: 'rs-notice' });
  const list = h('ol', { class: 'rs-list' });
  mid.append(notice, list);

  // Going through the hits with the keyboard (0.15.1): ↑↓ or j/k move, Enter shows it, L reads, M keeps.
  root.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal-backdrop, .sheet-backdrop')) return;
    const rows = [...list.querySelectorAll('.rs-hit')];
    if (!rows.length) return;
    const focusRow = (i) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      r.querySelector('button.rs-hit-main')?.focus();
      r.scrollIntoView({ block: 'nearest' });
    };
    if (e.target === input) { if (matches(e, 'research.down') && e.key === 'ArrowDown') { e.preventDefault(); focusRow(0); } return; }
    if (e.target.matches('input, textarea, select, [contenteditable]')) return;
    const cur = rows.findIndex((r) => r.contains(document.activeElement));
    // the keys of Settings › Keys (0.17.0)
    if (matches(e, 'research.down')) { e.preventDefault(); focusRow(cur + 1); return; }
    if (matches(e, 'research.up')) { e.preventDefault(); if (cur <= 0) input.focus(); else focusRow(cur - 1); return; }
    if (cur < 0) return;
    const row = rows[cur];
    if (matches(e, 'research.read')) { e.preventDefault(); row.querySelector('.rs-hit-read')?.click(); }
    else if (matches(e, 'research.keep')) { e.preventDefault(); row.querySelector('.rs-keep-quick')?.click(); }
  });

  view = {
    root, input,
    drawAll() { drawTabs(); drawInto(); drawFilterPanel(); drawNotice(); drawList(); drawDetail(); },
    drawList: () => { drawTabs(); drawList(); },
    folderPath: () => st.folder,
  };

  function setPane(p) { st.pane = p; root.dataset.pane = p; }

  // ---------------------------------------------------------------- the reader (0.14.1)
  let reading = null;
  function showReader() {
    reading?.destroy();
    reading = null;
    readerHost.replaceChildren();
    root.dataset.mode = st.read ? 'read' : '';
    if (!st.read) return;
    const { work, version } = st.read;
    reading = mountReader(readerHost, {
      work, version, folderPath: '', query: st.result?.query.text || st.query || '',
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
    // came from your pages (0.16.0): back there
    const from = loadPref('research.readFrom', '');
    if (from) { savePref('research.readFrom', ''); location.hash = from; return; }
    if (st.kept?.clip && clipPath === st.kept.clip.path) { try { st.kept = await workFromClip(clipPath) || st.kept; } catch { /* keep what is shown */ } }
    view.drawAll();
  }
  function openReader(work, version = null) {
    const kept = work.clip?.path || clipFor(work)?.path;
    if (kept) mark('read', { path: kept, title: work.title });
    st.read = { work, version };
    showReader();
  }
  // A clip node or your pages hand over a path ("Read" there): open the reader on it here.
  async function readQueued() {
    const path = loadPref('research.read', '');
    if (!path) return;
    savePref('research.read', '');
    try {
      const work = await workFromClip(path);
      if (work) { st.kept = work; st.selected = null; openReader(work); view.drawAll(); }
    } catch (e) { console.warn('Could not open the reader', e); }
  }

  // ---------------------------------------------------------------- where what you keep goes
  function drawInto() {
    const p = focusProject();
    into.replaceChildren(h('span', { class: 'rs-into-label muted small', text: t('research.into') }),
      h('span', { class: `rs-into-dot${p ? '' : ' inbox'}`, style: p ? `background:${projectAccent(p.slug).color}` : null }),
      h('span', { class: 'rs-into-name', text: p ? p.title : t('research.into.inbox') }), iconEl('chevronDown'));
    into.title = t('research.into.pick');
  }
  async function chooseInto() {
    const p = focusProject();
    const list2 = projects().filter((x) => x.state !== 'done');
    const v = await actionSheet(t('research.into.pick'), [
      ...list2.map((x) => ({ label: x.title, value: x.path, icon: x.path === p?.path ? 'check' : 'target' })),
      '-',
      { label: t('research.into.none'), value: '__inbox', icon: p ? 'inbox' : 'check' },
      { label: t('research.into.new'), value: '__new', icon: 'plus' },
    ]);
    if (!v) return;
    if (v === '__inbox') setFocus('');
    else if (v === '__new') { const path = await pickNew(); if (path) setFocus(path); }
    else setFocus(v);
  }
  async function pickNew() {
    const name = await promptDialog(t('research.into.new'), { label: t('project.title'), value: st.query && learning() ? st.query : '', placeholder: t('project.titleHint'), okLabel: t('project.create'), validate: (x) => (x.trim() ? '' : t('project.needTitle')) });
    if (!name || !name.trim()) return '';
    try { return await createProject({ title: name.trim() }); } catch (e) { toast(t('create.failed'), 'error', 5000); return ''; }
  }

  // ---------------------------------------------------------------- the three lists
  function drawTabs() {
    const p = focusProject();
    const n = learning() ? learnCount() : st.result ? shownWorks().length : 0;
    const kept = p ? projectWorks(p) : null;
    const inbox = inboxWorks();
    mid.dataset.mode = learning() ? 'learn' : 'papers';
    mid.dataset.list = st.list;
    const tab = (id, text, extra = {}) => h('button', { type: 'button', role: 'tab', class: st.list === id ? 'on' : '', 'aria-selected': String(st.list === id), dataset: { list: id }, text, onclick: () => {
      st.list = id; st.folder = ''; st.kept = null; st.web1 = null;
      if (narrow()) setPane('results');
      drawTabs(); drawNotice(); drawList(); drawDetail(); drawFilterPanel();
    }, ...extra });
    tabs.replaceChildren(...[
      tab('hits', (learning() ? st.learn : st.result) ? t('research.hits', { n }) : t('research.hitsNone')),
      tab('kept', p ? t('research.tab.kept', { n: kept.clips.length + kept.sites.length }) : t('research.tab.keptNone')),
      inbox.count ? tab('inbox', t('research.tab.inbox', { n: inbox.count })) : null].filter(Boolean));
  }

  // ---------------------------------------------------------------- filters, sources, what is missing (folded away)
  function drawFilterPanel() {
    const papers = st.list === 'hits' && !learning();
    const errors = Object.values(st.result?.status || {}).filter((v) => v.state === 'error').length;
    filterBtn.hidden = !papers;
    filterBtn.setAttribute('aria-expanded', String(st.filters && papers));
    filterBtn.replaceChildren(...[iconEl('format'), h('span', { text: t('research.more.filters') }), errors ? h('span', { class: 'rs-filter-warn', title: t('research.silentN', { n: errors }), text: '!' }) : null].filter(Boolean));
    filterPanel.hidden = !(st.filters && papers);
    mid.classList.toggle('more', st.filters && papers);
    if (filterPanel.hidden) return;
    const free = h('label', { class: 'rs-check' }, h('input', { type: 'checkbox', checked: st.onlyFree ? true : null }), h('span', { text: t('research.onlyFree') }));
    free.firstChild.addEventListener('change', (e) => { st.onlyFree = e.target.checked; savePref('research.onlyFree', st.onlyFree); view.drawList(); });
    const select = (key, value, options, onChange) => {
      const s = h('select', { class: 'field small', 'aria-label': t(key) }, options.map(([v, k]) => h('option', { value: v, selected: v === value ? true : null, text: t(k) })));
      s.addEventListener('change', () => onChange(s.value));
      return h('label', { class: 'rs-select' }, h('span', { class: 'muted small', text: t(key) }), s);
    };
    filters.replaceChildren(free,
      select('research.kindFilter', st.kind, [['all', 'research.kind.all'], ['articles', 'research.kind.articles'], ['books', 'research.kind.books'], ['preprints', 'research.kind.preprints']],
        (v) => { st.kind = v; savePref('research.kind', v); view.drawList(); }),
      select('research.sort', st.sort, [['relevance', 'research.sort.relevance'], ['year', 'research.sort.year'], ['cited', 'research.sort.cited']],
        (v) => { st.sort = v; savePref('research.sort', v); view.drawList(); }));
    drawSources();
    const s = researchSettings();
    const missing = [!hasFetcher(s) && (sourceOn('arxiv', s) || sourceOn('doab', s)) ? t('research.missing.fetcher') : '', !s.openalexKey && sourceOn('openalex', s) ? t('research.missing.key') : ''].filter(Boolean);
    filterPanel.replaceChildren(filters, h('p', { class: 'muted small rs-src-hint', text: t('research.sourcesHint') }), sources,
      missing.length ? h('p', { class: 'rs-line info' }, iconEl('info'), h('span', { text: t('research.missing', { list: missing.join(', ') }) })) : null,
      h('div', { class: 'rs-panel-foot' },
        h('a', { class: 'small', href: '#/settings/research', text: t('research.settings') }),
        !solo() && !isIos() && !narrow() ? h('button', { type: 'button', class: 'link-btn small', onclick: openWindow, text: t('research.ownWindow') }) : null));
  }
  function drawSources() {
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
  // Above the list only what you must know now: offline, sources that did not answer (why: in "Filters").
  function drawNotice() {
    notice.replaceChildren();
    if (st.list !== 'hits' || learning()) return;
    const errors = Object.entries(st.result?.status || {}).filter(([, v]) => v.state === 'error');
    const lines = [];
    if (typeof navigator !== 'undefined' && navigator.onLine === false) lines.push(t('research.offline'));
    if (errors.length) lines.push(t('research.silent', { list: errors.map(([id]) => sourceById(id).name).join(', ') }));
    for (const text of lines.slice(0, 2)) notice.append(h('p', { class: 'rs-line warn' }, iconEl('warn'), h('span', { text })));
  }

  // ---------------------------------------------------------------- the list on the left
  function drawList() {
    list.replaceChildren();
    if (st.folder) return drawFolder();
    if (st.list === 'kept') return drawKept();
    if (st.list === 'inbox') return drawInbox();
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
    // 0.30.0: what your own knowledge has for the question (paths first), above the hits; with a project in focus,
    // what helps it on (ENTE: "gerade wenn man im Research ist und nicht weiter weiß")
    if (st.query && st.query.trim().length >= 3 && parseQuery(st.query).kind === 'text') {
      const own = ownHelp(st.query, { go: (hash) => { location.hash = hash; } });
      if (own) list.append(h('li', { class: 'rs-own' }, own));
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

  // A row: what it is, and two quick actions (read, keep). A tap shows it on the right.
  function quick(kept, onKeep, onRead) {
    const read = onRead ? keyTitle(h('button', { type: 'button', class: 'icon-btn rs-hit-read', 'aria-label': t('research.read'), html: icon('book') }), t('research.read'), 'research.read') : null;
    read?.addEventListener('click', (e) => { e.stopPropagation(); onRead(); });
    const keep = keyTitle(h('button', { type: 'button', class: `icon-btn rs-keep-quick${kept ? ' kept' : ''}`, 'aria-label': keepTitle(kept), html: icon(kept ? 'check' : 'bookmark') }), keepTitle(kept), 'research.keep');
    keep.addEventListener('click', (e) => { e.stopPropagation(); onKeep(); });
    return h('div', { class: 'rs-hit-actions' }, read, keep);
  }
  const keepTitle = (kept) => { const p = focusProject(); return kept ? t('research.keptShort') : p ? t('research.keepInto', { project: p.title }) : t('research.keepInbox'); };
  // kept here means: kept, and in the project you keep into (or anywhere, when no project is in focus)
  const isKept = (clip) => { if (!clip) return false; const p = focusProject(); return !p || keptIn(clip.slug).some((x) => x.path === p.path); };

  function webRow(r, { crawl: canCrawl = true, overview = false } = {}) {
    const host = hostOf(r.url) || r.url;
    const work = webWork(r);
    const on = st.web1?.url === r.url;
    const row = h('li', { class: `rs-hit rs-web${overview ? ' rs-overview' : ''}${on ? ' on' : ''}`, dataset: { url: r.url } },
      h('button', { type: 'button', class: 'rs-hit-main rs-web-main', 'aria-pressed': String(on) },
        h('span', { class: 'rs-hit-title', text: r.title || r.url }),
        h('span', { class: 'rs-hit-meta muted small', text: [host, r.published ? String(r.published).slice(0, 10) : ''].filter(Boolean).join(' · ') }),
        r.content ? h('span', { class: 'small rs-web-snippet', text: String(r.content).slice(0, overview ? 600 : 280) }) : null),
      quick(isKept(clipFor(work)), () => keepIt(work), () => { st.kept = null; st.selected = null; openReader(work); }));
    row.querySelector('.rs-hit-read').classList.add('rs-web-read');
    row.firstChild.addEventListener('click', () => { st.web1 = { ...r, canCrawl }; st.selected = null; st.kept = null; markOn(row); drawDetail(); if (narrow()) setPane('detail'); });
    return row;
  }

  function badge(v) {
    if (!v) return h('span', { class: 'rs-badge paid', text: t('research.noVersion') });
    return h('span', { class: `rs-badge ${v.free ? `free ${v.kind}` : 'paid'}`, text: versionLabel(v) });
  }
  const readable = (w) => !!w.text || planFor(w).steps.length > 0;

  function hitRow(w) {
    const best = bestFree(w) || w.versions[0];
    const clip = clipFor(w);
    const on = !st.kept && st.selected === w.key;
    const meta = [authorLine(w.authors), w.year, w.venue].filter(Boolean).join(' · ');
    const row = h('li', { class: `rs-hit${on ? ' on' : ''}`, dataset: { key: w.key } },
      h('button', { type: 'button', class: 'rs-hit-main', 'aria-pressed': String(on) },
        h('span', { class: 'rs-hit-title', text: w.title || t('research.untitled') }),
        meta ? h('span', { class: 'rs-hit-meta muted small', text: meta }) : null,
        h('span', { class: 'rs-hit-tags' }, badge(best), clip ? h('span', { class: 'rs-tag kept' }, iconEl('check'), h('span', { text: t('research.keptShort') })) : null)),
      quick(isKept(clip), () => keepIt(workOf(w)), readable(w) ? () => { st.kept = null; st.selected = w.key; openReader(workOf(w)); } : null));
    row.firstChild.addEventListener('click', () => select(w, row));
    return row;
  }
  function markOn(row) { for (const li of list.querySelectorAll('.rs-hit')) li.classList.toggle('on', li === row); }

  // a kept work in a list: tap shows it, the book reads it
  function clipRow(d) {
    const on = st.kept?.clip?.path === d.path;
    const row = h('li', { class: `rs-hit rs-clip${on ? ' on' : ''}`, dataset: { path: d.path } },
      h('button', { type: 'button', class: 'rs-hit-main', 'aria-pressed': String(on) },
        h('span', { class: 'rs-hit-title', text: d.title }),
        d.lead?.en ? h('span', { class: 'rs-hit-meta muted small', text: d.lead.en }) : null,
        d.marked ? h('span', { class: 'rs-hit-tags' }, h('span', { class: 'rs-tag', text: t('research.marked') })) : null),
      h('div', { class: 'rs-hit-actions' }, keyTitle(h('button', { type: 'button', class: 'icon-btn rs-hit-read', 'aria-label': t('research.read'), html: icon('book'), onclick: async (e) => {
        e.stopPropagation();
        const w = await workFromClip(d.path).catch(() => null);
        if (w) { st.kept = w; st.selected = null; openReader(w); }
      } }), t('research.read'), 'research.read')));
    row.firstChild.addEventListener('click', async () => {
      st.kept = await workFromClip(d.path);
      st.selected = null; st.web1 = null;
      markOn(row);
      drawDetail();
      if (narrow()) setPane('detail');
    });
    return row;
  }
  // a run through a website or the PDF inbox: one row, opens its pages in the list
  function siteRow(f, { adopt = false } = {}) {
    const running = f.crawl && (crawlState(f.path)?.status === 'running' || (f.crawl.on === 'mac' && f.crawl.state === 'running'));
    const open = h('button', { type: 'button', class: 'rs-hit-main rs-site' },
      h('span', { class: 'rs-hit-title' }, iconEl(running ? 'refresh' : f.pdfInbox ? 'download' : 'globe', running ? 'spin' : ''), h('span', { text: ` ${f.title}` })),
      h('span', { class: 'rs-hit-meta muted small', text: t(f.pdfInbox ? 'research.site.pdfs' : 'research.site.pages', { n: f.clips.length }) }));
    open.addEventListener('click', () => { st.folder = f.path; st.kept = null; drawList(); drawDetail(); });
    return h('li', { class: 'rs-hit rs-site-row', dataset: { path: f.path } }, open,
      adopt ? h('div', { class: 'rs-hit-actions' }, h('button', { type: 'button', class: 'btn small rs-adopt', onclick: () => adoptSite(f) }, iconEl('target'), h('span', { text: t('research.adopt') }))) : null);
  }

  function drawKept() {
    const p = focusProject();
    if (!p) {
      list.append(h('li', { class: 'rs-empty' }, h('p', { text: t('research.kept.noFocus') }),
        h('button', { type: 'button', class: 'btn', onclick: chooseInto }, iconEl('target'), h('span', { text: t('research.into.pick') }))));
      return;
    }
    const { sites, clips } = projectWorks(p);
    list.append(h('li', { class: 'rs-list-head' }, h('span', { class: 'rs-into-dot', style: `background:${projectAccent(p.slug).color}` }), h('strong', { text: p.title }),
      h('a', { class: 'small', href: nodeHref(p.path), text: t('research.toProject') })));
    if (!sites.length && !clips.length) { list.append(h('li', { class: 'rs-empty muted', text: t('research.kept.none', { project: p.title }) })); return; }
    for (const f of sites) list.append(siteRow(f));
    for (const d of clips) list.append(clipRow(d));
  }

  // What waits for a project (0.16.0): works kept without a focus, runs of no project, folders from before.
  function drawInbox() {
    const { sites, olds, clips, count } = inboxWorks();
    if (!count) { list.append(h('li', { class: 'rs-empty muted', text: t('research.inbox.none') })); return; }
    list.append(h('li', { class: 'rs-empty muted small rs-inbox-hint', text: t('research.inbox.hint') }));
    if (olds.length) {
      list.append(h('li', { class: 'rs-group-head' }, iconEl('folder'), h('strong', { text: t('research.oldFolders') })));
      list.append(h('li', { class: 'muted small rs-group-hint', text: t('research.oldFolders.hint') }));
      for (const f of olds) {
        list.append(h('li', { class: 'rs-hit rs-oldfolder', dataset: { path: f.path } },
          h('div', { class: 'rs-hit-main' }, h('span', { class: 'rs-hit-title', text: f.title }), h('span', { class: 'rs-hit-meta muted small', text: t('research.kept', { n: f.clips.length }) })),
          h('div', { class: 'rs-hit-actions' }, h('button', { type: 'button', class: 'btn small primary rs-adopt', onclick: () => adoptFolder(f) }, iconEl('target'), h('span', { text: t('research.adopt') })))));
      }
    }
    if (sites.length) {
      list.append(h('li', { class: 'rs-group-head' }, iconEl('globe'), h('strong', { text: t('research.sites') })));
      for (const f of sites) list.append(siteRow(f, { adopt: true }));
    }
    if (clips.length) {
      list.append(h('li', { class: 'rs-group-head' }, iconEl('bookmark'), h('strong', { text: t('research.inbox.works') })));
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
      for (const d of clips.slice(0, 200)) list.append(clipRow(d));
    }
  }

  // A folder from before 0.16.0 goes into a project: its works and its notes go along, the folder goes.
  async function adoptFolder(f) {
    const target = await pickProject(t('research.adopt.where', { title: f.title }), f.title);
    if (!target) return;
    try {
      await dissolveFolder(f.path, target);
      toast(t('research.adopted', { project: nodeByPath(target)?.title || '' }), 'ok');
    } catch (e) {
      console.warn('Could not move the folder', e);
      toast(t('create.failed'), 'error', 5000);
    }
    view.drawAll();
  }
  async function adoptSite(f) {
    const target = await pickProject(t('research.adopt.where', { title: f.title }), '');
    if (!target) return;
    await addToProject(target, [f.slug]);
    toast(t('research.adopted', { project: nodeByPath(target)?.title || '' }), 'ok');
    view.drawAll();
  }

  // a run through a website (0.14.3) or the PDF inbox: progress on top, the pages as a tree by path
  function drawFolder() {
    const f = currentFolder();
    if (!f) { st.folder = ''; drawList(); return; }
    const back = h('button', { type: 'button', class: 'btn small rs-folder-back', onclick: () => { st.folder = ''; st.kept = null; drawList(); drawDetail(); } }, iconEl('chevronLeft'), h('span', { text: t(st.list === 'inbox' ? 'research.tab.inboxShort' : st.list === 'kept' ? 'research.tab.keptShort' : 'research.hitsNone') }));
    const del = h('button', { type: 'button', class: 'btn small rs-folder-delete', onclick: () => removeFolder(f) }, iconEl('trash'), h('span', { text: t(f.pdfInbox ? 'research.folder.delete' : 'research.site.delete') }));
    list.append(h('li', { class: 'rs-folder-bar' }, back, h('strong', { class: 'rs-folder-title', text: f.title }), del));
    const clips = clipsIn(f);
    if (f.crawl) {
      if (panel?.folder !== f.path) { panel?.destroy(); panel = crawlPanel(f); } else panel.setFolder(f);
      list.append(h('li', { class: 'cr-wrap' }, panel.el));
      if (!clips.length) { list.append(h('li', { class: 'rs-empty muted', text: t('crawl.noPages') })); return; }
      const pick = async (d) => { st.kept = await workFromClip(d.path); st.selected = null; drawList(); drawDetail(); if (narrow()) setPane('detail'); };
      const read = async (d) => { const w = await workFromClip(d.path).catch(() => null); if (w) { st.kept = w; st.selected = null; openReader(w); } };
      list.append(h('li', { class: 'cr-tree-wrap' }, pageTree(f, clips, { selected: st.kept?.clip?.path || '', onPick: pick, onRead: read })));
      return;
    }
    if (f.pdfInbox) list.append(inboxBar());
    if (!clips.length) { list.append(h('li', { class: 'rs-empty muted', text: t('research.folder.empty') })); return; }
    for (const d of clips) list.append(clipRow(d));
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

  // ---------------------------------------------------------------- what you picked, on the right
  function select(w, row) {
    st.selected = w.key;
    st.kept = null; st.web1 = null;
    if (row) markOn(row);
    drawDetail();
    if (narrow()) setPane('detail');
    // No free version yet: look for one right away (an arXiv preprint, a copy in PMC).
    if (!workOf(w).free && !st.versions.has(w.key)) moreVersions(workOf(w));
  }

  function drawDetail() {
    right.replaceChildren();
    const back = h('button', { type: 'button', class: 'btn small back-btn rs-detail-back', onclick: () => setPane('results') }, iconEl('chevronLeft'), h('span', { text: t('research.backToList') }));
    const w = selectedWork();
    if (st.web1 && !w) right.append(back, webBox(st.web1));
    else if (w) right.append(back, workBox(w));
    else right.append(emptyBox());
  }

  // Nothing picked yet: how the window works, in three lines.
  function emptyBox() {
    const p = focusProject();
    return h('div', { class: 'rs-how' },
      h('h2', { text: t('research.how.title') }),
      h('ol', { class: 'rs-how-steps' },
        h('li', {}, h('strong', { text: t('research.how.find') }), h('span', { class: 'muted', text: t('research.how.find.text') })),
        h('li', {}, h('strong', { text: t('research.how.read') }), h('span', { class: 'muted', text: t('research.how.read.text') })),
        h('li', {}, h('strong', { text: t('research.how.keep') }), h('span', { class: 'muted', text: p ? t('research.how.keep.into', { project: p.title }) : t('research.how.keep.inbox') }))),
      h('p', { class: 'muted small rs-keys', text: t('research.keys') }));
  }

  // The actions everything on the right shares: read first, keep, open; the rest behind "More".
  function actionRow({ read, kept, onKeep, open, more }) {
    const p = focusProject();
    const keep = h('button', { type: 'button', class: `btn rs-keep-main${kept ? ' kept' : ''}` }, iconEl(kept ? 'check' : 'bookmark'),
      h('span', { text: kept ? t('research.keptShort') : p ? t('research.keepInto', { project: p.title }) : t('research.keepInbox') }));
    keep.addEventListener('click', onKeep);
    const moreBtn = more?.length ? h('button', { type: 'button', class: 'btn rs-more-actions', 'aria-label': t('research.moreActions'), title: t('research.moreActions') }, iconEl('more')) : null;
    moreBtn?.addEventListener('click', async () => {
      const v = await actionSheet(t('research.moreActions'), more.map((m) => (m === '-' ? '-' : { label: m.label, icon: m.icon, value: m.id, danger: m.danger })));
      more.find((m) => m.id === v)?.run();
    });
    return h('div', { class: 'rs-actions' },
      read ? h('button', { type: 'button', class: 'btn primary rs-read-main', onclick: read }, iconEl('book'), h('span', { text: t('research.read') })) : null,
      keep,
      open ? h('a', { class: 'btn', href: open, target: '_blank', rel: 'noopener noreferrer' }, iconEl('external'), h('span', { text: t('research.open') })) : null,
      moreBtn);
  }
  // where a kept work sits, with a way to take it out of the project you keep into
  function keptLine(clip) {
    if (!clip) return null;
    const inP = keptIn(clip.slug);
    const p = focusProject();
    const line = h('p', { class: 'small rs-kept-in' }, iconEl('check'), h('span', { text: inP.length ? t('research.inProjects', { list: inP.map((x) => x.title).join(', ') }) : t('research.inInbox') }));
    if (p && inP.some((x) => x.path === p.path)) {
      line.append(h('button', { type: 'button', class: 'link-btn small rs-takeout', text: t('research.takeOut', { project: p.title }), onclick: async () => { await removeFromProject(p.path, clip.slug); toast(t('research.removed'), 'ok'); view.drawAll(); } }));
    }
    return line;
  }

  function webBox(r) {
    const work = webWork(r);
    const clip = clipFor(work);
    const box = h('article', { class: 'rs-work' });
    box.append(h('h2', { class: 'rs-work-title', text: r.title || r.url }), h('p', { class: 'muted small', text: hostOf(r.url) }));
    const more = [];
    if (r.canCrawl !== false) more.push({ id: 'crawl', label: t('crawl.title'), icon: 'globe', run: () => openCrawl(r.url) });
    more.push({ id: 'copy', label: t('research.copyLink'), icon: 'copy', run: async () => { await copyText(r.url); toast(t('research.citeCopied'), 'ok'); } });
    box.append(actionRow({ read: () => { st.kept = null; st.selected = null; openReader(work); }, kept: isKept(clip), onKeep: () => keepIt(work), open: r.url, more }));
    box.append(...[keptLine(clip)].filter(Boolean));
    if (r.content) box.append(h('div', { class: 'rs-abstract' }, h('p', { text: String(r.content) })));
    return box;
  }

  function workBox(w) {
    const box = h('article', { class: 'rs-work' });
    const ids = w.ids || {};
    box.append(h('h2', { class: 'rs-work-title', text: w.title || t('research.untitled') }));
    if (w.authors.length) box.append(h('p', { class: 'rs-authors', text: authorLine(w.authors, 12) }));
    const idRow = h('p', { class: 'rs-ids small' });
    const where = [w.venue, w.year].filter(Boolean).join(', ');
    if (where) idRow.append(h('span', { class: 'muted', text: where }));
    const idLink = (label, href) => idRow.append(h('a', { href, target: '_blank', rel: 'noopener noreferrer', text: label }));
    if (ids.doi) idLink(`DOI ${ids.doi}`, `https://doi.org/${ids.doi}`);
    if (ids.arxiv) idLink(`arXiv:${ids.arxiv}`, `https://arxiv.org/abs/${ids.arxiv}`);
    if (ids.pmid) idLink(`PMID ${ids.pmid}`, `https://pubmed.ncbi.nlm.nih.gov/${ids.pmid}/`);
    if (ids.pmcid) idLink(ids.pmcid, `https://europepmc.org/article/PMC/${ids.pmcid}`);
    if (ids.isbn?.length) idRow.append(h('span', { text: `ISBN ${ids.isbn[0]}` }));
    if (idRow.childNodes.length) box.append(idRow);

    const clip = w.clip ? nodeByPath(w.clip.path) : clipFor(w);
    const best = bestFree(w) || w.versions[0];
    const vs = st.versions.get(w.key);
    const query = st.result?.query.text || st.query || '';
    const make = (kind) => async () => { const r = await createFromWork(kind, w, { folderPath: '', query }); if (r && kind !== 'snippet') view.drawAll(); };
    const more = [
      { id: 'cite', label: t('research.cite'), icon: 'copy', run: async () => { await copyText(citation(w)); toast(t('research.citeCopied'), 'ok'); } },
      ...(['page', 'document'].includes(w.type) ? [] : [{ id: 'versions', label: t(vs === 'busy' ? 'research.versionsBusy' : 'research.versionsMore'), icon: 'refresh', run: () => moreVersions(w) }]),
      '-',
      { id: 'card', label: t('research.make.card'), icon: 'vars', run: make('card') },
      { id: 'term', label: t('research.make.term'), icon: 'vars', run: make('term') },
      { id: 'snippet', label: t('research.make.snippet'), icon: 'code', run: make('snippet') },
      ...(clip ? ['-', { id: 'node', label: t('research.toNode'), icon: 'file', run: () => { location.hash = nodeHref(clip.path); } }] : []),
    ];
    box.append(actionRow({
      read: readable(w) ? () => openReader(w) : null,
      kept: isKept(clip), onKeep: () => keepIt(w),
      open: best ? ((best.pdf && best.free) || !best.url ? best.pdf : best.url) : '',
      more,
    }));
    const line = keptLine(clip);
    if (line) box.append(line);
    if (clip?.file) box.append(h('div', { class: 'btn-row' }, originalButton(clip)));
    if (clip && !w.clip && vs && vs !== 'busy' && vs.added) {
      const upd = h('button', { type: 'button', class: 'btn small' }, iconEl('download'), h('span', { text: t('research.updateClip') }));
      upd.addEventListener('click', async () => { if (await updateClipVersions(clip.path, w)) toast(t('research.updated'), 'ok'); upd.remove(); });
      box.append(h('div', { class: 'btn-row' }, upd));
    }
    if (!readable(w) && !bestFree(w)) box.append(h('p', { class: 'muted small rs-noread', text: t('research.noRead') }));
    if (!bestFree(w) && w.title && canWebSearch()) box.append(pdfSearch(w));

    if (w.abstract) {
      box.append(h('h3', { text: t('research.abstract') }));
      box.append(h('div', { class: 'rs-abstract' }, renderMarkdown(w.abstract.replace(/^(:::|#)/gm, '\\$1'), {})));
    }
    // versions folded: most of the time the first free one is all you need
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
    const fold = h('details', { class: 'rs-fold' }, h('summary', {}, h('span', { text: t('research.versionsN', { n: w.versions.length }) }), vs === 'busy' ? iconEl('refresh', 'spin') : null), vl);
    if (vs && vs !== 'busy') {
      const why = vs.failed.filter((x) => x.error === 'no-worker').length ? ` ${t('research.versionsNoWorker')}` : '';
      fold.append(h('p', { class: 'muted small rs-versions-note', text: `${vs.added ? t('research.versionsAdded', { n: vs.added }) : t('research.versionsNone')}${why}` }));
    }
    box.append(fold);
    if (w.sources?.length) box.append(h('p', { class: 'muted small', text: t('research.foundIn', { sources: w.sources.map((s) => sourceById(s)?.name || s).join(', ') }) }));
    if (w.clip) box.append(h('p', { class: 'muted small', text: t('research.clipFrom', { date: w.clip.fetched }) }));
    return box;
  }

  // a free copy somewhere on the web for a work without one: its title in quotes, only PDFs
  function pdfSearch(w) {
    const box = h('div', { class: 'rs-web-pdf' });
    const draw = () => {
      const x = st.webPdf.get(w.key);
      const go2 = h('button', { type: 'button', class: 'btn small rs-web-pdf-go', disabled: x?.state === 'busy' ? true : null }, iconEl(x?.state === 'busy' ? 'refresh' : 'search', x?.state === 'busy' ? 'spin' : ''), h('span', { text: t('research.web.pdf') }));
      go2.addEventListener('click', async () => {
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
      const found = x?.state === 'done' ? (x.results.length ? h('ul', { class: 'rs-web-pdf-list' }, x.results.map((r) => h('li', {}, h('button', { type: 'button', class: 'link-btn', text: r.title || hostOf(r.url), onclick: () => openReader(webWork(r)) }), h('span', { class: 'muted small', text: ` ${hostOf(r.url)}` }))))
        : h('p', { class: 'muted small', text: t('research.web.pdfNone') })) : x?.state === 'error' ? h('p', { class: 'muted small', text: t('research.web.error') }) : null;
      box.replaceChildren(...[go2, found].filter(Boolean));
    };
    draw();
    return box;
  }

  // One tap keeps it: in the project you keep into, otherwise in the inbox.
  async function keepIt(w) {
    const p = focusProject();
    try {
      const r = await keepWork(w, { folderPath: '', query: st.result?.query.text || st.query || '' });
      if (p) await addToProject(p.path, [r.slug]);
      toast(p ? t('research.keptInto', { project: p.title }) : t('research.keptInbox'), 'ok');
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
    // a run through a website: its pages go with it, unless you marked something in them or keep them elsewhere
    const pages = f.crawl ? runPages(f) : [];
    if (pages.length) {
      const pick = await modal({
        title: t('research.site.delete'), body: h('p', { text: t('research.folder.delete.run', { title: f.title, n: pages.length }) }), dismissValue: null,
        actions: [{ label: t('action.cancel'), value: null }, { label: t('research.folder.delete.only'), value: 'folder' }, { label: t('research.folder.delete.pages', { n: pages.length }), kind: 'danger', value: 'all' }],
      });
      if (!pick) return;
      if (pick === 'all') await deleteClips(pages.map((d) => d.path));
    } else if (!(await confirmDialog(t('research.site.delete'), t('research.folder.delete.confirm', { title: f.title, count: f.clips.length }), { okLabel: t('delete.ok'), danger: true }))) return;
    try {
      for (const p of projectsWith(f.slug)) await removeFromProject(p.path, f.slug);
      await deleteFolder(f.path);
      st.folder = '';
      st.kept = null;
      view.drawAll();
      toast(t('research.folder.deleted'), 'ok');
    } catch (e) {
      toast(t('snippet.failed', { error: e.message || String(e) }), 'error', 5000);
    }
  }

  // going through a website (0.14.3): the dialog, then its pages; the run joins the project in focus by itself
  async function openCrawl(start) {
    const folderPath = await crawlDialog({ start });
    if (!folderPath) return;
    st.folder = folderPath;
    st.list = focusProject() ? 'kept' : 'inbox';
    st.kept = null;
    st.address = '';
    view.drawAll();
    if (narrow()) setPane('results');
  }

  // the project in focus changes here or elsewhere: what "Keep in" and "Kept" show follows
  const stopFocus = onFocusChange(() => { if (!root.isConnected) { stopFocus(); return; } view.drawAll(); });

  // a run made elsewhere ("+", a project) comes to the front
  const show = loadPref('research.showFolder', '');
  if (show) { savePref('research.showFolder', ''); st.folder = show; st.list = focusProject() ? 'kept' : 'inbox'; st.kept = null; st.read = null; st.pane = 'results'; root.dataset.pane = st.pane; }
  // a search handed over by the command bar, a project or a note comes in front of the reader
  if (show || st.queued) st.read = null;
  if (st.queued) { st.list = 'hits'; st.folder = ''; }
  if (st.list === 'inbox' && !inboxWorks().count) st.list = 'hits';
  view.drawAll();
  const pendingCrawl = loadPref('crawl.open', '');
  if (pendingCrawl) { savePref('crawl.open', ''); setTimeout(() => openCrawl(pendingCrawl), 50); }
  showReader();
  readQueued();
  if (st.queued) { st.queued = false; run(st.query); } else if (!st.result && !st.learn && st.query) input.focus();
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
  st.web1 = null;
  st.list = 'hits';
  st.folder = '';
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
  st.list = 'hits';
  st.folder = '';
  st.web1 = null;
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

// A run through a website (0.14.3): new pages come into the tree, its row shows that it runs.
let lastCrawl = { status: '', pages: -1, at: 0 };
let crawlTimer = 0;
onCrawl((b) => {
  if (!view?.root.isConnected) return;
  const statusChanged = b.status !== lastCrawl.status;
  const pagesChanged = b.pages !== lastCrawl.pages;
  lastCrawl = { status: b.status, pages: b.pages, at: lastCrawl.at };
  if (!pagesChanged && !statusChanged) return;
  clearTimeout(crawlTimer);
  const wait = view.folderPath() === b.folder ? Math.max(0, 1200 - (Date.now() - lastCrawl.at)) : 2000;
  crawlTimer = setTimeout(() => { lastCrawl.at = Date.now(); if (view?.root.isConnected) view.drawList(); }, statusChanged ? 0 : wait);
});
