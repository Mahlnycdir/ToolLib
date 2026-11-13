// Projects (0.15.0): the list of your projects, the view of one project and the view of a note.
// Since 0.18.0 a project is a board with your own sections and widgets (project-board.js); the card of a project (list,
// Start) still shows the way its knowledge takes: collect, keep, apply.
import { loadInkNote } from '../services/kladde-store.js';
import { thumbnail } from '../services/ink.js';
import { h, toast, confirmDialog, promptDialog, actionSheet, debounce, loadPref, savePref } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { ACCENTS } from './modules.js';
import { allNodes, indexState, nodeByPath, onIndexChange, searchNodes } from '../services/search.js';
import {
  STATES, addToProject, deleteProject, focusPath, loadProject, projectNodes, projects, projectsWith, setFocus, setProjectField, touchProject, stationOf,
  boardOf, parseSections,
} from '../services/projects.js';
import { projectBody, sectionTitle, COLOUR_HEX } from './project-board.js';
import { capture, deleteNote, inbox, loadNote, saveNote } from '../services/notes.js';
import { nodeHref, nodeLead, nodeTitle, typeLabel, typeTile } from './node-view.js';
import { renderMarkdown } from './markdown.js';
import { newCard, newCrawl, newNote, newPage, newProject, newSnippet } from './create.js';
import { openWriting } from './library-home.js';
import { loadLibrary } from '../services/library-store.js';
import { dissolveFolder } from '../services/research-store.js';
import { queueSearch } from './research-view.js';
import { cardDialog } from './card-dialog.js';
import { createCard } from '../services/reader-cards.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

// ------------------------------------------------------------------ the three stations (on the cards of projects)
export const STATIONS = ['collect', 'keep', 'apply'];
export { stationOf };
const STATION_ICON = { collect: 'search', keep: 'bookmark', apply: 'play' };

// Every project has its own colour, from its name: you recognise it before you read it.
const COLOURS = ACCENTS.filter((a) => a.id !== 'yellow');
export function projectAccent(slug) {
  let n = 0;
  for (const c of String(slug)) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return COLOURS[n % COLOURS.length];
}
export function paintProject(el, slug) {
  const a = projectAccent(slug);
  el.style.setProperty('--accent', a.color);
  el.style.setProperty('--accent-ink', a.ink);
}

export function stationCounts(d) {
  const counts = { collect: 0, keep: 0, apply: 0 };
  for (const n of projectNodes(d.links)) counts[stationOf(n.type)]++;
  return counts;
}
// The sections of a project's board with their cards, from the index (0.18.0)
export const boardOfSummary = (d) => boardOf({ sections: parseSections(d.board?.sections || []), board: d.board?.lists || {} }, projectNodes(d.links));

// The track: three stations joined by a line. onStation(id) is what a tap does.
// Since 0.18.0 the stops are the sections of the board, in their colours and with their names.
export function track(d, { onStation } = {}) {
  const secs = boardOfSummary(d);
  const el = h('div', { class: `track${secs.length > 3 ? ' many' : ''}`, role: 'group', 'aria-label': t('project.track') });
  secs.forEach((s, i) => {
    if (i) el.append(h('span', { class: 'track-line', 'aria-hidden': 'true' }));
    const stop = h('button', { type: 'button', class: `track-stop${s.items.length ? '' : ' empty'}`, dataset: { station: s.id }, onclick: () => onStation?.(s.id) },
      STATION_ICON[s.id] ? iconEl(STATION_ICON[s.id]) : h('span', { class: 'board-dot' }), h('span', { class: 'track-name', text: sectionTitle(s) }), h('span', { class: 'track-n', text: String(s.items.length) }));
    stop.style.setProperty('--sec', COLOUR_HEX[s.color] || COLOUR_HEX.slate);
    el.append(stop);
  });
  return el;
}

const stateLabel = (s) => t(`project.state.${s}`);
let refocus = '';   // 'step' or 'quick': the field that keeps the focus when the project is drawn again

