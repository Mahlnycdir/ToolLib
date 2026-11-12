// Writing (0.16.0): the pages of a project, over the whole workspace. Since 0.16.0 there are no libraries of their
// own any more: everything you write belongs to a project. Its pages sit in a library node that belongs to the
// project, made the first time you write there; the view is the one of the library (library-view.js), with the
// works of the project beside the page. Which page is open stays in the setting library.open, so Start, "+", a node
// and the reader can open it (#/m/library).
import { h, loadPref, savePref, toast } from '../services/ui.js';
import { getLang, t } from '../i18n/i18n.js';
import { indexState, nodeByPath } from '../services/search.js';
import { createLibrary, createPage, loadLibrary } from '../services/library-store.js';
import { addToProject, focusProject, projectLibrary, projectsWith, setFocus, skipAutoLink } from '../services/projects.js';
import { mountLibrary } from './library-view.js';
import { nodeHref } from './node-view.js';

const slugOf = (path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
export const projectOfLibrary = (libPath) => projectsWith(slugOf(libPath))[0] || null;

// The library of a project; with create, one is made the first time (named like the project).
export async function writingOf(projectPath, { create = false } = {}) {
  const p = nodeByPath(projectPath);
  if (!p || p.type !== 'project') return '';
  const lib = projectLibrary(p);
  if (lib) return lib.path;
  if (!create) return '';
  const path = await createLibrary({ title: p.title, lang: getLang(), firstChapter: t('library.chapter.default', { n: 1 }) });
  skipAutoLink(path);
  await addToProject(projectPath, [slugOf(path)]);
  return path;
}

// Opens the pages of a project (the page, or the one written last). Writing in a project puts it in focus.
export async function openWriting(projectPath, { page = '', go } = {}) {
  try {
    const lib = await writingOf(projectPath, { create: true });
    if (!lib) return false;
    setFocus(projectPath);
    const open = loadPref('library.open', null);
    savePref('library.open', { path: lib, page: page || (open?.path === lib ? open.page : '') || '', at: Date.now() });
    go('#/m/library');
    return true;
  } catch (e) {
    console.warn('Could not open the pages', e);
    toast(t('library.saveFailed'), 'error', 5000);
    return false;
  }
}

// A new page at the end of the last chapter of a project's pages. Returns its path.
export async function newPageIn(projectPath, title) {
  const lib = await writingOf(projectPath, { create: true });
  const l = await loadLibrary(lib);
  setFocus(projectPath);
  const path = await createPage(lib, Math.max(0, l.chapters.length - 1), title, l.lang || getLang());
  savePref('library.open', { path: lib, page: path, at: Date.now() });
  return path;
}

export function renderWrite(main, { go }) {
  const open = loadPref('library.open', null);
  if (!open?.path || (indexState().ready && !nodeByPath(open.path))) {
    if (open?.path) savePref('library.open', null);
    // no page open: the pages of the project in focus, if it has some; otherwise the projects
    const p = focusProject();
    const lib = p ? projectLibrary(p) : null;
    if (lib) { savePref('library.open', { path: lib.path, page: '', at: Date.now() }); location.replace('#/m/library'); return; }
    location.replace('#/m/projects');
    return;
  }
  main.dataset.view = 'library-open';
  const host = h('div', { class: 'lib-host' });
  main.append(host);
  const back = () => { const p = projectOfLibrary(open.path); savePref('library.open', null); go(p ? nodeHref(p.path) : '#/m/projects'); };
  const library = mountLibrary(host, {
    path: open.path, page: open.page || '',
    projectOf: () => projectOfLibrary(open.path),
    onBack: back,
    onRead: (clipPath) => { library.flush(); savePref('research.read', clipPath); savePref('research.readFrom', '#/m/library'); go('#/m/scraper'); },
  });
  // leaving the view saves what was typed last
  main.cleanup = () => library.destroy();
}
