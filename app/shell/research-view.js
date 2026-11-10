// The research window (0.14.0): left your research folders, in the middle the hits of a search or what a folder
// keeps, on the right the work you picked with all its versions and the notes of the folder. On the iPhone the three
// areas are tabs. "Own window" opens the same view alone (index.html?solo=1).
import { h, toast, copyText, debounce, loadPref, savePref, promptDialog } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { SOURCES, sourceById } from '../services/research-sources.js';
import { bestFree, rankWorks, parseQuery, webUrl } from '../services/research-merge.js';
import { findVersions, hasWorker, researchSettings, setSourceOn, sourceOn, startSearch } from '../services/research.js';
import {
  clipFor, clipsIn, createFolder, folderNotes, folders, foldersWith, keepWork, removeFromFolder, saveFolderNotes,
  updateClipVersions, workFromClip,
} from '../services/research-store.js';
import { nodeByPath, onIndexChange } from '../services/search.js';
import { nodeHref } from './node-view.js';
import { renderMarkdown } from './markdown.js';

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
};
let view = null;         // the mounted view: { root, draw* }

const KIND_LABEL = { published: 'research.kind.published', accepted: 'research.kind.accepted', preprint: 'research.kind.preprint', other: 'research.kind.other' };
export const versionLabel = (v) => `${t(KIND_LABEL[v.kind] || KIND_LABEL.other)} · ${t(v.free ? 'research.free' : 'research.paid')}`;
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
const selectedWork = () => {
  if (st.kept) return st.kept;
  const w = st.result?.works.find((x) => x.key === st.selected);
  return w ? workOf(w) : null;
};

