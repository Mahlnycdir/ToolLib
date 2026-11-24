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
  STATES, addToFocus, addToProject, deleteProject, focusList, focusPath, focusRank, loadProject, moveFocus, onFocusChange, removeFromFocus, projectNodes, projects, projectsWith, setFocus, setProjectField, touchProject, stationOf,
  boardOf, parseSections, repoLabel, repoUrl,
} from '../services/projects.js';
import { projectBody, sectionTitle, keepView } from './project-board.js';
import { stepsEditor } from './steps-ui.js';
import { talkPanel } from './loom-talk.js';
import { diveOf, onDiveChange } from '../services/dive.js';
import { colourVar } from './colors.js';
import { nextUp } from '../services/projects.js';
import { capture, inbox, loadNote, saveNote } from '../services/notes.js';
import { askDelete } from './delete-node.js';
import { nodeHref, nodeLead, nodeTitle, typeLabel, typeTile } from './node-view.js';
import { renderMarkdown } from './markdown.js';
import { createEditor } from './md-editor.js';
import { offsetAtPoint } from './tap-place.js';
import { newCard, newCrawl, newNote, newPage, newProject, newSnippet } from './create.js';
import { openWriting } from './library-home.js';
import { loadLibrary } from '../services/library-store.js';
import { dissolveFolder } from '../services/research-store.js';
import { queueSearch } from './research-view.js';
import { cardDialog } from './card-dialog.js';
import { createCard } from '../services/reader-cards.js';
import { connect } from '../services/relations.js';
import { openFocusSheet } from './focus-ui.js';
import { repairCanvasSections } from './project-canvas.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

// ------------------------------------------------------------------ the three stations (on the cards of projects)
export const STATIONS = ['collect', 'keep', 'apply'];
export { stationOf };
const STATION_ICON = { collect: 'search', keep: 'bookmark', apply: 'play' };

// Every project has its own colour, from its name: you recognise it before you read it.
const COLOURS = ACCENTS.filter((a) => a.id !== 'yellow' && a.id !== 'amber');   // amber is the one warm light (0.32.0)
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
    stop.style.setProperty('--sec', colourVar(s.color));
    el.append(stop);
  });
  return el;
}

const stateLabel = (s) => t(`project.state.${s}`);
let refocus = '';   // 'step' or 'quick': the field that keeps the focus when the project is drawn again

// ------------------------------------------------------------------ list of projects
// 0.33.7 (ENTE: "Die Ansicht ist doof … am Handy kann man nicht mal in der horizontalen verschieben … eine
// modernisierte Ansicht statt solch eine langgezogene"): tiles in a grid instead of one long card per project. First
// the projects in focus, in the order of their priorities (number on the tile), then the others, done ones folded.
// A tile: number, title, goal, a ring (steps done), the next step, a slim bar of its sections (width = cards in it,
// colour = section) and the days left. Nothing is wider than the screen, on the phone one column.
export function renderProjects(main, mod, { go }) {
  main.dataset.view = 'projects';
  const head = h('div', { class: 'module-head' }, iconEl(mod.icon, 'tile big'),
    h('div', {}, h('h1', { class: 'view-title', text: t('module.projects.name') }), h('p', { class: 'lead', text: t('module.projects.desc') })));
  const add = h('button', { type: 'button', class: 'btn primary new-project', onclick: () => newProject({ go }) }, iconEl('plus'), h('span', { text: t('create.project') }));
  const prios = h('button', { type: 'button', class: 'btn', onclick: () => openFocusSheet() }, iconEl('target'), h('span', { text: t('focus.manage') }));
  const list = h('div', { class: 'project-overview' });
  main.append(head, h('div', { class: 'btn-row' }, add, prios), list);
  let showDone = false;

  function draw() {
    const s = indexState();
    list.replaceChildren();
    if (!s.ready) { list.append(h('p', { class: 'muted', text: t('commandbar.indexing') })); return; }
    const all = projects();
    if (!all.length) {
      list.append(h('div', { class: 'empty-invite' }, h('p', { text: t('project.none') }), h('p', { class: 'muted small', text: t('project.none.hint') })));
      return;
    }
    const focus = focusList();
    const inFocus = new Set(focus.map((d) => d.path));
    const rest = all.filter((d) => !inFocus.has(d.path) && d.state !== 'done');
    const done = all.filter((d) => d.state === 'done');
    const group = (title, items) => h('section', { class: 'project-group' }, h('h2', { class: 'project-group-title', text: title }), h('div', { class: 'project-tiles' }, items.map((d) => projectTile(d, { go }))));
    if (focus.length) list.append(group(t('projects.inFocus'), focus));
    if (rest.length) list.append(group(t(focus.length ? 'projects.others' : 'projects.all'), rest));
    if (done.length) {
      list.append(h('button', { type: 'button', class: 'btn small ghost project-done-toggle', text: t(showDone ? 'projects.done.hide' : 'projects.done.show', { n: done.length }), onclick: () => { showDone = !showDone; draw(); } }));
      if (showDone) list.append(group(t('project.state.done'), done));
    }
    const loose = inbox();
    if (loose.length) list.append(h('p', { class: 'muted small' }, t('inbox.waiting', { n: loose.length }), ' ', h('a', { href: '#/home', text: t('nav.home') })));
  }
  const stop = onIndexChange((s) => { if (!list.isConnected) stop(); else if (!s.building) draw(); });
  const stopF = onFocusChange(() => { if (!list.isConnected) stopF(); else draw(); });
  draw();
}