// ------------------------------------------------------------------ list of projects
export function renderProjects(main, mod, { go }) {
  main.dataset.view = 'projects';
  const head = h('div', { class: 'module-head' }, iconEl(mod.icon, 'tile big'),
    h('div', {}, h('h1', { class: 'view-title', text: t('module.projects.name') }), h('p', { class: 'lead', text: t('module.projects.desc') })));
  const add = h('button', { type: 'button', class: 'btn primary new-project', onclick: () => newProject({ go }) }, iconEl('plus'), h('span', { text: t('create.project') }));
  const list = h('div', { class: 'project-list' });
  main.append(head, h('div', { class: 'btn-row' }, add), list);

  function draw() {
    const s = indexState();
    list.replaceChildren();
    if (!s.ready) { list.append(h('p', { class: 'muted', text: t('commandbar.indexing') })); return; }
    const all = projects();
    if (!all.length) {
      list.append(h('div', { class: 'empty-invite' }, h('p', { text: t('project.none') }), h('p', { class: 'muted small', text: t('project.none.hint') })));
      return;
    }
    for (const d of all) list.append(projectCard(d, { go }));
    const loose = inbox();
    if (loose.length) list.append(h('p', { class: 'muted small' }, t('inbox.waiting', { n: loose.length }), ' ', h('a', { href: '#/home', text: t('nav.home') })));
  }
  const stop = onIndexChange((s) => { if (!list.isConnected) stop(); else if (!s.building) draw(); });
  draw();
}

// A project as a card: title, goal, next step, the track. Used in the list and on Start.
export function projectCard(d, { go, big = false } = {}) {
  const inFocus = focusPath() === d.path;
  const card = h('article', { class: `project-card${big ? ' big' : ''}${inFocus ? ' focus' : ''} state-${d.state}`, dataset: { path: d.path } });
  paintProject(card, d.slug);
  const open = () => go(nodeHref(d.path));
  const title = h('a', { class: 'project-title', href: nodeHref(d.path), text: d.title });
  const focus = h('button', { type: 'button', class: `btn small focus-btn${inFocus ? ' on' : ''}`, 'aria-pressed': String(inFocus), title: t(inFocus ? 'project.focus.off' : 'project.focus.hint') },
    iconEl('target'), h('span', { text: t(inFocus ? 'project.focus.on' : 'project.focus.set') }));
  focus.addEventListener('click', () => setFocus(inFocus ? '' : d.path));
  card.append(h('header', { class: 'project-head' }, h('div', { class: 'project-names' }, title,
    d.state !== 'active' ? h('span', { class: 'chip', text: stateLabel(d.state) }) : null), focus));
  if (d.goal) card.append(h('p', { class: 'project-goal', text: d.goal }));
  if (d.steps?.next) card.append(h('p', { class: 'project-next' }, h('span', { class: 'muted', text: `${t('project.next')} ` }), h('span', { text: d.steps.next })));
  else if (big) card.append(h('p', { class: 'project-next muted', text: t('project.next.none') }));
  card.append(track(d, { onStation: (id) => { savePref('project.station', { path: d.path, id, at: Date.now() }); open(); } }));
  return card;
}

