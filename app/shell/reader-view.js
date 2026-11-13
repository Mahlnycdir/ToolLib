// The reader (0.14.1): a work's text in the middle, its outline on the left, your highlights and notes on the right.
// On the iPhone the three are tabs. It opens inside the research window (research-view.js). What it reads comes from
// services/reader.js; a work you kept keeps the text and your highlights in its clip, so both are there offline.
import { h, toast, copyText, debounce, loadPref, modal, savePref, keepScroll } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { getLang, t } from '../i18n/i18n.js';
import { renderMarkdown } from './markdown.js';
import { outlineOf, planFor, readWork } from '../services/reader.js';
import { clipFor, keepWork, loadClipDoc, saveClipDoc, saveHighlights } from '../services/research-store.js';
import { hasFetcher, researchSettings } from '../services/research.js';
import { clipForEntry, createCard, knowledgeFor, linkCitations, madeFrom, referenceEntry, searchTermFor } from '../services/reader-cards.js';
import { insertIntoPage } from '../services/library-store.js';
import { nodeByPath } from '../services/search.js';
import { cardDialog } from './card-dialog.js';
import { nodeHref, typeLabel } from './node-view.js';
import { buildIndex, findQuote, selectionQuote, unwrap, wrapRange } from './reader-marks.js';
import { clipByUrl } from '../services/crawl.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const narrow = () => window.matchMedia('(max-width: 759px)').matches;
const tick = () => new Promise((r) => setTimeout(r, 0));
const SIZES = ['s', 'm', 'l'];

