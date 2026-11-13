// Your own library (0.14.2), inside the research window: chapters and pages on the left, the page you write in the
// middle (Markdown and how it looks), on the right what you take over: your highlights from works, your knowledge and
// the sources of the page. On the iPhone the three are tabs. The order lives in the library node, the text in the
// page nodes (services/library-store.js); everything is saved by itself and synced like other nodes.
import { mark } from '../services/trail.js';
import { h, toast, debounce, loadPref, savePref, promptDialog, confirmDialog, actionSheet, copyText, keepScroll } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { getLang, t } from '../i18n/i18n.js';
import { allNodes, indexState, nodeByPath, nodeBySlug, onIndexChange } from '../services/search.js';
import { getNode, localize } from '../services/nodes.js';
import {
  addChapter, createPage, deleteChapter, deleteLibrary, deletePage, firstFormula, loadLibrary, loadPage, mergeLines, moveChapter,
  movePage, placePage, placeChapter, quoteMarkdown, renameChapter, renameLibrary, savePage, withSource,
} from '../services/library-store.js';
import { loadClipDoc, keepWork, clipFor } from '../services/research-store.js';
import { startSearch } from '../services/research.js';
import { knowledgeFor } from '../services/reader-cards.js';
import { projectWorks, addToProject } from '../services/projects.js';
import { mountEditor, sectionOf } from './page-editor.js';
import { draggable, dropZone } from './drag.js';
import { nodeHref, typeLabel } from './node-view.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const narrow = () => window.matchMedia('(max-width: 759px)').matches;
const CARDS = new Set(['formula', 'definition', 'theorem', 'convention']);
const urlOfClip = (m) => (m.doi ? `https://doi.org/${m.doi}` : m.arxiv ? `https://arxiv.org/abs/${m.arxiv}` : m.url ? String(m.url) : '');