// the ring of a project: steps done of all (svg)
export function progressRing(done, all, size = 44) {
  const part = all ? done / all : 0;
  const R = 18; const C = 2 * Math.PI * R;
  const NS = 'http://www.w3.org/2000/svg';
  const ring = document.createElementNS(NS, 'svg');
  ring.setAttribute('viewBox', '0 0 44 44'); ring.setAttribute('width', size); ring.setAttribute('height', size); ring.setAttribute('class', 'tile-ring'); ring.setAttribute('role', 'img');
  ring.setAttribute('aria-label', t('start.focus.part', { n: Math.round(part * 100) }));
  const circle = (stroke, dash) => { const c = document.createElementNS(NS, 'circle'); for (const [k, v] of Object.entries({ cx: 22, cy: 22, r: R, fill: 'none', stroke, 'stroke-width': 3.5, 'stroke-linecap': 'round', transform: 'rotate(-90 22 22)' })) c.setAttribute(k, v); if (dash) c.setAttribute('stroke-dasharray', dash); return c; };
  ring.append(circle('var(--line)'), circle('var(--accent, var(--light))', `${(part * C).toFixed(1)} ${C.toFixed(1)}`));
  const label = document.createElementNS(NS, 'text');
  for (const [k, v] of Object.entries({ x: 22, y: 25.5, 'text-anchor': 'middle', fill: 'currentColor', 'font-size': 10.5, 'font-weight': 650 })) label.setAttribute(k, v);
  label.textContent = all ? `${Math.round(part * 100)}%` : '–';
  ring.append(label);
  return ring;
}

const daysTo = (date) => Math.round((new Date(`${date}T00:00:00`) - new Date(new Date().toDateString())) / 864e5);