// Pieces of the text for step by step drawing: at first-level headings, and inside long stretches at blank lines.
export function splitChunks(markdown, max = 12000) {
  const chunks = [];
  let cur = [];
  let size = 0;
  let fence = false;
  let math = false;
  const push = () => { if (cur.length) chunks.push(cur.join('\n')); cur = []; size = 0; };
  for (const line of markdown.split('\n')) {
    const tl = line.trim();
    if (/^(```|~~~)/.test(tl)) fence = !fence;
    else if (!fence && tl === '$$') math = !math;
    const free = !fence && !math;
    if (free && /^###\s/.test(line) && cur.length) push();
    else if (free && size > max && tl === '') push();
    cur.push(line);
    size += line.length + 1;
  }
  push();
  return chunks;
}

export function errorKey(e) {
  const code = e?.code || 'failed';
  const known = ['no-worker', 'worker-token', 'worker-origin', 'worker', 'helper-token', 'helper-origin', 'helper', 'blocked', 'not-found', 'http', 'rate', 'too-large', 'network', 'timeout', 'offline', 'no-source', 'bad-source', 'nothing', 'aborted', 'bad-url'];
  return `reader.err.${known.includes(code) ? code : 'failed'}`;
}

// opts: { work, version, folderPath, query, onBack, onChange }
export function mountReader(host, opts) {
  const { work } = opts;
  const workKey = work.key || work.title;
  const state = {
    doc: null, clipPath: clipFor(work)?.path || work.clip?.path || null, stored: false, highlights: [], pending: null,
    pane: 'text', marksTab: 'marks', knowQuery: '', knowAt: '', code: '', size: loadPref('reader.size', 'm'), error: null, busy: null, rendering: false, heads: [], seq: 0,
  };
  let abort = null;
  let renderToken = 0;
  let destroyed = false;

  const root = h('div', { class: 'rd', dataset: { pane: 'text', size: state.size } });
  const bar = h('header', { class: 'rd-bar' });
  const selbar = h('div', { class: 'rd-selbar', hidden: true, role: 'toolbar', 'aria-label': t('reader.selection') });
  const tabs = h('div', { class: 'rd-tabs segmented', role: 'tablist' });
  const notices = h('div', { class: 'rd-notices' });
  const status = h('div', { class: 'rd-status', 'aria-live': 'polite' });
  // the outline and the highlights keep their place while the text shows on the phone (0.22.0); the text has its own
  const outlineEl = keepScroll(h('nav', { class: 'rd-outline', 'aria-label': t('reader.outline') }));
  const textEl = h('article', { class: 'rd-text' });
  const inner = h('div', { class: 'rd-inner' });
  textEl.append(inner);
  const marksEl = keepScroll(h('aside', { class: 'rd-marks', 'aria-label': t('reader.marks') }));
  root.append(bar, selbar, tabs, notices, status, h('div', { class: 'rd-body' }, outlineEl, textEl, marksEl));
  host.append(root);

  // ---------------------------------------------------------------- bar and tabs
  const viaLabel = () => {
    const via = state.doc?.via;
    return via ? t(`reader.via.${via}`) : '';
  };
  const openUrl = () => state.doc?.finalUrl || state.doc?.url || planFor(work, opts.version).openUrl;

  function drawBar() {
    const back = h('button', { type: 'button', class: 'btn small', 'aria-label': t('reader.back'), onclick: () => opts.onBack?.() }, iconEl('chevronLeft'), h('span', { text: t('reader.back') }));
    const title = h('div', { class: 'rd-title', title: work.title }, h('span', { text: state.doc?.title || work.title || t('research.untitled') }));
    const via = state.doc ? h('span', { class: 'rs-tag', text: viaLabel() }) : null;
    const open = openUrl();
    const link = open ? h('a', { class: 'btn small', 'aria-label': t('reader.open'), href: open, target: '_blank', rel: 'noopener noreferrer' }, iconEl('external'), h('span', { text: t('reader.open') })) : null;
    let save = null;
    if (state.doc) {
      if (state.stored) {
        const savedText = state.doc.fetched ? t('reader.savedOn', { date: state.doc.fetched }) : t('reader.saved');
        save = h('span', { class: 'rd-saved small', title: savedText }, iconEl('check'), h('span', { text: savedText }));
      } else {
        save = h('button', { type: 'button', class: 'btn small primary', onclick: () => ensureClip(true) }, iconEl('bookmark'), h('span', { text: t(state.clipPath ? 'reader.saveText' : 'reader.keepSave') }));
      }
    }
    const again = state.doc ? h('button', { type: 'button', class: 'btn small', title: t('reader.refetch'), 'aria-label': t('reader.refetch'), onclick: () => load({ refetch: true }) }, iconEl('refresh')) : null;
    const size = h('button', { type: 'button', class: 'btn small rd-size', title: t('reader.size'), 'aria-label': t('reader.size'), onclick: cycleSize }, h('span', { text: 'Aa' }));
    bar.replaceChildren(...[back, title, via, save, link, again, size].filter(Boolean));   // null would show as the word "null" (until 0.15.1 while loading and after an error)
  }

  function cycleSize() {
    state.size = SIZES[(SIZES.indexOf(state.size) + 1) % SIZES.length];
    savePref('reader.size', state.size);
    root.dataset.size = state.size;
  }

  function drawTabs() {
    tabs.replaceChildren(...[['text', 'reader.tab.text'], ['outline', 'reader.tab.outline'], ['marks', 'reader.tab.marks']].map(([id, key]) => h('button', {
      type: 'button', role: 'tab', class: state.pane === id ? 'on' : '', 'aria-selected': String(state.pane === id),
      text: id === 'marks' && state.highlights.length ? `${t(key)} (${state.highlights.length})` : t(key), onclick: () => setPane(id),
    })));
  }
  function setPane(p) { state.pane = p; root.dataset.pane = p; drawTabs(); }

  // ---------------------------------------------------------------- loading
  function say(info) {
    if (!info) { status.replaceChildren(); return; }
    let text;
    if (info.step === 'fetch') {
      const what = t(`reader.what.${info.via}`);
      const pct = info.total ? ` ${Math.round((info.got / info.total) * 100)} %` : info.got ? ` ${(info.got / 1048576).toFixed(1)} MB` : '';
      text = t('reader.loading.fetch', { what }) + pct;
    } else text = info.page ? t('reader.loading.page', { n: info.page, total: info.pages }) : t(`reader.loading.${info.via === 'arxiv-source' ? 'latex' : 'convert'}`);
    const cancel = h('button', { type: 'button', class: 'btn small', onclick: () => abort?.abort() }, h('span', { text: t('action.cancel') }));
    status.replaceChildren(h('div', { class: 'rd-busy' }, iconEl('refresh', 'spin'), h('span', { text }), cancel));
  }

  function fail(e) {
    const key = errorKey(e);
    const worker = ['no-worker', 'worker-token', 'worker-origin', 'worker', 'helper-token', 'helper-origin', 'helper'].includes(e?.code);
    const msg = h('div', { class: 'rd-error' }, iconEl('warn'), h('div', {},
      h('p', { text: t(key, { status: e?.status || '' }) }),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn small primary', onclick: () => load({ refetch: true }) }, iconEl('refresh'), h('span', { text: t('reader.retry') })),
        worker ? h('a', { class: 'btn small', href: '#/settings/research' }, iconEl('settings'), h('span', { text: t('research.toSettings') })) : null,
        openUrl() ? h('a', { class: 'btn small', href: openUrl(), target: '_blank', rel: 'noopener noreferrer' }, iconEl('external'), h('span', { text: t('reader.open') })) : null)));
    status.replaceChildren(msg);
  }

  async function load({ refetch = false } = {}) {
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    state.error = null;
    say({ step: 'fetch', via: 'auto' });
    try {
      // what the clip keeps: highlights always, the text unless you want it fetched again
      let stored = null;
      if (state.clipPath) {
        stored = await loadClipDoc(state.clipPath);
        state.highlights = stored.highlights.map(withId);
      }
      if (stored?.markdown && !refetch) {
        state.doc = { title: stored.meta.title ? String(stored.meta.title) : work.title, markdown: stored.markdown, references: stored.references, via: stored.via || 'html', url: stored.url, finalUrl: stored.url, fetched: stored.fetched, warnings: [], abstract: '' };
        state.stored = true;
        say(null);
        await show();
        return;
      }
      const plan = planFor(work, opts.version);
      const doc = await readWork(plan, { signal, onStatus: say });
      if (destroyed) return;
      state.doc = doc;
      state.stored = false;
      say(null);
      if (state.clipPath) { await saveClipDoc(state.clipPath, doc); state.stored = true; opts.onChange?.(); }
      await show();
    } catch (e) {
      if (destroyed) return;
      state.doc = state.doc && refetch ? state.doc : null;
      fail(e);
      drawBar();
    }
  }

  const withId = (hl) => ({ ...hl, id: `h${++state.seq}`, els: [] });

  // Links to pages you went through (0.14.3) open them here, from your knowledge, also offline.
  function markLocal(sec) {
    if (!opts.onOpenClip) return;
    for (const a of sec.querySelectorAll('a[href^="http"]')) {
      const d = clipByUrl(a.href);
      if (!d || d.path === state.clipPath) continue;
      a.classList.add('rd-local');
      a.dataset.clip = d.path;
      a.removeAttribute('target');
      a.title = t('reader.localLink', { title: d.title });
    }
  }
  inner.addEventListener('click', (e) => {
    const a = e.target.closest?.('a.rd-local');
    if (!a || !opts.onOpenClip || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    opts.onOpenClip(a.dataset.clip);
  });

  // ---------------------------------------------------------------- showing the text
  async function show() {
    const token = ++renderToken;
    const { doc } = state;
    drawBar();
    drawTabs();
    notices.replaceChildren(...warningLines(doc).map(([kind, text]) => h('p', { class: `rs-line ${kind}` }, iconEl(kind === 'warn' ? 'warn' : 'info'), h('span', { text }))));
    drawOutline();
    inner.replaceChildren();
    state.heads = [];
    for (const hl of state.highlights) hl.els = [];
    drawMarks();
    const chunks = splitChunks(doc.markdown);
    state.rendering = true;
    const onCopy = async (text) => { const ok = await copyText(text); toast(t(ok ? 'node.copied' : 'node.copyFailed'), ok ? 'ok' : 'error'); };
    for (let i = 0; i < chunks.length; i++) {
      if (token !== renderToken || destroyed) return;
      const sec = h('section', { class: 'rd-sec' }, renderMarkdown(chunks[i], { onCopy }));
      if (doc.references?.length) linkCitations(sec, (n) => !!referenceEntry(doc.references, n));
      markLocal(sec);
      inner.append(sec);
      applyHighlights(sec);
      if (i === 0) restorePosition();
      if (i % 2 === 1) await tick();
    }
    if (doc.references?.length) {
      const refs = h('section', { class: 'rd-sec rd-refs' }, renderMarkdown(`### ${t('reader.references')}\n\n${doc.references.join('\n\n')}`, { onCopy }));
      inner.append(refs);
      applyHighlights(refs);
    }
    state.rendering = false;
    state.heads = [...inner.querySelectorAll('h3, h4')];
    applyHighlights(inner);
    drawMarks();
    restorePosition();
    trackSection();
  }

  function warningLines(doc) {
    const out = [];
    for (const w of doc.warnings || []) {
      if (w.startsWith('fallback:')) out.push(['warn', t('reader.warn.fallback', { why: t(`reader.err.${w.slice(9)}`) })]);
      else if (w === 'thin') out.push(['warn', t('reader.warn.thin')]);
      else if (w === 'no-text') out.push(['warn', t('reader.warn.noText')]);
      else if (w === 'truncated') out.push(['info', t('reader.warn.truncated')]);
      else if (w === 'pdf-only') out.push(['info', t('reader.warn.pdfOnly')]);
    }
    if (doc.via === 'pdf') out.push(['info', t('reader.warn.pdfFormulas')]);
    return out;
  }

  // ---------------------------------------------------------------- outline
  function drawOutline() {
    const doc = state.doc;
    const items = outlineOf(doc.markdown);
    const list = h('ol', { class: 'rd-outline-list' });
    items.forEach((it, k) => {
      const b = h('button', { type: 'button', class: `rd-o rd-o${it.level}`, dataset: { k: String(k) }, text: it.title });
      b.addEventListener('click', () => goHeading(k));
      list.append(h('li', {}, b));
    });
    if (doc.references?.length) {
      const b = h('button', { type: 'button', class: 'rd-o rd-o1 rd-o-refs', dataset: { k: 'refs' }, text: `${t('reader.references')} (${doc.references.length})` });
      b.addEventListener('click', () => { scrollToEl(inner.querySelector('.rd-refs')); });
      list.append(h('li', {}, b));
    }
    outlineEl.replaceChildren(h('h3', { text: t('reader.outline') }), items.length || doc.references?.length ? list : h('p', { class: 'muted small', text: t('reader.noOutline') }));
  }
  function scrollToEl(el) {
    if (!el) { textEl.scrollTo({ top: textEl.scrollHeight }); return; }
    if (narrow()) setPane('text');
    requestAnimationFrame(() => { textEl.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - textEl.getBoundingClientRect().top + textEl.scrollTop - 12), behavior: 'smooth' }); });
  }
  function goHeading(k) { scrollToEl(state.heads[k] || inner.querySelectorAll('h3, h4')[k]); }

  // the section you are in
  let ticking = false;
  function trackSection() {
    const top = textEl.getBoundingClientRect().top + 60;
    let at = -1;
    state.heads.forEach((el, k) => { if (el.getBoundingClientRect().top <= top) at = k; });
    const refs = state.heads.length && at === state.heads.length - 1 && inner.querySelector('.rd-refs h3') === state.heads[at];
    for (const b of outlineEl.querySelectorAll('.rd-o')) b.classList.toggle('on', refs ? b.dataset.k === 'refs' : b.dataset.k === String(at));
    ticking = false;
    const here = refs ? '' : (state.heads[at]?.textContent || '').trim();
    if (here !== state.section) { state.section = here; if (state.marksTab === 'know' && !state.knowQuery) drawKnowList(); }
  }
  const posKey = () => state.clipPath || workKey;
  const savePos = debounce(() => {
    if (state.rendering || !state.doc) return;
    const all = loadPref('reader.pos', {});
    all[posKey()] = Math.round(textEl.scrollTop);
    const keys = Object.keys(all);
    if (keys.length > 60) delete all[keys[0]];
    savePref('reader.pos', all);
  }, 500);
  textEl.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(trackSection); }
    savePos();
  }, { passive: true });
  let restored = false;
  function restorePosition() {
    if (restored) return;
    const y = loadPref('reader.pos', {})[posKey()];
    if (y && textEl.scrollHeight > y + textEl.clientHeight) { textEl.scrollTop = y; restored = true; } else if (!state.rendering) restored = true;
  }

  // ---------------------------------------------------------------- highlights
  const makeMark = (hl) => () => { const m = document.createElement('mark'); m.className = 'rd-hl'; m.dataset.hl = hl.id; return m; };

  function applyHighlights(scope) {
    for (const hl of state.highlights) {
      if (hl.els?.length) continue;
      const index = buildIndex(scope);
      const pos = findQuote(index, hl.quote);
      if (!pos) continue;
      hl.els = wrapRange(index, pos.start, pos.end, makeMark(hl));
    }
  }

  function removeMarks(hl) { unwrap(hl.els || []); hl.els = []; }

  const persist = debounce(async () => {
    if (destroyed) return;
    try {
      await ensureClip(false);
      await saveHighlights(state.clipPath, state.highlights.map(({ quote, section, note }) => ({ quote, section, note })));
    } catch (e) {
      console.warn('Could not save highlights', e);
      toast(t('reader.saveFailed'), 'error', 5000);
    }
  }, 700);

  // The work becomes a clip when you highlight or save; the text goes with it.
  async function ensureClip(announce) {
    if (!state.doc) return null;
    if (!state.clipPath) {
      const r = await keepWork(work, { folderPath: opts.folderPath, query: opts.query });
      state.clipPath = r.clipPath;
      toast(t('reader.keptToast'), 'ok');
    }
    if (!state.stored && state.doc.markdown) {
      await saveClipDoc(state.clipPath, state.doc);
      state.stored = true;
      if (announce) toast(t('reader.savedToast'), 'ok');
    }
    drawBar();
    opts.onChange?.();
    return state.clipPath;
  }

  function addHighlight(withNote) {
    const q = state.pending;
    if (!q) return;
    state.pending = null;
    selbar.hidden = true;
    window.getSelection()?.removeAllRanges();
    const text = q.text.slice(0, 1500);
    if (state.highlights.some((x) => x.quote === text)) { toast(t('reader.markExists'), 'info'); return; }
    const hl = withId({ quote: text, section: q.section, note: '' });
    state.highlights.push(hl);
    applyHighlights(inner);
    drawMarks();
    drawTabs();
    persist();
    if (withNote) {
      if (narrow()) setPane('marks');
      requestAnimationFrame(() => marksEl.querySelector(`[data-id="${hl.id}"] textarea`)?.focus());
    }
  }

  function drawMarks() {
    const list = h('ul', { class: 'rd-mark-list' });
    for (const hl of state.highlights) {
      const note = h('textarea', { class: 'field rd-note', rows: '2', placeholder: t('reader.notePlaceholder'), 'aria-label': t('reader.note') });
      note.value = hl.note || '';
      note.addEventListener('input', () => { hl.note = note.value; persist(); });
      const del = h('button', { type: 'button', class: 'icon-btn', title: t('reader.remove'), 'aria-label': t('reader.remove'), html: icon('trash') });
      del.addEventListener('click', () => {
        removeMarks(hl);
        state.highlights = state.highlights.filter((x) => x !== hl);
        drawMarks();
        drawTabs();
        persist();
      });
      const go = h('button', { type: 'button', class: 'rd-quote', title: t('reader.goto') }, h('span', { text: hl.quote.length > 240 ? `${hl.quote.slice(0, 237)}…` : hl.quote }));
      go.addEventListener('click', () => {
        if (!hl.els?.length) return;
        if (narrow()) setPane('text');
        requestAnimationFrame(() => { scrollToEl(hl.els[0]); flash(hl); });
      });
      list.append(h('li', { class: 'rd-mark', dataset: { id: hl.id } },
        h('div', { class: 'rd-mark-head' }, hl.section ? h('span', { class: 'rs-tag', text: hl.section.length > 40 ? `${hl.section.slice(0, 38)}…` : hl.section }) : null, !hl.els?.length && !state.rendering ? h('span', { class: 'rs-tag muted', text: t('reader.notFound') }) : null, del),
        go, note));
    }
    marksHost.replaceChildren(state.highlights.length ? list : h('p', { class: 'muted small', text: t('reader.marks.none') }));
    drawSub();
  }

  // ---------------------------------------------------------------- your knowledge (0.14.1, part 2)
  const marksHost = h('div', { class: 'rd-marks-body' });
  const knowHost = h('div', { class: 'rd-know' });
  marksEl.append(h('div', { class: 'rd-sub' }), marksHost, knowHost);
  const subEl = marksEl.firstChild;

  function drawSub() {
    const made = madeFrom(work, state.clipPath || '').length;
    subEl.replaceChildren(...[['marks', 'reader.tab.marks', state.highlights.length], ['know', 'reader.know', made]].map(([id, key, n]) => h('button', {
      type: 'button', class: state.marksTab === id ? 'on' : '', 'aria-pressed': String(state.marksTab === id),
      text: n ? `${t(key)} (${n})` : t(key), onclick: () => setMarksTab(id),
    })));
    marksHost.hidden = state.marksTab !== 'marks';
    knowHost.hidden = state.marksTab !== 'know';
  }
  function setMarksTab(id) {
    state.marksTab = id;
    drawSub();
    if (id === 'know') drawKnow();
  }

  const nodeTitle = (d) => (getLang() === 'de' && d.title_de ? d.title_de : d.title);
  function knowItem(d) {
    return h('li', {}, h('a', { class: 'rd-know-item', href: nodeHref(d.path) },
      h('span', { class: 'rs-tag', text: typeLabel(d.type) }),
      h('span', { class: 'rd-know-title', text: nodeTitle(d) }),
      d.lead?.[getLang()] || d.lead?.en ? h('span', { class: 'rd-know-lead muted small', text: (d.lead[getLang()] || d.lead.en).slice(0, 110) }) : null));
  }
  function drawKnowList() {
    const list = knowHost.querySelector('.rd-know-results');
    if (!list) return;
    const query = state.knowQuery || state.section || '';
    const hits = knowledgeFor(query, { skip: state.clipPath || '', limit: 6 });
    const made = madeFrom(work, state.clipPath || '');
    const madePaths = new Set(made.map((d) => d.path));
    const rest = hits.filter((d) => !madePaths.has(d.path));
    list.replaceChildren(...[
      made.length ? h('h4', { text: t('reader.know.made') }) : null,
      made.length ? h('ul', { class: 'rd-know-list' }, ...made.map(knowItem)) : null,
      h('h4', { text: state.knowQuery ? t('reader.know.search') : t('reader.know.here') }),
      !state.knowQuery && state.section ? h('p', { class: 'muted small rd-know-sec', text: state.section.slice(0, 80) }) : null,
      rest.length ? h('ul', { class: 'rd-know-list' }, ...rest.map(knowItem)) : h('p', { class: 'muted small', text: t('reader.know.none') }),
    ].filter(Boolean));
  }
  function drawKnow() {
    const input = h('input', { class: 'field', type: 'search', placeholder: t('reader.know.placeholder'), 'aria-label': t('reader.know.placeholder'), value: state.knowQuery });
    input.addEventListener('input', debounce(() => { state.knowQuery = input.value.trim(); drawKnowList(); }, 200));
    knowHost.replaceChildren(input, h('div', { class: 'rd-know-results' }));
    drawKnowList();
  }

  // ---------------------------------------------------------------- cards and snippets from the selection
  const workUrl = () => (work.ids?.doi ? `https://doi.org/${work.ids.doi}` : work.ids?.arxiv ? `https://arxiv.org/abs/${work.ids.arxiv}` : work.url || state.doc?.url || '');

  function takeSelection() {
    const q = state.pending;
    if (!q) return null;
    const code = state.code;
    state.pending = null;
    selbar.hidden = true;
    window.getSelection()?.removeAllRanges();
    return { q, code };
  }

  async function newCard() {
    const got = takeSelection();
    if (!got) return;
    const { q } = got;
    const values = await cardDialog({ text: q.text.slice(0, 3000), section: q.section || '', workTitle: work.title });
    if (!values) return;
    try {
      const clipPath = await ensureClip(false);
      const clipSlug = clipPath.slice(clipPath.lastIndexOf('/') + 1).replace(/\.md$/, '');
      await createCard({ ...values, section: q.section || '', work: { title: work.title, url: workUrl() }, clipSlug });
      if (values.topic) savePref('reader.topic', values.topic);
      toast(t('reader.card.made', { title: values.title }), 'ok');
      drawSub();
      if (state.marksTab === 'know') drawKnowList();
    } catch (e) {
      console.warn('Could not create the card', e);
      toast(t('reader.card.failed'), 'error', 5000);
    }
  }

  async function newSnippet() {
    const got = takeSelection();
    if (!got || !got.code.trim()) return;
    try {
      const clipPath = await ensureClip(false);
      const clipSlug = clipPath.slice(clipPath.lastIndexOf('/') + 1).replace(/\.md$/, '');
      savePref('snippet.draft', { from: clipPath, fromTitle: work.title, group: '', links: [clipSlug], code: got.code.replace(/\s+$/, ''), check: '' });
      location.hash = '#/new';
    } catch (e) {
      console.warn('Could not start the snippet', e);
      toast(t('reader.card.failed'), 'error', 5000);
    }
  }

  // "Into page" (0.14.2): the passage goes as a quote with its source into the page you last had open, where you left the cursor.
  const targetPage = () => { const tg = loadPref('library.target', null); return tg?.path ? nodeByPath(tg.path) : null; };
  async function toPage() {
    const page = targetPage();
    const got = takeSelection();
    if (!got || !page) return;
    try {
      const clipPath = await ensureClip(false);
      const clipSlug = clipPath.slice(clipPath.lastIndexOf('/') + 1).replace(/\.md$/, '');
      const next = await insertIntoPage(loadPref('library.target', null), {
        quote: got.q.text.slice(0, 3000), section: got.q.section || '', work: { title: work.title, authors: work.authors || [], year: work.year }, url: workUrl(), clipSlug,
      });
      if (!next) { toast(t('library.toPage.gone'), 'error'); return; }
      savePref('library.target', next);
      toast(t('library.toPage.done', { title: nodeByPath(next.path)?.title || page.title }), 'ok');
      drawSub();
      if (state.marksTab === 'know') drawKnowList();
    } catch (e) {
      console.warn('Could not put the passage into the page', e);
      toast(t('library.toPage.failed'), 'error', 5000);
    }
  }

  function knowSelection() {
    const got = takeSelection();
    if (!got) return;
    state.knowQuery = got.q.text.replace(/\$\$?/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (narrow()) setPane('marks');
    setMarksTab('know');
  }

  // ---------------------------------------------------------------- the reference [12]
  textEl.addEventListener('click', (e) => {
    const a = e.target.closest?.('a.rd-cite');
    if (!a) return;
    e.preventDefault();
    openCite(a.dataset.cite.split(',').map(Number));
  });
  function openCite(nums) {
    let close = () => {};
    const rows = nums.map((n) => {
      const entry = referenceEntry(state.doc?.references, n);
      if (!entry) return null;
      const have = clipForEntry(entry);
      return h('div', { class: 'rd-cite-row' },
        h('p', { class: 'rd-cite-entry' }, h('strong', { text: `[${n}] ` }), entry),
        have ? h('p', { class: 'muted small', text: t('reader.cite.have') }) : null,
        h('div', { class: 'rd-cite-actions' },
          opts.onSearch ? h('button', { type: 'button', class: 'btn small primary', onclick: () => { close(); opts.onSearch(searchTermFor(entry)); } }, iconEl('search'), h('span', { text: t('reader.cite.search') })) : null,
          have ? h('a', { class: 'btn small', href: nodeHref(have.path), onclick: () => close() }, iconEl('book'), h('span', { text: t('reader.cite.open') })) : null));
    }).filter(Boolean);
    const goList = h('button', { type: 'button', class: 'btn small', onclick: () => { close(); scrollToEl(inner.querySelector('.rd-refs')); } }, iconEl('list'), h('span', { text: t('reader.cite.list') }));
    modal({
      title: t('reader.cite.title', { n: nums.join(', ') }),
      body: h('div', { class: 'rd-cite-pop' }, ...(rows.length ? rows : [h('p', { class: 'muted', text: t('reader.cite.none') })]), h('div', { class: 'rd-cite-actions' }, goList)),
      actions: [{ label: t('action.close'), value: null }],
      onOpen: (_, c) => { close = c; },
    });
  }

  function flash(hl) {
    for (const el of hl.els || []) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); }
  }
  textEl.addEventListener('click', (e) => {
    const m = e.target.closest?.('mark.rd-hl');
    if (!m || window.getSelection()?.toString()) return;
    const hl = state.highlights.find((x) => x.id === m.dataset.hl);
    if (!hl) return;
    if (narrow()) setPane('marks');
    requestAnimationFrame(() => {
      const item = marksEl.querySelector(`[data-id="${hl.id}"]`);
      item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      item?.classList.add('flash');
      setTimeout(() => item?.classList.remove('flash'), 1400);
    });
  });

  // the selection bar: shows while words are selected in the text
  selbar.append(
    h('button', { type: 'button', class: 'btn small primary', onclick: () => addHighlight(false) }, iconEl('edit'), h('span', { text: t('reader.mark') })),
    h('button', { type: 'button', class: 'btn small', onclick: () => addHighlight(true) }, iconEl('comment'), h('span', { text: t('reader.markNote') })),
    h('button', { type: 'button', class: 'btn small rd-sel-card', onclick: newCard }, iconEl('plus'), h('span', { text: t('reader.card') })),
    h('button', { type: 'button', class: 'btn small rd-sel-snippet', hidden: true, onclick: newSnippet }, iconEl('code'), h('span', { text: t('reader.snippet') })),
    h('button', { type: 'button', class: 'btn small rd-sel-know', onclick: knowSelection }, iconEl('search'), h('span', { text: t('reader.know.sel') })),
    h('button', { type: 'button', class: 'btn small rd-sel-page', hidden: true, onclick: toPage }, iconEl('file'), h('span', { text: t('library.toPage') })));
  for (const b of selbar.querySelectorAll('button')) b.addEventListener('pointerdown', (e) => e.preventDefault());
  const onSelection = debounce(() => {
    if (!root.isConnected) { document.removeEventListener('selectionchange', onSelection); return; }
    if (destroyed || state.pane !== 'text') { selbar.hidden = true; return; }
    const q = selectionQuote(textEl);
    state.pending = q;
    const sel = window.getSelection();
    const pre = q && sel?.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('pre') : null;
    state.code = pre && textEl.contains(pre) ? sel.toString() : '';
    selbar.querySelector('.rd-sel-snippet').hidden = !state.code.trim();
    const page = q ? targetPage() : null;
    const pb = selbar.querySelector('.rd-sel-page');
    pb.hidden = !page;
    if (page) pb.title = t('library.toPage.title', { title: page.title });
    selbar.hidden = !q;
  }, 120);
  document.addEventListener('selectionchange', onSelection);

  drawBar();
  drawTabs();
  drawMarks();
  outlineEl.replaceChildren(h('h3', { text: t('reader.outline') }));
  load();

  return {
    root,
    destroy() {
      destroyed = true;
      abort?.abort();
      document.removeEventListener('selectionchange', onSelection);
      root.remove();
    },
    hasSettings: () => hasFetcher(researchSettings()),
  };
}
