// The library as a tool of its own (0.15.1): your libraries as a list, and one of them open over the whole
// workspace. Until 0.15.0 it lived inside the research window. The library itself is the same view
// (library-view.js); which one is open stays in the setting library.open, so Start, "+" and a node can open it.
import { h, toast, loadPref, savePref, promptDialog } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { indexState, nodeByPath, nodeBySlug, onIndexChange } from '../services/search.js';
import { createLibrary, libraries, loadLibrary } from '../services/library-store.js';
import { mountLibrary } from './library-view.js';
import { trail } from '../services/trail.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

export function renderLibraryHome(main, mod, { go }) {
  const open = loadPref('library.open', null);
  const openIt = (path, page = '') => { savePref('library.open', { path, page, at: Date.now() }); go('#/m/library'); };

  // ---------------------------------------------------------------- one library, over the whole workspace
  if (open?.path && (!indexState().ready || nodeByPath(open.path))) {
    main.dataset.view = 'library-open';
    const host = h('div', { class: 'lib-host' });
    main.append(host);
    const library = mountLibrary(host, {
      path: open.path, page: open.page || '',
      onBack: () => { savePref('library.open', null); go('#/m/library'); },
      onRead: (clipPath) => { library.flush(); savePref('research.read', clipPath); go('#/m/scraper'); },
    });
    // leaving the view saves what was typed last
    main.cleanup = () => library.destroy();
    return;
  }
  if (open?.path) savePref('library.open', null);

  // ---------------------------------------------------------------- the list
  main.dataset.view = 'library';
  const lang = getLang();
  const add = h('button', { type: 'button', class: 'btn primary new-library' }, iconEl('plus'), h('span', { text: t('library.new') }));
  add.addEventListener('click', async () => {
    const title = await promptDialog(t('library.new'), { label: t('library.name'), placeholder: t('library.placeholder'), okLabel: t('research.folder.create'), validate: (v) => (v.trim() ? '' : t('library.needTitle')) });
    if (!title || !title.trim()) return;
    try { openIt(await createLibrary({ title, lang, firstChapter: t('library.chapter.default', { n: 1 }) })); } catch (e) { console.warn(e); toast(t('library.saveFailed'), 'error', 5000); }
  });
  const list = h('div', { class: 'lib-list' });
  main.append(h('div', { class: 'module-head' }, iconEl(mod.icon, 'tile big'),
    h('div', {}, h('h1', { class: 'view-title', text: t('module.library.name') }), h('p', { class: 'lead', text: t('module.library.desc') }))),
  h('div', { class: 'btn-row' }, add), list);

  const titleOf = (slug) => { const d = nodeBySlug(slug); return d ? (lang === 'de' && d.title_de ? d.title_de : d.title) : slug; };
  async function draw() {
    const s = indexState();
    if (!s.ready) { list.replaceChildren(h('p', { class: 'muted', text: t('commandbar.indexing') })); return; }
    const libs = libraries();
    if (!libs.length) {
      list.replaceChildren(h('div', { class: 'empty-invite' }, h('p', { text: t('library.home.none') }), h('p', { class: 'muted small', text: t('library.home.hint') })));
      return;
    }
    const last = trail().filter((e) => e.kind === 'write');
    const cards = [];
    for (const l of libs) {
      let lib = null;
      try { lib = await loadLibrary(l.path); } catch { /* shown without its chapters */ }
      if (!list.isConnected) return;
      const resume = last.find((e) => e.lib === l.path && nodeByPath(e.path));
      const chapters = (lib?.chapters || []).filter((c) => c.pages.length);
      const count = (lib?.chapters || []).reduce((n, c) => n + c.pages.length, 0);
      cards.push(h('article', { class: 'lib-card', dataset: { path: l.path } },
        h('header', { class: 'lib-card-head' },
          h('button', { type: 'button', class: 'lib-card-title', onclick: () => openIt(l.path, resume?.path || '') }, h('span', { text: l.title })),
          h('span', { class: 'muted small', text: t('library.home.count', { pages: count, chapters: lib?.chapters.length || 0 }) })),
        resume ? h('button', { type: 'button', class: 'btn small lib-resume', onclick: () => openIt(l.path, resume.path) }, iconEl('edit'), h('span', { text: t('library.home.resume', { title: titleOf(resume.path.slice(resume.path.lastIndexOf('/') + 1).replace(/\.md$/, '')) }) })) : null,
        chapters.length ? h('div', { class: 'lib-chapters' }, chapters.map((c) => h('div', { class: 'lib-chapter' },
          h('span', { class: 'lib-chapter-title muted small', text: c.title }),
          h('div', { class: 'lib-pages' }, c.pages.map((slug) => {
            const d = nodeBySlug(slug);
            return d ? h('button', { type: 'button', class: 'lib-page', text: titleOf(slug), onclick: () => openIt(l.path, d.path) }) : null;
          })))))
          : h('p', { class: 'muted small', text: t('library.home.empty') })));
    }
    list.replaceChildren(...cards);
  }
  const stop = onIndexChange((s) => { if (!list.isConnected) stop(); else if (!s.building) draw(); });
  draw();
}
