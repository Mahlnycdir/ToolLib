// One way to create anything, from anywhere (0.15.0): the "+" next to the command bar, the row on Start, the
// buttons in a project and the commands "New …" all end here. What you create joins the project in focus by itself
// (services/projects.js). A new tool adds its entry to CREATORS and is offered everywhere at once.
import { h, modal, promptDialog, toast, actionSheet, savePref } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { capture } from '../services/notes.js';
import { createProject, focusProject, projects, setFocus } from '../services/projects.js';
import { newPageIn } from './library-home.js';
import { createCard } from '../services/reader-cards.js';
import { cardDialog } from './card-dialog.js';
import { parseStart } from '../services/crawl.js';
import { indexState } from '../services/search.js';
import { nodeHref } from './node-view.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

// A few lines of text, with the project they go to. Enter with Ctrl or ⌘ saves. Resolves to the text or null.
export function noteDialog({ text = '', title = t('create.note'), target = '' } = {}) {
  const area = h('textarea', { class: 'field note-text', rows: '5', placeholder: t('note.placeholder'), 'aria-label': t('note.placeholder') });
  area.value = text;
  const body = h('div', { class: 'form' }, area, target ? h('p', { class: 'muted small', text: target }) : null);
  return modal({
    title, body,
    actions: [
      { label: t('action.cancel'), value: null },
      { label: t('note.keep'), kind: 'primary', value: () => (area.value.trim() ? area.value : undefined) },
    ],
    onOpen: (content, close) => {
      area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && area.value.trim()) { e.preventDefault(); close(area.value); } });
      setTimeout(() => area.focus(), 60);
    },
  });
}

const failed = (e) => { console.warn('Could not create', e); toast(t('create.failed'), 'error', 5000); return null; };
const needsKnowledge = () => {
  if (indexState().hasKnowledge !== false) return false;
  toast(t('create.noKnowledge'), 'info', 5000);
  return true;
};

// Catches a thought. In a project (or with one in focus) it goes there, otherwise into the inbox.
export async function newNote({ text = '', project = '', ask = true, go } = {}) {
  if (needsKnowledge()) return null;
  const into = project ? null : focusProject();
  let body = text;
  if (ask || !body.trim()) {
    body = await noteDialog({ text, target: into ? t('note.intoFocus', { title: into.title }) : project ? '' : t('note.intoInbox') });
    if (!body) return null;
  }
  try {
    const path = await capture(body, { project });
    toast(into ? t('note.keptIn', { title: into.title }) : project ? t('note.kept') : t('note.keptInbox'), 'ok');
    return path;
  } catch (e) { return failed(e); }
}

export async function newProject({ go, title = '' } = {}) {
  if (needsKnowledge()) return null;
  const name = h('input', { class: 'field', type: 'text', value: title, placeholder: t('project.titleHint'), 'aria-label': t('project.title') });
  const goal = h('input', { class: 'field', type: 'text', placeholder: t('project.goalHint'), 'aria-label': t('project.goal') });
  const focus = h('input', { type: 'checkbox', checked: true });
  const body = h('div', { class: 'form' },
    h('label', { class: 'set-field' }, h('span', { class: 'field-label', text: t('project.title') }), name),
    h('label', { class: 'set-field' }, h('span', { class: 'field-label', text: t('project.goal') }), goal),
    h('label', { class: 'set-check' }, focus, h('span', {}, h('b', { text: t('project.focusNow') }), h('span', { class: 'field-hint', text: t('project.focusHint') }))));
  const values = await modal({
    title: t('create.project'), body,
    actions: [
      { label: t('action.cancel'), value: null },
      { label: t('project.create'), kind: 'primary', value: () => (name.value.trim() ? { title: name.value, goal: goal.value, focus: focus.checked } : undefined) },
    ],
    onOpen: (content, close) => {
      const submit = (e) => { if (e.key === 'Enter' && name.value.trim()) { e.preventDefault(); close({ title: name.value, goal: goal.value, focus: focus.checked }); } };
      name.addEventListener('keydown', submit);
      goal.addEventListener('keydown', submit);
      setTimeout(() => name.focus(), 60);
    },
  });
  if (!values) return null;
  try {
    const path = await createProject(values);
    if (values.focus) setFocus(path);
    go?.(nodeHref(path));
    return path;
  } catch (e) { return failed(e); }
}

// A card without a work behind it: straight from your head.
export async function newCard({ go, text = '' } = {}) {
  if (needsKnowledge()) return null;
  const values = await cardDialog({ text });
  if (!values) return null;
  try {
    const path = await createCard({ ...values, section: '', work: null, clipSlug: '' });
    if (values.topic) savePref('reader.topic', values.topic);
    toast(t('reader.card.made', { title: values.title }), 'ok');
    go?.(nodeHref(path));
    return path;
  } catch (e) { return failed(e); }
}