// A project as a tile (0.33.7). Also exported as projectCard for older callers.
export function projectTile(d, { go } = {}) {
  const rank = focusRank(d.path);
  const st = d.steps || {};
  const all = (st.open || 0) + (st.done || 0);
  const secs = boardOfSummary(d);
  const cards = secs.reduce((n, x) => n + x.items.length, 0);
  const tile = h('article', { class: `project-tile state-${d.state}${rank ? ' in-focus' : ''}${focusPath() === d.path ? ' here' : ''}`, dataset: { path: d.path } });
  paintProject(tile, d.slug);
  const open = () => go(nodeHref(d.path));
  const focusBtn = h('button', {
    type: 'button', class: `btn small focus-btn${rank ? ' on' : ''}`, 'aria-pressed': String(!!rank), title: t(rank ? 'focus.remove' : 'project.focus.hint'),
    onclick: (e) => { e.stopPropagation(); if (rank) removeFromFocus(d.path); else addToFocus(d.path); },
  }, iconEl('target'), h('span', { text: t(rank ? 'project.focus.on' : 'focus.add') }));
  const bar = h('div', { class: 'tile-sections', title: t('projects.sections', { n: secs.length, cards }) });
  for (const x of secs) {
    if (!x.items.length) continue;
    const seg = h('span', { class: 'tile-seg', title: `${sectionTitle(x)} · ${x.items.length}` });
    seg.style.flexGrow = String(x.items.length);
    seg.style.setProperty('--sec', colourVar(x.color));
    bar.append(seg);
  }
  if (!bar.firstChild) bar.append(h('span', { class: 'tile-seg empty' }));
  const due = d.due ? daysTo(d.due) : null;
  tile.append(
    h('div', { class: 'tile-top' },
      rank ? h('span', { class: 'focus-rank big', title: t('focus.rank', { n: rank }), text: String(rank) }) : h('span', { class: 'project-dot', 'aria-hidden': 'true' }),
      h('a', { class: 'tile-title', href: nodeHref(d.path), text: d.title }),
      d.state !== 'active' ? h('span', { class: 'chip', text: stateLabel(d.state) }) : null),
    h('div', { class: 'tile-mid' }, progressRing(st.done || 0, all),
      h('div', { class: 'tile-text' },
        d.goal ? h('p', { class: 'tile-goal muted small', text: d.goal }) : null,
        h('p', { class: 'tile-next' }, h('span', { class: 'muted small', text: t('project.next') }), h('span', { text: st.next || t(all ? 'steps.allDone' : 'project.next.none') })))),
    bar,
    h('div', { class: 'tile-foot muted small' },
      h('span', { text: t('projects.sections', { n: secs.length, cards }) }),
      due != null ? h('span', { class: due <= 3 ? 'soon' : '', text: due === 0 ? t('due.today') : t(due < 0 ? 'pult.dueAgo' : 'pult.dueIn', { n: Math.abs(due) }) }) : null,
      focusBtn));
  tile.addEventListener('click', (e) => { if (!e.target.closest('a, button')) open(); });
  return tile;
}
export const projectCard = projectTile;

// ------------------------------------------------------------------ the code of a project (0.24.0)
// A project can know its code repository; Kobra keeps the list of yours (kobra.git.repos) and opens it.
function kobraRepos() {
  try {
    const list = JSON.parse(localStorage.getItem('kobra.git.repos') || '[]');
    return Array.isArray(list) ? list.filter((r) => r && repoUrl(r.url)) : [];
  } catch { return []; }
}

// Asks which repository; true when the project changed.
async function chooseRepo(path, current) {
  const mine = kobraRepos();
  const pick = await actionSheet(t('project.repo.pick'), [
    ...mine.map((r) => ({ label: r.name || repoLabel(r.url), detail: repoLabel(r.url), value: r.url, icon: 'code' })),
    ...(mine.length ? ['-'] : []),
    { label: t('project.repo.address'), value: '@address', icon: 'link' },
    ...(current ? [{ label: t('project.repo.remove'), value: '@remove', icon: 'close', danger: true }] : []),
  ]);
  if (!pick) return false;
  let url = pick;
  if (pick === '@remove') url = '';
  else if (pick === '@address') {
    const v = await promptDialog(t('project.repo.address'), {
      value: current, placeholder: 'https://github.com/…/….git',
      validate: (x) => (repoUrl(x) ? '' : t('project.repo.invalid')),
    });
    if (v == null) return false;
    url = repoUrl(v);
  }
  if (url === current) return false;
  return !!(await setProjectField(path, 'repo', url));
}