// ------------------------------------------------------------------ the view
export function renderResearch(main) {
  main.dataset.view = 'research';
  const root = h('div', { class: 'rs', dataset: { pane: st.pane } });
  const tabs = h('div', { class: 'rs-tabs segmented', role: 'tablist' });
  const left = h('aside', { class: 'rs-folders', 'aria-label': t('research.folders') });
  const mid = h('section', { class: 'rs-results', 'aria-label': t('research.results') });
  const right = h('section', { class: 'rs-detail', 'aria-label': t('research.details') });
  root.append(tabs, left, mid, right);
  main.append(root);

  // search bar
  const input = h('input', {
    class: 'field rs-input', type: 'search', enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: t('research.placeholder'), 'aria-label': t('research.placeholder'), value: st.query,
  });
  const go = h('button', { type: 'submit', class: 'btn primary rs-go' }, iconEl('search'), h('span', { text: t('research.search') }));
  const form = h('form', { class: 'rs-search', role: 'search' }, input, go);
  form.addEventListener('submit', (e) => { e.preventDefault(); run(input.value); input.blur(); });
  const filters = h('div', { class: 'rs-filters' });
  const sources = h('div', { class: 'rs-sources', 'aria-live': 'polite' });
  const notice = h('div', { class: 'rs-notice' });
  const switcher = h('div', { class: 'segmented rs-switch', role: 'group' });
  const list = h('ol', { class: 'rs-list' });
  mid.append(form, filters, switcher, sources, notice, list);

  view = {
    root, input,
    drawAll() { drawTabs(); drawFolders(); drawFilters(); drawSwitch(); drawSources(); drawNotice(); drawList(); drawDetail(); },
  };

  function setPane(p) { st.pane = p; root.dataset.pane = p; drawTabs(); }

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
    const items = h('ul', { class: 'rs-folder-list' });
    for (const f of all) {
      const on = f.path === st.folder;
      const b = h('button', { type: 'button', class: `rs-folder${on ? ' on' : ''}`, 'aria-current': on ? 'true' : null },
        iconEl(on ? 'folderOpen' : 'folder'), h('span', { class: 'rs-folder-name', text: f.title }), h('span', { class: 'rs-count', text: String(f.clips.length) }));
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
    left.replaceChildren(
      h('div', { class: 'rs-head' }, h('h2', { text: t('research.folders') }), add),
      all.length ? items : h('p', { class: 'muted small', text: t('research.folder.none') }),
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
    const n = st.result ? shownWorks().length : 0;
    switcher.replaceChildren(
      h('button', { type: 'button', class: st.list === 'hits' ? 'on' : '', 'aria-pressed': String(st.list === 'hits'), text: st.result ? t('research.hits', { n }) : t('research.hitsNone'), onclick: () => { st.list = 'hits'; drawAll2(); } }),
      h('button', { type: 'button', class: st.list === 'kept' ? 'on' : '', disabled: f ? null : true, 'aria-pressed': String(st.list === 'kept'), text: f ? t('research.kept', { n: f.clips.length }) : t('research.keptNone'), onclick: () => { st.list = 'kept'; drawAll2(); } }));
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
      const tip = on ? (stat?.state === 'error' ? t(`research.err.${stat.error}`, { name: src.name, status: stat.status || '' }) : stat?.state === 'skip' ? t('research.skip') : src.what[getLang()] || src.what.en) : t('research.sourceOff');
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
    const errors = Object.entries(st.result?.status || {}).filter(([, v]) => v.state === 'error');
    const lines = [];
    if (!hasWorker(s) && (sourceOn('arxiv', s) || sourceOn('doab', s))) lines.push(['info', t('research.needWorker')]);
    if (!s.openalexKey && sourceOn('openalex', s)) lines.push(['info', t('research.needKey')]);
    for (const [id, v] of errors) lines.push(['warn', `${sourceById(id).name}: ${t(`research.err.${v.error}`, { name: sourceById(id).name, status: v.status || '' })}`]);
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
    if (!st.result) {
      list.append(h('li', { class: 'rs-empty' }, h('p', { text: t('research.intro') }),
        h('ul', { class: 'muted small' }, ['research.example.topic', 'research.example.doi', 'research.example.arxiv', 'research.example.pmid'].map((k) => h('li', { text: t(k) })))));
      return;
    }
    const works = shownWorks();
    if (!works.length) {
      list.append(h('li', { class: 'rs-empty muted', text: st.result.finished ? t(st.onlyFree && st.result.works.length ? 'research.noneFree' : 'research.none') : t('research.searching') }));
      return;
    }
    for (const w of works.slice(0, 80)) list.append(hitRow(w));
    if (!st.result.finished) list.append(h('li', { class: 'rs-empty muted small' }, iconEl('refresh', 'spin'), h('span', { text: ` ${t('research.more')}` })));
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
    const keep = h('button', { type: 'button', class: `btn small${clip ? ' kept' : ''}`, title: t(clip ? 'research.keptAlready' : 'research.keep') }, iconEl(clip ? 'check' : 'bookmark'), h('span', { text: t(clip ? 'research.keptShort' : 'research.keep') }));
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
    if (!f) return;
    const clips = clipsIn(f);
    if (!clips.length) { list.append(h('li', { class: 'rs-empty muted', text: t('research.folder.empty') })); return; }
    for (const d of clips) {
      const on = st.kept?.clip?.path === d.path;
      const row = h('li', { class: `rs-hit${on ? ' on' : ''}` },
        h('button', { type: 'button', class: 'rs-hit-main', 'aria-pressed': String(on) },
          h('span', { class: 'rs-hit-title', text: d.title }),
          d.lead?.en ? h('span', { class: 'rs-hit-meta muted small', text: d.lead.en }) : null,
          h('span', { class: 'rs-hit-tags' }, !d.verified ? h('span', { class: 'rs-tag', text: t('research.unchecked') }) : null)),
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
          v.url ? h('a', { class: 'btn small', href: v.url, target: '_blank', rel: 'noopener noreferrer' }, iconEl('external'), h('span', { text: t('research.openPage') })) : null,
          v.pdf ? h('a', { class: 'btn small', href: v.pdf, target: '_blank', rel: 'noopener noreferrer' }, iconEl('file'), h('span', { text: 'PDF' })) : null)));
    }
    if (!w.versions.length) vl.append(h('li', { class: 'muted small', text: t('research.noVersion') }));
    box.append(vl);
    const vs = st.versions.get(w.key);
    const more = h('button', { type: 'button', class: 'btn small', disabled: vs === 'busy' ? true : null },
      iconEl('refresh', vs === 'busy' ? 'spin' : ''), h('span', { text: t(vs === 'busy' ? 'research.versionsBusy' : 'research.versionsMore') }));
    more.addEventListener('click', () => moreVersions(w));
    const row = h('div', { class: 'btn-row rs-work-actions' }, more);
    if (vs && vs !== 'busy') {
      const why = vs.failed.filter((x) => x.error === 'no-worker').length ? ` ${t('research.versionsNoWorker')}` : '';
      box.append(h('p', { class: 'muted small rs-versions-note', text: `${vs.added ? t('research.versionsAdded', { n: vs.added }) : t('research.versionsNone')}${why}` }));
    }

    // keep it
    const clip = w.clip ? nodeByPath(w.clip.path) : clipFor(w);
    if (clip) {
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
    if (!w.clip) box.append(keepForm(w, clip));
    const cite = h('button', { type: 'button', class: 'btn small' }, iconEl('copy'), h('span', { text: t('research.cite') }));
    cite.addEventListener('click', async () => { await copyText(citation(w)); toast(t('research.citeCopied'), 'ok'); });
    row.append(cite);
    box.append(row);

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

  async function keepQuick(w) {
    if (!st.folder) {
      st.selected = w.key; st.kept = null;
      drawDetail(); drawTabs();
      if (narrow()) setPane('detail');
      right.querySelector('.rs-keep select')?.focus();
      return;
    }
    try {
      const r = await keepWork(workOf(w), { folderPath: st.folder, query: st.result?.query.text || '' });
      toast(t(r.existed ? 'research.keptToastAgain' : 'research.keptToast', { folder: currentFolder()?.title || '' }), 'ok');
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

  // ---------------------------------------------------------------- notes of the folder
  function notesBox(f) {
    const box = h('section', { class: 'rs-notes' }, h('h3', {}, iconEl('folderOpen'), h('span', { text: f.title })));
    const question = h('input', { class: 'field', type: 'text', placeholder: t('research.question'), 'aria-label': t('research.question') });
    const notes = h('textarea', { class: 'field rs-notes-text', rows: '8', placeholder: t('research.notesHint'), 'aria-label': t('research.notes') });
    const state = h('span', { class: 'muted small rs-saved' });
    box.append(h('label', { class: 'set-field' }, h('span', { class: 'field-label', text: t('research.question') }), question),
      h('label', { class: 'set-field' }, h('span', { class: 'field-label', text: t('research.notes') }), notes),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn small', href: nodeHref(f.path) }, iconEl('search'), h('span', { text: t('research.folderNode') })), state));
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

  view.drawAll();
  if (st.queued) { st.queued = false; run(st.query); } else if (!st.result && st.query) input.focus();
  return view;
}

// The command bar hands over what you typed: the research window searches it when it opens.
export function queueSearch(q) {
  st.query = String(q || '').trim();
  st.queued = !!st.query;
}

// ------------------------------------------------------------------ searching
function run(raw) {
  const q = String(raw || '').trim();
  if (!q) return;
  st.query = q;
  savePref('research.query', q);
  st.search?.cancel();
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
  view?.drawAll();
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