export function newSnippet({ go, code = '', title = '' } = {}) {
  if (code || title) savePref('snippet.draft', { title, code, check: '', links: [] });
  go?.('#/new');
}

// A page (0.16.0): it belongs to a project, the one in focus or the one you pick; its pages open with the new page.
export async function newPage({ go, title = '', project = '' } = {}) {
  if (needsKnowledge()) return null;
  let target = project || focusProject()?.path || '';
  if (!target) {
    const list = projects().filter((p) => p.state !== 'done');
    const v = await actionSheet(t('create.page.where'), [...list.map((p) => ({ label: p.title, value: p.path, icon: 'target' })), '-', { label: t('research.into.new'), value: '__new', icon: 'plus' }]);
    if (!v) return null;
    target = v === '__new' ? await newProject({}) : v;
    if (!target) return null;
  }
  try {
    const name = title || await promptDialog(t('create.page'), { label: t('create.page.title'), okLabel: t('research.folder.create'), validate: (v) => (v.trim() ? '' : t('create.page.needTitle')) });
    if (!name || !name.trim()) return null;
    const path = await newPageIn(target, name.trim());
    go?.('#/m/library');
    return path;
  } catch (e) { return failed(e); }
}

// Research (0.16.0): no folder to make first; what you keep goes into the project in focus.
export function openResearch({ go } = {}) {
  go?.('#/m/scraper');
}

export async function newCrawl({ go, address = '' } = {}) {
  const start = address || await promptDialog(t('crawl.title'), { label: t('create.crawl.address'), placeholder: 'docs.example.org/tutorial', okLabel: t('create.crawl.go'), type: 'url', validate: (v) => (parseStart(v.trim()) ? '' : t('create.crawl.bad')) });
  if (!start) return null;
  savePref('crawl.open', parseStart(start.trim()) || start.trim());
  go?.('#/m/scraper');
  return start;
}

// What can be created, in the order of the menu. key: the letter that picks it while the menu is open;
// start: false keeps it out of the row on Start (the menu and the commands still have it).
export const CREATORS = [
  { id: 'note', icon: 'edit', accent: 'projects', key: 'n', run: newNote, keys: 'note notiz notieren festhalten gedanke idee capture' },
  { id: 'project', icon: 'target', accent: 'projects', key: 'p', run: newProject, keys: 'project projekt vorhaben thema' },
  { id: 'folder', icon: 'search', accent: 'scraper', key: 'r', run: openResearch, keys: 'research recherche suchen lernen finden paper' },
  { id: 'crawl', icon: 'globe', accent: 'scraper', key: 'w', start: false, run: newCrawl, keys: 'website durchgehen crawl seite scrape' },
  { id: 'card', icon: 'vars', accent: 'formulary', key: 'k', run: newCard, keys: 'card karte formel formula definition begriff term satz' },
  { id: 'snippet', icon: 'code', accent: 'cheatsheet', key: 's', run: newSnippet, keys: 'snippet code baustein python' },
  { id: 'page', icon: 'file', accent: 'projects', key: 'b', run: newPage, keys: 'page seite schreiben bibliothek library text' },
];

// The menu behind "+": every creator with its letter. Resolves once something was started.
export function createMenu({ go, paint } = {}) {
  const focus = focusProject();
  const grid = h('div', { class: 'create-grid' });
  let close = null;
  const start = (c) => { close?.(true); setTimeout(() => c.run({ go }), 30); };
  for (const c of CREATORS) {
    const tile = iconEl(c.icon, 'tile');
    paint?.(tile, c.accent);
    grid.append(h('button', { type: 'button', class: 'create-item', dataset: { id: c.id }, onclick: () => start(c) },
      tile, h('span', { class: 'create-text' }, h('span', { class: 'create-label', text: t(`create.${c.id}`) }), h('span', { class: 'create-hint muted small', text: t(`create.${c.id}.hint`) })),
      h('kbd', { text: c.key.toUpperCase() })));
  }
  const body = h('div', {}, focus ? h('p', { class: 'create-focus small' }, iconEl('target'), h('span', { text: t('create.intoFocus', { title: focus.title }) })) : h('p', { class: 'muted small', text: t('create.noFocus') }), grid);
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const c = CREATORS.find((x) => x.key === e.key.toLowerCase());
    if (c) { e.preventDefault(); start(c); }
  };
  document.addEventListener('keydown', onKey);
  return modal({ title: t('create.title'), body, actions: [], onOpen: (content, c) => { close = c; } }).finally(() => document.removeEventListener('keydown', onKey));
}