function repoRow(url, go) {
  const open = h('button', { type: 'button', class: 'btn small primary project-repo-open' }, iconEl('code'), h('span', { text: t('project.repo.open') }));
  open.addEventListener('click', () => {
    const known = kobraRepos().find((r) => r.url === url);
    localStorage.setItem('kobra.open', JSON.stringify({ project: { url, name: known?.name || repoLabel(url).split('/').pop() } }));
    go('#/m/kobra');
  });
  return h('p', { class: 'project-repo' }, iconEl('code'), h('span', { class: 'muted', text: `${t('project.repo')} ` }),
    h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: repoLabel(url) }), open);
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
  // 0.33.7: groups taken over twice before (empty twins) and groups inside frames: tidied once
  try { if (await repairCanvasSections(path, p)) p = (await loadProject(path)) || p; } catch (e) { console.warn('repair', e); }
  if (!isCurrent()) return;
  touchProject(path);
  paintProject(box, p.slug);
  // drawn again after a change; the shell keeps the row you were at (0.22.0)
  const redraw = async () => {
    if (!isCurrent()) return;
    main.replaceChildren();
    await renderProject(main, path, ctx);
  };
  const d = nodeByPath(path) || { links: p.links, slug: p.slug, path };
  const rank = focusRank(path);
  const inFocus = !!rank;

  // head: back, title, focus
  box.append(h('button', { type: 'button', class: 'btn small back-btn', onclick: () => go('#/m/projects') }, iconEl('chevronLeft'), h('span', { text: t('module.projects.name') })));
  const title = h('h1', { class: 'view-title project-h', text: p.title });
  const rename = async () => {
    const v = await promptDialog(t('project.rename'), { value: p.title, validate: (x) => (x.trim() ? '' : t('project.needTitle')) });
    if (v && v.trim() !== p.title && await setProjectField(path, 'title', v)) redraw();
  };
  // 0.33.7: in focus with its priority; a tap changes the priority or takes it out
  const focus = h('button', { type: 'button', class: `btn focus-btn${inFocus ? ' on primary' : ''}`, 'aria-pressed': String(inFocus) }, iconEl('target'),
    h('span', { text: inFocus ? t('project.focus.rank', { n: rank }) : t('project.focus.set') }));
  focus.addEventListener('click', async () => {
    if (!inFocus) { addToFocus(path); redraw(); return; }
    const n = focusList().length;
    const pick = await actionSheet(p.title, [
      ...Array.from({ length: n }, (_, i) => ({ label: `${i + 1 === rank ? '✓ ' : ''}${t('focus.rank', { n: i + 1 })}`, value: `r:${i + 1}`, icon: 'target' })),
      '-', { label: t('focus.remove'), value: 'out', icon: 'close' }]);
    if (!pick) return;
    if (pick === 'out') removeFromFocus(path); else moveFocus(path, +pick.slice(2));
    redraw();
  });
  const more = h('button', { type: 'button', class: 'icon-btn project-more', 'aria-label': t('project.more'), title: t('project.more'), html: icon('more') });
  more.addEventListener('click', async () => {
    const pick = await actionSheet(p.title, [
      ...STATES.filter((s) => s !== p.state).map((s) => ({ label: t('project.setState', { state: stateLabel(s) }), value: `state:${s}`, icon: s === 'done' ? 'check' : s === 'paused' ? 'pause' : 'play' })),
      { label: t('project.rename'), value: 'rename', icon: 'edit' },
      { label: t(p.repo ? 'project.repo.change' : 'project.repo.link'), value: 'repo', icon: 'code' }, '-',
      { label: t('project.delete'), value: 'delete', icon: 'trash', danger: true },
    ]);
    if (!pick) return;
    if (pick === 'rename') { rename(); return; }
    if (pick === 'repo') { if (await chooseRepo(path, p.repo)) redraw(); return; }
    if (pick.startsWith('state:')) { if (await setProjectField(path, 'state', pick.slice(6))) redraw(); return; }
    if (!(await confirmDialog(t('project.delete'), t('project.delete.confirm', { title: p.title, n: p.links.length }), { okLabel: t('project.delete'), danger: true }))) return;
    await deleteProject(path);
    toast(t('project.deleted'), 'ok');
    go('#/m/projects');
  });
  // 0.33.0: this project beside the page you are on (Mac; the tab can be pulled to the right edge too)
  const beside = h('button', { type: 'button', class: 'icon-btn project-beside', 'aria-label': t('side.open'), title: t('side.open'), html: icon('split') });
  beside.addEventListener('click', () => window.dispatchEvent(new CustomEvent('loom:side', { detail: nodeHref(path) })));
  box.append(h('header', { class: 'project-top' }, h('div', { class: 'project-names' }, title, p.state !== 'active' ? h('span', { class: 'chip', text: stateLabel(p.state) }) : null), h('div', { class: 'project-actions' }, focus, beside, more)));
  const goal = h('button', { type: 'button', class: `project-goal-btn${p.goal ? '' : ' muted'}`, text: p.goal || t('project.goal.add') });
  goal.addEventListener('click', async () => {
    const v = await promptDialog(t('project.goal'), { value: p.goal, placeholder: t('project.goalHint') });
    if (v != null && v.trim() !== p.goal && await setProjectField(path, 'goal', v)) redraw();
  });
  box.append(goal);
  if (p.repo) box.append(repoRow(p.repo, go));

  // 0.33.0 (Loom, entwurf J5): the structure on the left, the views in the middle (Fokus, Board, Leinwand, Widgets),
  // the project, its steps and the conversation with Loom on the right
  const fields = {};
  const ctx2 = { path, go, redraw, fields, refocus: { set: (v) => { refocus = v; } } };
  const center = h('section', { class: 'lp-center' }, ...projectBody(p, ctx2));
  box.append(h('div', { class: 'lp' }, projectStructure(p, ctx2), center, projectSide(p, ctx2)));

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
  // Writing a note (0.31.0): the editor of the library, so lists and numbers go on with Enter, formulas and shorthand
  // work; a tap on the text opens it with the cursor where you tapped (ENTE: "der Cursor soll an die Stelle springen,
  // wo ich draufgeklickt habe"). Before, a plain text field opened with a double click, the cursor at the end.
  let text = n.text;
  const host = h('div', { class: 'note-editor' });
  let editor = null;
  const view = h('div', { class: 'note-read', title: t('note.tapToEdit') });
  const showRead = () => view.replaceChildren(renderMarkdown(text, { onNodeLink: (slug) => { const x = allNodes().find((y) => y.slug === slug && !y.conflict); return x ? { href: nodeHref(x.path), label: nodeTitle(x) } : null; } }));
  const saved = h('span', { class: 'muted small note-saved' });
  const save = async () => { try { if (await saveNote(path, text)) saved.textContent = t('research.saved'); } catch { saved.textContent = t('research.saveFailed'); } };
  const later = debounce(save, 1000);
  const stopEditing = () => { later.cancel(); save().then(() => { if (!box.isConnected) return; showRead(); box.classList.remove('editing'); }); };
  function startEditing(at = null) {
    box.classList.add('editing');
    if (!editor) {
      editor = createEditor(host, { kind: 'note', value: text, label: t('type.note'), onChange: (v) => { text = v; saved.textContent = ''; later(); }, onBlur: stopEditing });
    } else editor.setValue(text);
    editor.focus();
    const pos = at == null ? text.length : Math.max(0, Math.min(text.length, at));
    editor.setSelection(pos, pos);
  }
  const edit = h('button', { type: 'button', class: 'btn small note-edit', onclick: () => startEditing() }, iconEl('edit'), h('span', { text: t('node.edit') }));
  showRead();
  view.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, summary, .copy-btn, .code-head')) return;
    if (String(window.getSelection() || '')) return;   // you are selecting text to copy
    startEditing(offsetAtPoint(view, text, e.clientX, e.clientY));
  });
  const area = { get value() { return text; } };   // what the buttons below hand on

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
  // 0.33.0 (P35): a card from the note or from what you selected in it; the note stays, the two stay linked
  // (the note points to the card), and the card joins the projects of the note.
  const selected = () => {
    const sel = window.getSelection();
    const text = String(sel || '').trim();
    return text && sel.anchorNode && box.contains(sel.anchorNode) ? text : '';
  };
  const toCard = async (from = '') => {
    const values = await cardDialog({ text: from || selected() || area.value });
    if (!values || !d) return;
    try {
      const made = await createCard({ ...values, section: '', work: null, clipSlug: '' });
      const slug = made.slice(made.lastIndexOf('/') + 1).replace(/\.md$/, '');
      for (const p of inProjects) await addToProject(p.path, [slug]);
      await connect(d.slug, slug).catch(() => false);
      toast(t('note.card.made', { title: values.title }), 'ok', 6000, { label: t('note.card.open'), run: () => go(nodeHref(made)) });
      go(nodeHref(path));
    } catch { toast(t('reader.card.failed'), 'error', 5000); }
  };
  // a small button beside what you select in the note
  const selBtn = h('button', { type: 'button', class: 'btn small primary note-sel-card', hidden: true }, iconEl('vars'), h('span', { text: t('note.selToCard') }));
  selBtn.addEventListener('mousedown', (e) => e.preventDefault());
  selBtn.addEventListener('click', () => { const text = selected(); selBtn.hidden = true; toCard(text); });
  const onSel = () => {
    if (!box.isConnected) { document.removeEventListener('selectionchange', onSel); return; }
    const text = selected();
    const sel = window.getSelection();
    if (!text || !view.contains(sel.anchorNode)) { selBtn.hidden = true; return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const b = box.getBoundingClientRect();
    selBtn.hidden = false;
    selBtn.style.left = `${Math.max(0, Math.min(b.width - 160, r.left - b.left))}px`;
    selBtn.style.top = `${r.bottom - b.top + 6}px`;
  };
  document.addEventListener('selectionchange', onSel);
  // 0.35.1: a note goes like every other node: one question, out of its projects too, and "Undo" in the toast.
  // A handwritten one takes its .ink file with it (Kladde's own way, without Undo).
  const remove = async () => {
    if (!d?.ink) { await askDelete(path, { go, title: n.title || t('type.note') }); return; }
    if (!(await confirmDialog(t('note.delete'), t('note.delete.confirm'), { okLabel: t('note.delete'), danger: true }))) return;
    await (await import('../services/kladde-store.js')).deleteInkNote(path);
    toast(t('note.deleted'), 'ok');
    if (history.length > 1) history.back(); else go('#/home');
  };
  const btn = (key, iconName, fn, cls = '') => h('button', { type: 'button', class: `btn small ${cls}`, onclick: fn }, iconEl(iconName), h('span', { text: t(key) }));
  box.append(view, selBtn, host, h('div', { class: 'btn-row note-actions' }, edit, saved),
    h('h2', { text: t('note.then') }),
    h('div', { class: 'btn-row note-next' },
      btn('note.toProject', 'target', file, 'note-file'),
      btn('note.toCard', 'vars', () => toCard(), 'note-card'),
      btn('note.toSnippet', 'code', () => newSnippet({ go, code: area.value, title: n.title }), 'note-snippet'),
      btn('note.toSearch', 'search', () => { queueSearch(n.title || area.value.slice(0, 80)); go('#/m/scraper'); }, 'note-search'),
      btn('note.delete', 'trash', remove, 'note-delete')));
}