// ------------------------------------------------------------------ one project
export async function renderProject(main, path, ctx) {
  const { isCurrent, go } = ctx;
  main.dataset.view = 'project';
  const box = h('article', { class: 'project node' });
  main.append(box);
  let p;
  try { p = await loadProject(path); } catch { p = null; }
  if (!isCurrent()) return;
  if (!p) { box.append(h('h1', { class: 'view-title', text: t('node.notFound') })); return; }
  touchProject(path);
  paintProject(box, p.slug);
  // drawn again after a change; the shell keeps the row you were at (0.22.0)
  const redraw = async () => {
    if (!isCurrent()) return;
    main.replaceChildren();
    await renderProject(main, path, ctx);
  };
  const d = nodeByPath(path) || { links: p.links, slug: p.slug, path };
  const inFocus = focusPath() === path;

  // head: back, title, focus
  box.append(h('button', { type: 'button', class: 'btn small back-btn', onclick: () => go('#/m/projects') }, iconEl('chevronLeft'), h('span', { text: t('module.projects.name') })));
  const title = h('h1', { class: 'view-title project-h', text: p.title });
  const rename = async () => {
    const v = await promptDialog(t('project.rename'), { value: p.title, validate: (x) => (x.trim() ? '' : t('project.needTitle')) });
    if (v && v.trim() !== p.title && await setProjectField(path, 'title', v)) redraw();
  };
  const focus = h('button', { type: 'button', class: `btn focus-btn${inFocus ? ' on primary' : ''}`, 'aria-pressed': String(inFocus) }, iconEl('target'), h('span', { text: t(inFocus ? 'project.focus.on' : 'project.focus.set') }));
  focus.addEventListener('click', () => { setFocus(inFocus ? '' : path); redraw(); });
  const more = h('button', { type: 'button', class: 'icon-btn project-more', 'aria-label': t('project.more'), title: t('project.more'), html: icon('more') });
  more.addEventListener('click', async () => {
    const pick = await actionSheet(p.title, [
      ...STATES.filter((s) => s !== p.state).map((s) => ({ label: t('project.setState', { state: stateLabel(s) }), value: `state:${s}`, icon: s === 'done' ? 'check' : s === 'paused' ? 'pause' : 'play' })),
      { label: t('project.rename'), value: 'rename', icon: 'edit' }, '-',
      { label: t('project.delete'), value: 'delete', icon: 'trash', danger: true },
    ]);
    if (!pick) return;
    if (pick === 'rename') { rename(); return; }
    if (pick.startsWith('state:')) { if (await setProjectField(path, 'state', pick.slice(6))) redraw(); return; }
    if (!(await confirmDialog(t('project.delete'), t('project.delete.confirm', { title: p.title, n: p.links.length }), { okLabel: t('project.delete'), danger: true }))) return;
    await deleteProject(path);
    toast(t('project.deleted'), 'ok');
    go('#/m/projects');
  });
  box.append(h('header', { class: 'project-top' }, h('div', { class: 'project-names' }, title, p.state !== 'active' ? h('span', { class: 'chip', text: stateLabel(p.state) }) : null), h('div', { class: 'project-actions' }, focus, more)));
  const goal = h('button', { type: 'button', class: `project-goal-btn${p.goal ? '' : ' muted'}`, text: p.goal || t('project.goal.add') });
  goal.addEventListener('click', async () => {
    const v = await promptDialog(t('project.goal'), { value: p.goal, placeholder: t('project.goalHint') });
    if (v != null && v.trim() !== p.goal && await setProjectField(path, 'goal', v)) redraw();
  });
  box.append(goal);
  if (inFocus) box.append(h('p', { class: 'focus-note small' }, iconEl('target'), h('span', { text: t('project.focus.note') })));

  // the board (0.18.0): actions, widgets, sections with their cards
  const fields = {};
  box.append(...projectBody(p, { path, go, redraw, fields, refocus: { set: (v) => { refocus = v; } } }));

  // a station tapped on a card elsewhere: go to its section; after adding a step or a note the field keeps the focus
  const want = loadPref('project.station', null);
  if (want && want.path === path && Date.now() - want.at < 4000) {
    savePref('project.station', null);
    requestAnimationFrame(() => box.querySelector(`.board-col[data-sec="${want.id}"]`)?.scrollIntoView({ block: 'start' }));
  }
  if (refocus) { (refocus === 'step' ? fields.step : box.querySelector('.quick-note'))?.focus({ preventScroll: true }); refocus = ''; }
}