// opts: { path, page, onBack(), onRead(clipPath) }
export function mountLibrary(host, opts) {
  const lang = getLang();
  const state = { lib: null, page: null, editor: null, dirty: false, saving: false, again: false, pane: opts.page ? 'page' : 'toc', side: loadPref('library.side', 'marks'), marks: null, filter: '', know: '' };
  let destroyed = false;

  const root = h('div', { class: 'lb', dataset: { pane: state.pane } });
  // 0.15.1: the page gets the room. "Take over" (highlights, knowledge, sources) opens beside it on demand, and
  // "Only the page" hides the contents as well. Both are remembered.
  root.classList.toggle('side-open', loadPref('library.sideOpen', false));
  root.classList.toggle('focus', loadPref('library.focus', false));
  const bar = h('header', { class: 'lb-bar rd-bar' });
  const tabs = h('div', { class: 'lb-tabs segmented', role: 'tablist' });
  const toc = h('nav', { class: 'lb-toc', 'aria-label': t('library.toc') });
  const mid = h('section', { class: 'lb-page', 'aria-label': t('library.pageArea') });
  const side = h('aside', { class: 'lb-side', 'aria-label': t('library.side') });
  root.append(bar, tabs, h('div', { class: 'lb-body' }, toc, mid, side));
  // on the phone only one pane shows at a time; the contents and the side keep their place meanwhile (0.22.0)
  keepScroll(toc);
  keepScroll(side);
  // while you type on the iPhone the bar and the page head step aside, so the keyboard leaves room for the text
  // On the phone head and bar step aside while you write, from the first key on, not when you tap (0.17.0): a
  // layout that moves at the tap put the cursor somewhere else and needed a second tap.
  const startWriting = () => {
    if (!narrow() || root.classList.contains('writing')) return;
    root.classList.add('writing');
    state.editor?.editor.keepCaretInView();
  };
  // they come back a moment after you leave the text, so the tap that left it (a tab, a button) still lands
  mid.addEventListener('focusout', (e) => {
    if (!e.target.closest?.('.cm-editor')) return;
    setTimeout(() => { if (!mid.querySelector('.cm-editor')?.contains(document.activeElement)) root.classList.remove('writing'); }, 350);
  });
  host.append(root);

  const nodeTitle = (d) => (lang === 'de' && d.title_de ? d.title_de : d.title);
  const pageTitle = (slug) => { const d = nodeBySlug(slug); return d ? nodeTitle(d) : slug; };

  // ---------------------------------------------------------------- bar and tabs
  function drawBar() {
    const back = h('button', { type: 'button', class: 'btn small', 'aria-label': t('reader.back'), onclick: leave }, iconEl('chevronLeft'), h('span', { text: t('reader.back') }));
    // the pages of a project (0.16.0): named after it; renaming or deleting them as a whole is not needed there
    const proj = opts.projectOf?.() || null;
    const title = h('div', { class: 'rd-title' }, h('span', { text: proj ? t('write.title', { project: proj.title }) : state.lib?.title || '' }));
    const view = state.lib ? h('a', { class: 'btn small', href: nodeHref(state.page?.path || state.lib.path), onclick: () => flush() }, iconEl('book'), h('span', { text: t('library.view') })) : null;
    const more = proj ? null : h('button', { type: 'button', class: 'btn small', 'aria-label': t('library.more'), title: t('library.more'), onclick: libMenu }, iconEl('more'));
    const focusOn = root.classList.contains('focus');
    const focus = h('button', { type: 'button', class: `btn small lb-focus${focusOn ? ' on' : ''}`, 'aria-pressed': String(focusOn), title: t(focusOn ? 'library.focus.off' : 'library.focus') }, iconEl(focusOn ? 'minimize' : 'maximize'), h('span', { text: t(focusOn ? 'library.focus.off' : 'library.focus') }));
    focus.addEventListener('click', () => { const on = root.classList.toggle('focus'); savePref('library.focus', on); drawBar(); });
    const sideOn = root.classList.contains('side-open');
    const side = h('button', { type: 'button', class: `btn small lb-side-btn${sideOn ? ' on' : ''}`, 'aria-pressed': String(sideOn) }, iconEl('bookmark'), h('span', { text: t('library.side.toggle') }));
    side.addEventListener('click', () => { const on = root.classList.toggle('side-open'); savePref('library.sideOpen', on); drawBar(); if (on) drawSide(); });
    bar.replaceChildren(...[back, title, focus, side, view, more].filter(Boolean));
  }
  function drawTabs() {
    tabs.replaceChildren(...[['toc', 'library.tab.toc'], ['page', 'library.tab.page'], ['side', 'library.tab.side']].map(([id, key]) => h('button', {
      type: 'button', role: 'tab', class: state.pane === id ? 'on' : '', 'aria-selected': String(state.pane === id), text: t(key), onclick: () => setPane(id),
    })));
  }
  function setPane(p) { state.pane = p; root.dataset.pane = p; drawTabs(); }

  async function leave() { await flush(); opts.onBack?.(); }

  async function libMenu() {
    const v = await actionSheet(state.lib.title, [
      { label: t('library.rename'), icon: 'edit', value: 'rename' },
      '-',
      { label: t('library.delete'), icon: 'trash', value: 'delete', danger: true },
    ]);
    if (v === 'rename') {
      const name = await promptDialog(t('library.rename'), { value: state.lib.title, validate: (x) => (x.trim() ? '' : t('library.needTitle')) });
      if (name && name.trim() !== state.lib.title) { await renameLibrary(state.lib.path, name); await reloadLib(); }
    } else if (v === 'delete') {
      const n = state.lib.chapters.reduce((a, c) => a + c.pages.length, 0) + state.lib.loose.length;
      if (!(await confirmDialog(t('library.delete'), t('library.delete.confirm', { title: state.lib.title, count: n }), { okLabel: t('library.delete'), danger: true }))) return;
      state.dirty = false;
      await deleteLibrary(state.lib.path);
      savePref('library.target', null);
      toast(t('library.deleted'), 'ok');
      opts.onBack?.(true);
    }
  }

  // ---------------------------------------------------------------- chapters and pages
  async function reloadLib() {
    state.lib = await loadLibrary(opts.path);
    drawBar();
    drawToc();
  }

  function drawToc() {
    const lib = state.lib;
    const items = [];
    lib.chapters.forEach((c, i) => {
      const add = h('button', { type: 'button', class: 'icon-btn no-drag', title: t('library.page.new'), 'aria-label': t('library.page.new'), html: icon('plus'), onclick: () => newPage(i) });
      const menu = h('button', { type: 'button', class: 'icon-btn no-drag', title: t('library.chapter.menu'), 'aria-label': t('library.chapter.menu'), html: icon('more'), onclick: () => chapterMenu(i) });
      const list = h('ul', { class: 'lb-pages' }, ...c.pages.flatMap((s, k) => [pageRow(s, i, k)].flat()));
      const name = h('span', { class: 'lb-ch-title', text: c.title || t('library.chapter.untitled'), title: t('library.chapter.rename') });
      name.addEventListener('dblclick', async () => {
        const v = await promptDialog(t('library.chapter.rename'), { value: c.title, validate: (x) => (x.trim() ? '' : t('library.needTitle')) });
        if (v && v.trim() !== c.title) { await renameChapter(state.lib.path, i, v); await reloadLib(); }
      });
      const head = h('div', { class: 'lb-ch-head' }, h('span', { class: 'lb-ch-num', text: `${i + 1}` }), name, add, menu);
      const chapter = h('li', { class: 'lb-ch' }, head, c.pages.length ? list : h('p', { class: 'muted small lb-ch-empty', text: t('library.chapter.empty') }));
      // a chapter is picked up by its head; a page dropped on the head goes to its end (0.17.0: also with a finger)
      draggable(head, { data: { kind: 'chapter', index: i }, label: c.title });
      dropZone(head, {
        accept: (d) => d.kind === 'page' || (d.kind === 'chapter' && d.index !== i),
        place: (d, e, el) => (d.kind === 'page' ? 'into' : upper(e, el)),
        drop: (d, place) => (d.kind === 'page' ? movePageTo(d.slug, i, -1) : moveChapterTo(d.index, place === 'before' ? i : i + 1)),
      });
      items.push(chapter);
    });
    const loose = lib.loose.length ? h('li', { class: 'lb-ch' }, h('div', { class: 'lb-ch-head' }, h('span', { class: 'lb-ch-title muted', text: t('library.loose') })),
      h('ul', { class: 'lb-pages' }, ...lib.loose.map((s) => pageRow(s, -1)))) : null;
    const addCh = h('button', { type: 'button', class: 'btn small', onclick: newChapter }, iconEl('plus'), h('span', { text: t('library.chapter.new') }));
    toc.replaceChildren(h('div', { class: 'rs-head' }, h('h2', { text: t('library.toc') })), h('ol', { class: 'lb-chapters' }, ...[...items, loose].filter(Boolean)), h('div', { class: 'btn-row' }, addCh),
      h('p', { class: 'muted small lb-drag-hint', text: t(narrow() ? 'library.drag.touch' : 'library.drag') }));
  }

  // Dragging (0.15.1, with mouse and finger since 0.17.0): a page dropped on the upper part of a page goes in front of
  // it, on the lower part behind it, on a chapter head to its end; chapters among chapters; sections of the open page
  // among its headings (the text moves with them).
  const upper = (e, el) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height * 0.6 ? 'before' : 'after'; };
  async function movePageTo(slug, chapter, index) {
    if (chapter < 0) return;
    await flush();
    if (await placePage(state.lib.path, slug, chapter, index)) await reloadLib();
  }
  async function moveChapterTo(from, before) {
    await flush();
    if (await placeChapter(state.lib.path, from, before)) await reloadLib();
  }
  function moveSectionTo(from, x, place) {
    const ed = state.editor;
    if (!ed) return;
    const text = ed.get().body;
    let before = x.line;
    if (place === 'after') { const sec = sectionOf(text, x.line); before = !sec || sec.to >= text.split('\n').length ? -1 : sec.to; }
    if (ed.moveSection(from, before)) { state.heads = ed.headings(); drawToc(); }
  }

  function pageRow(slug, chapter, index = -1) {
    const d = nodeBySlug(slug);
    const on = state.page?.slug === slug;
    const b = h('button', { type: 'button', class: `lb-pg${on ? ' on' : ''}${d ? '' : ' missing'}`, 'aria-current': on ? 'page' : null, disabled: d ? null : true, text: pageTitle(slug) });
    b.addEventListener('click', () => openPage(d.path));
    const row = h('li', { class: 'lb-pg-row', dataset: { slug } }, b);
    if (d) {
      draggable(row, { data: { kind: 'page', slug }, label: pageTitle(slug) });
      if (chapter >= 0) {
        dropZone(row, {
          accept: (x) => x.kind === 'page' && x.slug !== slug,
          place: (x, e, el) => upper(e, el),
          drop: (x, place) => movePageTo(x.slug, chapter, place === 'before' ? index : index + 1),
        });
      }
    }
    if (on) row.append(h('button', { type: 'button', class: 'icon-btn', title: t('library.page.menu'), 'aria-label': t('library.page.menu'), html: icon('more'), onclick: () => pageMenu(slug, chapter) }));
    if (!on) return row;
    // the outline of the page you write in: its headings, a tap goes there; drag one to move its section
    const heads = state.heads || [];
    return heads.length ? [row, h('li', { class: 'lb-outline' }, h('ul', {}, heads.map((x) => {
      const li = h('li', {}, h('button', { type: 'button', class: `lb-head lv-${x.level}`, text: x.title.replace(/[*`]/g, ''), onclick: () => { state.editor?.jumpTo(x.line, x.title); if (narrow()) setPane('page'); } }));
      draggable(li, { data: { kind: 'section', page: slug, line: x.line }, label: x.title });
      dropZone(li, {
        accept: (y) => y.kind === 'section' && y.page === slug && y.line !== x.line,
        place: (y, e, el) => upper(e, el),
        drop: (y, place) => moveSectionTo(y.line, x, place),
      });
      return li;
    })))] : row;
  }

  async function newChapter() {
    const name = await promptDialog(t('library.chapter.new'), { label: t('library.chapter.name'), value: t('library.chapter.default', { n: state.lib.chapters.length + 1 }), validate: (x) => (x.trim() ? '' : t('library.needTitle')) });
    if (!name) return;
    await addChapter(state.lib.path, name);
    await reloadLib();
  }

  async function chapterMenu(i) {
    const c = state.lib.chapters[i];
    const v = await actionSheet(c.title, [
      { label: t('library.page.new'), icon: 'plus', value: 'page' },
      { label: t('library.chapter.rename'), icon: 'edit', value: 'rename' },
      { label: t('library.up'), icon: 'arrowUp', value: 'up', disabled: i === 0 },
      { label: t('library.down'), icon: 'arrowDown', value: 'down', disabled: i === state.lib.chapters.length - 1 },
      '-',
      { label: t('library.chapter.delete'), icon: 'trash', value: 'delete', danger: true },
    ]);
    if (v === 'page') return newPage(i);
    if (v === 'rename') {
      const name = await promptDialog(t('library.chapter.rename'), { value: c.title, validate: (x) => (x.trim() ? '' : t('library.needTitle')) });
      if (name) await renameChapter(state.lib.path, i, name);
    } else if (v === 'up' || v === 'down') await moveChapter(state.lib.path, i, v === 'up' ? -1 : 1);
    else if (v === 'delete') {
      if (c.pages.length && !(await confirmDialog(t('library.chapter.delete'), t('library.chapter.delete.confirm', { title: c.title, count: c.pages.length }), { okLabel: t('library.chapter.delete'), danger: true }))) return;
      if (c.pages.includes(state.page?.slug)) closePage();
      await deleteChapter(state.lib.path, i);
    } else return;
    await reloadLib();
  }

  async function pageMenu(slug, chapter) {
    const lib = state.lib;
    const list = chapter >= 0 ? lib.chapters[chapter].pages : [];
    const k = list.indexOf(slug);
    const v = await actionSheet(pageTitle(slug), [
      { label: t('library.up'), icon: 'arrowUp', value: 'up', disabled: chapter < 0 || k <= 0 },
      { label: t('library.down'), icon: 'arrowDown', value: 'down', disabled: chapter < 0 || k === list.length - 1 },
      { label: t('library.page.move'), icon: 'folder', value: 'move', disabled: lib.chapters.length < (chapter < 0 ? 1 : 2) },
      { label: t('library.page.export'), icon: 'copy', value: 'export', disabled: state.page?.slug !== slug || !state.editor },
      '-',
      { label: t('library.page.delete'), icon: 'trash', value: 'delete', danger: true },
    ]);
    if (v === 'export') {
      // the page as Markdown for outside: [@sources] as numbered links, the list of sources at the end
      const ok = await copyText(state.editor.exportText());
      toast(t(ok ? 'library.page.exported' : 'node.copyFailed'), ok ? 'ok' : 'error');
      return;
    }
    if (v === 'up' || v === 'down') await movePage(lib.path, slug, { dir: v === 'up' ? -1 : 1 });
    else if (v === 'move') {
      const to = await actionSheet(t('library.page.moveTo'), lib.chapters.map((c, i) => ({ label: `${i + 1}. ${c.title}`, value: String(i), disabled: i === chapter })));
      if (to == null) return;
      await flush();
      await movePage(lib.path, slug, { toChapter: Number(to) });
    } else if (v === 'delete') {
      if (!(await confirmDialog(t('library.page.delete'), t('library.page.delete.confirm', { title: pageTitle(slug) }), { okLabel: t('library.page.delete'), danger: true }))) return;
      if (state.page?.slug === slug) { state.dirty = false; closePage(); }
      await deletePage(lib.path, slug);
      const tg = loadPref('library.target', null);
      if (tg?.path && !nodeByPath(tg.path)) savePref('library.target', null);
    } else return;
    await reloadLib();
  }

  async function newPage(chapter) {
    const name = await promptDialog(t('library.page.new'), { label: t('library.page.name'), validate: (x) => (x.trim() ? '' : t('library.needTitle')) });
    if (!name) return;
    await flush();
    const path = await createPage(state.lib.path, chapter, name, lang);
    await reloadLib();
    await openPage(path);
  }

  // ---------------------------------------------------------------- the page
  // Every page remembers where you were in it (0.22.0): the line at the top, the cursor, how far the preview was
  // scrolled. Opening it again goes back there. Kept on the device for the last 40 pages.
  const places = new Map((() => { const v = loadPref('library.places', []); return Array.isArray(v) ? v : []; })());
  // (the page the editor shows; state.page may already be the next one)
  let edPath = '';
  function rememberPlace() {
    const ed = state.editor;
    if (!ed || !edPath) return;
    try {
      const pv = ed.el.querySelector('.pe-preview');
      places.delete(edPath);
      places.set(edPath, { ...ed.editor.place(), pv: pv ? Math.round(pv.scrollTop) : 0 });
      savePref('library.places', [...places.entries()].slice(-40));
    } catch (e) { console.warn(e); }
  }
  function goToPlace(ed, path) {
    const p = places.get(path);
    if (!p) return;
    ed.editor.toPlace(p);
    const pv = ed.el.querySelector('.pe-preview');
    if (pv && p.pv) requestAnimationFrame(() => { pv.scrollTop = p.pv; });
  }

  function closePage() {
    rememberPlace();
    state.editor?.destroy();
    state.editor = null;
    edPath = '';
    state.page = null;
    state.heads = [];
    savePref('library.open', { path: opts.path, page: '' });
    drawMid();
  }

  async function openPage(path) {
    await flush();
    if (destroyed) return;
    const page = await loadPage(path);
    state.page = page;
    state.dirty = false;
    savePref('library.open', { path: opts.path, page: path });
    mark('write', { path, lib: opts.path, title: page.title || '' });
    const tg = loadPref('library.target', null);
    if (!tg || tg.path !== path) savePref('library.target', { path, at: page.body.length });
    // on the phone the page pane shows first, so the editor is drawn visible and can go back to where you were
    if (narrow()) setPane('page');
    drawMid();
    drawToc();
    drawBar();
    drawSide();
  }

  function drawMid() {
    rememberPlace();
    state.editor?.destroy();
    state.editor = null;
    edPath = '';
    if (!state.page) {
      const has = state.lib.chapters.some((c) => c.pages.length) || state.lib.loose.length;
      const first = h('button', { type: 'button', class: 'btn primary', onclick: () => newPage(0) }, iconEl('plus'), h('span', { text: t('library.page.first') }));
      mid.replaceChildren(h('div', { class: 'lb-empty' }, h('p', { class: 'muted', text: has ? t('library.pickPage') : t('library.noPages') }), has ? null : first));
      return;
    }
    const ed = mountEditor({
      page: state.page,
      onInput: () => { state.dirty = true; state.editor?.setStatus('unsaved'); saveSoon(); startWriting(); },
      onCursor: (at) => { if (state.page) savePref('library.target', { path: state.page.path, at }); },
      onLeave: () => flush(),
      onSaveNow: () => flush(),
      onHeadings: (heads) => { if (JSON.stringify(heads) !== JSON.stringify(state.heads)) { state.heads = heads; drawToc(); } },
      // [@ offers the works of the project first (0.17.0)
      works: () => { const p = opts.projectOf?.(); return p ? projectWorks(p).clips : []; },
    });
    state.editor = ed;
    state.heads = ed.headings();
    mid.replaceChildren(ed.el);
    edPath = state.page.path;
    goToPlace(ed, edPath);
    ed.setStatus(state.page.body || state.page.text ? 'saved' : '');
  }

  const saveSoon = debounce(() => save(), 1200);
  async function save() {
    if (!state.page || !state.editor) return;
    if (state.saving) { state.again = true; return; }
    if (!state.dirty) return;
    state.saving = true;
    state.dirty = false;
    const page = state.page;
    const ed = state.editor;
    ed.setStatus('saving');
    const f = ed.get();
    try {
      const r = await savePage(page.path, { title: f.title, problems: f.problems, body: f.body, sources: page.sources, links: page.links }, page.text);
      page.text = r.text;
      if (r.merged && state.page === page) {
        // the file changed meanwhile (a quote from the reader, a sync): take that into the editor too
        const fresh = await loadPage(page.path);
        const now = ed.get().body;
        const body = now === f.body ? fresh.body : (mergeLines(f.body, now, fresh.body) ?? now);
        Object.assign(page, { sources: fresh.sources, links: fresh.links, text: fresh.text });
        ed.refresh(body);
        if (body !== fresh.body) state.dirty = true;
      }
      if (r.conflict) toast(t('library.conflict'), 'info', 6000);
      if (state.page === page) ed.setStatus(state.dirty ? 'unsaved' : 'saved');
      if (f.title.trim() && f.title.trim() !== page.title) { page.title = f.title.trim(); drawToc(); }
    } catch (e) {
      console.warn('Could not save the page', e);
      state.dirty = true;
      ed.setStatus('failed');
      toast(t('library.saveFailed'), 'error', 5000);
    } finally {
      state.saving = false;
    }
    if (state.again || state.dirty) { state.again = false; if (state.dirty) saveSoon(); }
  }
  async function flush() {
    if (state.saving) { await new Promise((r) => { const w = () => (state.saving ? setTimeout(w, 50) : r()); w(); }); }
    if (state.dirty) await save();
  }
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);

  // a change of this page from another window: take it when you have not typed since
  const onNodes = async (e) => {
    if (!state.page || !(e.detail || []).includes(state.page.path) || state.dirty || state.saving) return;
    const fresh = await loadPage(state.page.path);
    if (fresh.text === state.page.text) return;
    Object.assign(state.page, fresh);
    state.editor?.refresh(fresh.body);
  };
  window.addEventListener('toollib:nodes', onNodes);

  // a passage, a formula or a link into the page, where the cursor is
  function put(md, { inline = false, source = null } = {}) {
    if (!state.page || !state.editor) { toast(t('library.pickPageFirst'), 'info'); return; }
    if (source) Object.assign(state.page, withSource(state.page, source));
    state.editor.insert(md, { inline });
    state.dirty = true;
    saveSoon();
    if (narrow()) setPane('page');
    if (state.side === 'sources') drawSide();
    toast(t('library.inserted'), 'ok', 1600);
  }

  // ---------------------------------------------------------------- what you take over: highlights, knowledge, sources
  const sideTabs = h('div', { class: 'rd-sub' });
  const sideBody = h('div', { class: 'lb-side-body' });
  side.append(sideTabs, sideBody);
  function drawSideTabs() {
    const inProject = !!opts.projectOf?.();
    sideTabs.replaceChildren(...[['marks', inProject ? 'library.side.works' : 'library.side.marks'], ['search', 'library.side.search'], ['know', 'library.side.know'], ['sources', 'library.side.sources']].map(([id, key]) => h('button', {
      type: 'button', class: state.side === id ? 'on' : '', 'aria-pressed': String(state.side === id),
      text: id === 'sources' && state.page?.sources.length ? `${t(key)} (${state.page.sources.length})` : t(key),
      onclick: () => { state.side = id; savePref('library.side', id); drawSide(); },
    })));
  }
  function drawSide() {
    drawSideTabs();
    if (state.side === 'know') drawKnow();
    else if (state.side === 'sources') drawSources();
    else if (state.side === 'search') drawSearch();
    else drawMarks();
  }

  // Research while you write (0.18.0): papers and books from the open sources, beside the page. Keep goes into the
  // project, Cite keeps it and puts [@…] where the cursor is, Read opens the reader and comes back here.
  let searching = null;
  function drawSearch() {
    const input = h('input', { class: 'field lb-search-in', type: 'search', placeholder: t('library.search.placeholder'), 'aria-label': t('library.search.placeholder'), value: state.searchQ || '', enterkeyhint: 'search' });
    const go = h('button', { type: 'submit', class: 'btn small primary' }, h('span', { class: 'icon', html: icon('search') }), h('span', { text: t('library.search.go') }));
    const form = h('form', { class: 'lb-search-form' }, input, go);
    const list = h('div', { class: 'lb-search' });
    const more = h('a', { href: '#/m/scraper', class: 'small lb-search-more', text: t('library.search.more') });
    more.addEventListener('click', async () => { await flush(); if (state.searchQ) { const { queueSearch } = await import('./research-view.js'); queueSearch(state.searchQ); } });
    sideBody.replaceChildren(form, list, more);
    const draw = (r) => {
      if (state.side !== 'search' || !list.isConnected) return;
      const works = (r?.works || []).slice(0, 15);
      if (!works.length) { list.replaceChildren(h('p', { class: 'muted small', text: r?.finished ? t('library.search.none') : r ? t('library.search.busy') : t('library.search.hint') })); return; }
      list.replaceChildren(...[...works.map((w) => searchRow(w)), r.finished ? null : h('p', { class: 'muted small', text: t('library.search.busy') })].filter(Boolean));
    };
    const run = (q) => {
      searching?.cancel();
      state.searchQ = q;
      if (!q) { draw(null); return; }
      list.replaceChildren(h('p', { class: 'muted small', text: t('library.search.busy') }));
      searching = startSearch(q, { onUpdate: (r) => { state.searchResult = r; draw(r); } });
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); run(input.value.trim()); });
    if (state.searchResult && state.searchResult.query?.text === state.searchQ) draw({ ...state.searchResult, finished: true });
    else draw(null);
    setTimeout(() => input.focus(), 30);
  }
  function searchRow(w) {
    const who = [String((w.authors || [])[0] || '').split(/\s+/).pop(), w.year].filter(Boolean).join(' ');
    const kept = clipFor(w);
    const keepIt = async () => {
      const r = await keepWork(w, { query: state.searchQ || '' });
      const p = opts.projectOf?.();
      if (p) await addToProject(p.path, [r.slug]);
      return r;
    };
    let row = null;
    // after Cite or Keep the row shows the work as kept; the cursor stays in the page
    const btn = (key, cls, fn) => h('button', { type: 'button', class: `btn small ${cls}`, onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try { await fn(); if (row?.isConnected) row.replaceWith(searchRow(w)); } catch (err) { console.warn(err); toast(t('research.keepFailed'), 'error', 5000); b.disabled = false; }
    } }, h('span', { text: t(key) }));
    row = h('article', { class: 'lb-hit' },
      h('div', { class: 'lb-hit-title', text: w.title }),
      who || w.venue ? h('div', { class: 'muted small', text: [who, w.venue].filter(Boolean).join(' · ') }) : null,
      h('div', { class: 'btn-row' },
        btn('library.cite', 'primary lb-hit-cite', async () => { const r = await keepIt(); put(`[@${r.slug}]`, { inline: true }); }),
        kept ? h('span', { class: 'chip small', text: t('library.search.kept') }) : btn('research.keep', 'lb-hit-keep', async () => { await keepIt(); toast(t('library.search.keptHere'), 'ok'); }),
        btn('research.read', 'lb-hit-read', async () => { const r = await keepIt(); await flush(); opts.onRead?.(r.clipPath); })));
    return row;
  }

  // your highlights in the works you kept, the works this page cites first
  async function loadMarks() {
    const out = [];
    for (const d of allNodes().filter((x) => x.type === 'clip' && !x.conflict)) {
      try {
        const doc = await loadClipDoc(d.path);
        if (doc.highlights.length) out.push({ d, meta: doc.meta, highlights: doc.highlights });
      } catch { /* an unreadable clip is left out */ }
    }
    return out;
  }
  async function drawMarks() {
    const filter = h('input', { class: 'field', type: 'search', placeholder: t('library.marks.filter'), 'aria-label': t('library.marks.filter'), value: state.filter });
    const list = h('div', { class: 'lb-marks' }, h('p', { class: 'muted small', text: t('library.loading') }));
    sideBody.replaceChildren(filter, list);
    filter.addEventListener('input', debounce(() => { state.filter = filter.value.trim(); fill(); }, 150));
    // the works of a project show at once; the marks of all works follow
    if (!state.marks && opts.projectOf?.()) fill();
    if (!state.marks) state.marks = await loadMarks();
    if (destroyed || state.side !== 'marks') return;
    fill();
    function fill() {
      const f = state.filter.toLowerCase();
      const cited = new Set(state.page?.links || []);
      const groups = [...(state.marks || [])].sort((a, b) => Number(cited.has(b.d.slug)) - Number(cited.has(a.d.slug)) || a.d.title.localeCompare(b.d.title));
      // in a project (0.16.0): its works first, also those without a mark yet (read them, mark, take over)
      const proj = opts.projectOf?.() || null;
      const own = proj ? projectWorks(proj).clips : [];
      const ownSet = new Set(own.map((d) => d.slug));
      const blocks = [];
      const readBtn = (d) => h('span', { class: 'lb-work-btns' },
        h('button', { type: 'button', class: 'btn small lb-cite', title: t('library.cite.hint'), onclick: () => put(`[@${d.slug}]`, { inline: true }) }, h('span', { text: t('library.cite') })),
        h('button', { type: 'button', class: 'btn small lb-read', title: t('library.marks.read'), onclick: async () => { await flush(); opts.onRead?.(d.path); } }, iconEl('book'), h('span', { text: t('library.marks.read') })));
      if (proj) {
        blocks.push(h('h4', { class: 'lb-side-h', text: t('library.side.projectWorks', { project: proj.title }) }));
        const shown = own.filter((d) => !f || d.title.toLowerCase().includes(f) || (groups.find((g) => g.d.slug === d.slug)?.highlights || []).some((x) => `${x.quote} ${x.note}`.toLowerCase().includes(f)));
        for (const d of shown) {
          const g = groups.find((x) => x.d.slug === d.slug);
          if (g) continue;   // drawn below with its marks
          blocks.push(h('section', { class: 'lb-mark-group lb-own' }, h('div', { class: 'lb-mark-work' }, h('span', { class: 'lb-mark-title', text: d.title }), readBtn(d)),
            h('p', { class: 'muted small', text: t('library.side.nothingMarked') })));
        }
        if (!own.length) blocks.push(h('p', { class: 'muted small', text: t('library.side.noWorks') }));
      }
      const ordered = proj ? [...groups.filter((g) => ownSet.has(g.d.slug)), ...groups.filter((g) => !ownSet.has(g.d.slug))] : groups;
      let otherHead = false;
      for (const g of ordered) {
        const hls = g.highlights.filter((x) => !f || `${x.quote} ${x.note} ${x.section} ${g.d.title}`.toLowerCase().includes(f));
        if (!hls.length) continue;
        if (proj && !ownSet.has(g.d.slug) && !otherHead) { otherHead = true; blocks.push(h('h4', { class: 'lb-side-h', text: t('library.side.otherWorks') })); }
        const read = readBtn(g.d);
        blocks.push(h('section', { class: 'lb-mark-group' },
          h('div', { class: 'lb-mark-work' }, h('span', { class: 'lb-mark-title', text: g.d.title }), read),
          h('ul', { class: 'rd-mark-list' }, ...hls.map((x) => h('li', { class: 'rd-mark' },
            x.section ? h('div', { class: 'rd-mark-head' }, h('span', { class: 'rs-tag', text: x.section.length > 40 ? `${x.section.slice(0, 38)}…` : x.section })) : null,
            h('p', { class: 'rd-quote lb-quote', text: x.quote.length > 300 ? `${x.quote.slice(0, 297)}…` : x.quote }),
            x.note ? h('p', { class: 'small lb-note', text: x.note }) : null,
            h('div', { class: 'btn-row' }, h('button', {
              type: 'button', class: 'btn small primary lb-insert',
              onclick: () => {
                const work = { title: String(g.meta.title || g.d.title), authors: Array.isArray(g.meta.authors) ? g.meta.authors.map(String) : [], year: g.meta.year };
                put(quoteMarkdown({ quote: x.quote, section: x.section, work, clipSlug: g.d.slug, note: x.note }),
                  { source: { work, url: urlOfClip(g.meta), section: x.section, clipSlug: g.d.slug } });
              },
            }, iconEl('plus'), h('span', { text: t('library.insert') }))))))));
      }
      list.replaceChildren(...(blocks.length ? blocks : [h('p', { class: 'muted small', text: state.marks?.length ? t('library.marks.noMatch') : t('library.marks.none') })]));
    }
  }

  // your knowledge: search, then a link or the formula of a card
  function drawKnow() {
    const input = h('input', { class: 'field', type: 'search', placeholder: t('reader.know.placeholder'), 'aria-label': t('reader.know.placeholder'), value: state.know });
    const list = h('div', { class: 'lb-know' });
    sideBody.replaceChildren(input, list);
    input.addEventListener('input', debounce(() => { state.know = input.value.trim(); fill(); }, 200));
    fill();
    function fill() {
      const query = state.know || (state.page ? `${state.page.title} ${state.page.problems.join(' ')}` : state.lib?.title || '');
      const hits = knowledgeFor(query, { skip: state.page?.path || '', limit: 10 }).filter((d) => d.type !== 'clip');
      list.replaceChildren(
        h('h4', { text: state.know ? t('reader.know.search') : t('library.know.fits') }),
        hits.length ? h('ul', { class: 'rd-know-list' }, ...hits.map((d) => h('li', { class: 'lb-know-row' },
          h('a', { class: 'rd-know-item', href: nodeHref(d.path), onclick: () => flush() },
            h('span', { class: 'rs-tag', text: typeLabel(d.type) }), h('span', { class: 'rd-know-title', text: nodeTitle(d) }),
            d.lead?.[lang] || d.lead?.en ? h('span', { class: 'rd-know-lead muted small', text: (d.lead[lang] || d.lead.en).slice(0, 110) }) : null),
          h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn small lb-link', onclick: () => put(`[[${d.slug}]]`, { inline: true }) }, iconEl('link'), h('span', { text: t('library.know.link') })),
            CARDS.has(d.type) ? h('button', { type: 'button', class: 'btn small lb-formula', onclick: () => putFormula(d) }, h('span', { class: 'pe-tool-text', text: '$$' }), h('span', { text: t('library.know.formula') })) : null)))) : h('p', { class: 'muted small', text: t('reader.know.none') }));
    }
  }
  async function putFormula(d) {
    const node = await getNode(d.path);
    const tex = node ? firstFormula(localize(node.body, lang)) : '';
    if (!tex) { toast(t('library.know.noFormula'), 'info'); return; }
    put(`$$\n${tex}\n$$\n\n→ [[${d.slug}]]`);
  }

  // the sources of the page: from quotes by themselves, and your own (a book without a link, say)
  function drawSources() {
    if (!state.page) { sideBody.replaceChildren(h('p', { class: 'muted small', text: t('library.pickPageFirst') })); return; }
    const page = state.page;
    const list = h('ol', { class: 'sources lb-sources' }, ...page.sources.map((s, k) => h('li', {},
      s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title }) : h('span', { text: s.title }),
      s.at ? h('span', { class: 'muted', text: ` · ${s.at}` }) : null,
      h('button', { type: 'button', class: 'icon-btn', title: t('reader.remove'), 'aria-label': t('reader.remove'), html: icon('trash'), onclick: () => { page.sources.splice(k, 1); changedMeta(); } }))));
    const title = h('input', { class: 'field', type: 'text', placeholder: t('library.source.title'), 'aria-label': t('library.source.title') });
    const url = h('input', { class: 'field', type: 'url', placeholder: t('library.source.url'), 'aria-label': t('library.source.url') });
    const at = h('input', { class: 'field', type: 'text', placeholder: t('library.source.at'), 'aria-label': t('library.source.at') });
    const add = h('button', { type: 'button', class: 'btn small', onclick: () => {
      if (!title.value.trim()) { title.focus(); return; }
      page.sources.push({ title: title.value.trim(), url: /^https?:\/\//.test(url.value.trim()) ? url.value.trim() : '', at: at.value.trim() });
      changedMeta();
    } }, iconEl('plus'), h('span', { text: t('library.source.add') }));
    sideBody.replaceChildren(page.sources.length ? list : h('p', { class: 'muted small', text: t('node.noSources') }),
      h('div', { class: 'lb-source-form' }, h('h4', { text: t('library.source.new') }), title, url, at, add));
  }
  function changedMeta() {
    state.dirty = true;
    state.editor?.setStatus('unsaved');
    saveSoon();
    drawSide();
  }

  // ---------------------------------------------------------------- start
  // after a restart the index is built first (iOS opens the app on the same page): wait for it
  const indexed = () => new Promise((r) => {
    const s = indexState();
    if (s.ready && !s.building) { r(); return; }
    const off = onIndexChange((x) => { if (x.ready && !x.building) { off(); r(); } });
  });
  // a sync or another window changed the library: draw the contents again
  const offIndex = onIndexChange((x) => { if (!x.building && state.lib && !destroyed) reloadLib().catch(() => {}); });

  drawTabs();
  (async () => {
    try {
      await indexed();
      if (destroyed) return;
      await reloadLib();
    } catch (e) {
      console.warn('Could not open the library', e);
      mid.replaceChildren(h('div', { class: 'lb-empty' }, h('p', { class: 'muted', text: t('library.gone') }),
        h('button', { type: 'button', class: 'btn', onclick: () => { savePref('library.open', null); opts.onBack?.(true); } }, h('span', { text: t('reader.back') }))));
      return;
    }
    drawTabs();
    const want = opts.page && nodeByPath(opts.page) ? opts.page : '';
    if (want) await openPage(want);
    else drawMid();
    drawSide();
  })();

  return {
    root,
    flush,
    destroy() {
      destroyed = true;
      flush();
      rememberPlace();
      state.editor?.destroy();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('toollib:nodes', onNodes);
      offIndex();
      root.remove();
    },
  };
}