// ------------------------------------------------------------------ the project page around its views (0.33.0)
// Left: the structure, always in sight while you dive deep (J5): the ring, the sections with their subgroups and
// counts, and under the section you dived from the trail of the rabbit hole.
function ringSvg(part, size = 44) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 44 44'); svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); svg.setAttribute('class', 'loom-ring');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', t('start.focus.part', { n: Math.round(part * 100) }));
  const R = 18; const C = 2 * Math.PI * R;
  for (const [stroke, dash] of [['var(--line)', ''], ['var(--light)', `${(part * C).toFixed(1)} ${C.toFixed(1)}`]]) {
    const c = document.createElementNS(NS, 'circle');
    for (const [k, v] of Object.entries({ cx: 22, cy: 22, r: R, fill: 'none', stroke, 'stroke-width': 3.5, 'stroke-linecap': 'round', transform: 'rotate(-90 22 22)' })) c.setAttribute(k, v);
    if (dash) c.setAttribute('stroke-dasharray', dash);
    svg.append(c);
  }
  const label = document.createElementNS(NS, 'text');
  for (const [k, v] of Object.entries({ x: 22, y: 26, 'text-anchor': 'middle', fill: 'currentColor', 'font-size': 10.5, 'font-weight': 600 })) label.setAttribute(k, v);
  label.textContent = `${Math.round(part * 100)} %`;
  svg.append(label);
  return svg;
}
const partOf = (p) => { const all = (p.steps || []).length; return all ? (p.steps || []).filter((x) => x.done).length / all : 0; };
const daysLeft = (p) => (p.due ? Math.ceil((new Date(`${p.due}T23:59:59`).getTime() - Date.now()) / 86400000) : null);