// ------------------------------------------------------------------ a note
export async function renderNote(main, path, ctx) {
  const { isCurrent, go } = ctx;
  main.dataset.view = 'note';
  const box = h('article', { class: 'node note-view' });
  main.append(box);
  let n;
  try { n = await loadNote(path); } catch { n = null; }
  if (!isCurrent()) return;
  box.append(h('button', { type: 'button', class: 'btn small back-btn', onclick: () => (history.length > 1 ? history.back() : go('#/home')) }, iconEl('chevronLeft'), h('span', { text: t('action.back') })));
  if (!n) { box.append(h('h1', { class: 'view-title', text: t('node.notFound') })); return; }
  const d = nodeByPath(path);
  const when = n.at ? new Date(n.at) : null;
  const inProjects = d ? projectsWith(d.slug) : [];
  box.append(h('header', { class: 'node-head' }, typeTile('note', 'big'), h('div', { class: 'node-titles' },
    h('h1', { class: 'view-title', text: n.title || t('type.note') }),
    h('p', { class: 'muted small', text: [when && !Number.isNaN(when.getTime()) ? when.toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '', inProjects.length ? '' : t('note.inInbox')].filter(Boolean).join(' · ') }),
    inProjects.length ? h('div', { class: 'node-chips' }, inProjects.map((p) => { const c = h('a', { class: 'chip chip-project', href: nodeHref(p.path) }, iconEl('target'), h('span', { text: p.title })); paintProject(c, p.slug); return c; })) : null)));

  // a handwritten note (0.21.0): its page as a picture, opens in Kladde
  if (d?.ink) {
    const pic = h('button', { type: 'button', class: 'note-ink', 'aria-label': t('kladde.openInKladde'), onclick: () => { savePref('kladde.open', path); go('#/m/kladde'); } },
      h('span', { class: 'note-ink-pic' }), h('span', { class: 'btn small' }, iconEl('edit'), h('span', { text: t('kladde.openInKladde') })));
    box.append(pic);
    loadInkNote(path).then((x) => { const url = thumbnail(x.strokes, { w: 640, h: 300, color: '#15171b' }); if (url) pic.firstChild.append(h('img', { src: url, alt: '' })); }).catch(() => {});
  }
  const area = h('textarea', { class: 'field note-text big', rows: '8', 'aria-label': t('type.note') });
  area.value = n.text;
  const view = h('div', { class: 'note-read' });
  const showRead = () => view.replaceChildren(renderMarkdown(area.value, { onNodeLink: (slug) => { const x = allNodes().find((y) => y.slug === slug && !y.conflict); return x ? { href: nodeHref(x.path), label: nodeTitle(x) } : null; } }));
  const saved = h('span', { class: 'muted small note-saved' });
  const save = async () => { try { if (await saveNote(path, area.value)) saved.textContent = t('research.saved'); } catch { saved.textContent = t('research.saveFailed'); } };
  const later = debounce(save, 1000);
  area.addEventListener('input', () => { saved.textContent = ''; later(); });
  area.addEventListener('blur', () => { later.cancel(); save().then(() => { showRead(); box.classList.remove('editing'); }); });
  const edit = h('button', { type: 'button', class: 'btn small note-edit', onclick: () => { box.classList.add('editing'); area.focus(); } }, iconEl('edit'), h('span', { text: t('node.edit') }));
  showRead();
  view.addEventListener('dblclick', () => edit.click());

  const file = async () => {
    const all = projects();
    if (!all.length) { const made = await newProject({ go: null }); if (made && d) { await addToProject(made, [d.slug]); go(nodeHref(made)); } return; }
    const pick = await actionSheet(t('note.toProject'), [...all.map((p) => ({ label: p.title, value: p.path, icon: 'target' })), '-', { label: t('create.project'), value: 'new', icon: 'plus' }]);
    if (!pick || !d) return;
    const target = pick === 'new' ? await newProject({ go: null }) : pick;
    if (!target) return;
    await addToProject(target, [d.slug]);
    toast(t('note.filed', { title: nodeByPath(target)?.title || '' }), 'ok');
    go(nodeHref(path));
  };
  const toCard = async () => {
    const values = await cardDialog({ text: area.value });
    if (!values || !d) return;
    try {
      const made = await createCard({ ...values, section: '', work: null, clipSlug: '' });
      for (const p of inProjects) await addToProject(p.path, [made.slice(made.lastIndexOf('/') + 1).replace(/\.md$/, '')]);
      await deleteNote(path);
      toast(t('reader.card.made', { title: values.title }), 'ok');
      go(nodeHref(made));
    } catch { toast(t('reader.card.failed'), 'error', 5000); }
  };
  const remove = async () => {
    if (!(await confirmDialog(t('note.delete'), t('note.delete.confirm'), { okLabel: t('note.delete'), danger: true }))) return;
    await deleteNote(path);
    toast(t('note.deleted'), 'ok');
    if (history.length > 1) history.back(); else go('#/home');
  };
  const btn = (key, iconName, fn, cls = '') => h('button', { type: 'button', class: `btn small ${cls}`, onclick: fn }, iconEl(iconName), h('span', { text: t(key) }));
  box.append(view, area, h('div', { class: 'btn-row note-actions' }, edit, saved),
    h('h2', { text: t('note.then') }),
    h('div', { class: 'btn-row note-next' },
      btn('note.toProject', 'target', file, 'note-file'),
      btn('note.toCard', 'vars', toCard, 'note-card'),
      btn('note.toSnippet', 'code', () => newSnippet({ go, code: area.value, title: n.title }), 'note-snippet'),
      btn('note.toSearch', 'search', () => { queueSearch(n.title || area.value.slice(0, 80)); go('#/m/scraper'); }, 'note-search'),
      btn('note.delete', 'trash', remove, 'note-delete')));
}