function projectStructure(p, ctx) {
  const { path } = ctx;
  const lang = getLang();
  const aside = h('aside', { class: 'lp-struct', 'aria-label': t('lp.structure', { title: p.title }) });
  const draw = () => {
    const secs = boardOf(p, projectNodes(p.links));
    const d = diveOf(path);
    const left = daysLeft(p);
    const kids = (pid) => secs.filter((x) => (x.parent || '') === pid);
    const total = (x) => x.items.length + kids(x.id).reduce((n, c) => n + total(c), 0);
    const list = h('ol', { class: 'lp-secs' });
    const row = (s, depth) => {
      const li = h('li', { class: `lp-sec${d.from === s.id && d.trail.length ? ' here' : ''}`, style: `--d:${depth}` });
      li.style.setProperty('--sec', colourVar(s.color));
      const b = h('button', { type: 'button', class: 'lp-sec-btn', onclick: () => {
        keepView(p.slug, 'board');
        ctx.showView?.('board');
        requestAnimationFrame(() => document.getElementById(`station-${s.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
      } }, h('span', { class: 'board-dot' }), h('span', { class: 'lp-sec-t', text: sectionTitle(s) }), h('span', { class: 'lp-sec-n', text: String(total(s)) }));
      li.append(b);
      if (d.from === s.id && d.trail.length) {
        li.append(h('div', { class: 'lp-sub-trail' }, d.trail.map((x, i) => {
          const n = nodeByPath(x);
          return h('span', { class: i === d.trail.length - 1 ? 'on' : '', style: `--i:${i}`, text: `↘ ${n ? nodeTitle(n, lang) : x}` });
        })));
      }
      list.append(li);
      for (const c of kids(s.id)) row(c, depth + 1);
    };
    for (const s of kids('')) row(s, 0);
    aside.replaceChildren(
      h('span', { class: 'lp-kicker', text: t('lp.project') }),
      h('div', { class: 'lp-struct-head' }, ringSvg(partOf(p), 40), h('div', {}, h('b', { class: 'lp-struct-title', text: p.title }),
        h('span', { class: 'muted small', text: [`${Math.round(partOf(p) * 100)} %`, left != null ? t(left >= 0 ? 'lp.daysLeft' : 'lp.overdue', { n: Math.abs(left) }) : ''].filter(Boolean).join(' · ') }))),
      list,
      h('p', { class: 'lp-struct-foot muted small', text: t('lp.structure.hint') }));
  };
  draw();
  const off = onDiveChange((pp) => { if (!aside.isConnected) { off(); return; } if (pp === path) draw(); });
  return aside;
}

// Right: the project with its ring and next step ("Weiter" starts a quarter of an hour on its clock), the steps with
// their lights, the conversation with Loom for this project ("Laut gedacht"), and the other projects.
function projectSide(p, ctx) {
  const { path, go } = ctx;
  const next = nextUp(p.steps || []);
  const left = daysLeft(p);
  const card = h('section', { class: 'lp-card' },
    h('div', { class: 'lp-card-head' }, ringSvg(partOf(p), 52), h('div', {}, h('h2', { text: p.title }), h('p', { class: 'muted small', text: [p.goal, left != null ? t(left >= 0 ? 'lp.daysLeft' : 'lp.overdue', { n: Math.abs(left) }) : ''].filter(Boolean).join(' · ') }))));
  if (next) {
    const goOn = h('button', { type: 'button', class: 'btn primary lp-go' }, iconEl('play'), h('span', { text: t('lp.go', { min: 15 }) }));
    goOn.addEventListener('click', () => {
      if (!loadPref('timer', null)) savePref('timer', { path, start: Date.now(), minutes: 15 });
      toast(t('lp.go.started', { step: next.text }), 'ok', 4000);
    });
    card.append(h('div', { class: 'lp-next' }, h('span', { class: 'lp-next-k', text: t('lp.next') }), h('p', { class: 'lp-next-t', text: next.text }), goOn));
  }
  card.append(stepsEditor(p, ctx));
  const others = projects().filter((x) => x.path !== path && x.state !== 'done').slice(0, 3);
  const more = others.length ? h('div', { class: 'lp-others' }, others.map((x) => {
    const a = h('a', { class: 'lp-other', href: nodeHref(x.path) }, h('span', { class: 'project-dot', 'aria-hidden': 'true' }), h('b', { text: x.title }), h('span', { class: 'muted small', text: x.steps?.next || t(`project.state.${x.state}`) }));
    paintProject(a, x.slug);
    return a;
  })) : null;
  return h('aside', { class: 'lp-side' }, card, talkPanel({ go, project: path, embedded: true }), more);
}
