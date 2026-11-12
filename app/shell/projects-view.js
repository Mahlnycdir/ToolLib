// Projects (0.15.0): the list of your projects, the view of one project and the view of a note.
// A project shows the way its knowledge takes: collect (works, research folders), keep (cards, notes) and apply
// (snippets, recipes, pages you write). Each station opens the tool that fills it, and whatever you create there
// while the project is in focus comes back into the project.
import { h, toast, confirmDialog, promptDialog, actionSheet, debounce, loadPref, savePref } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { ACCENTS } from './modules.js';
import { allNodes, indexState, nodeByPath, onIndexChange, searchNodes } from '../services/search.js';
import {
  STATES, addStep, addToProject, deleteProject, focusPath, loadProject, projectNodes, projects, projectsWith, removeFromProject, removeStep,
  saveProjectNotes, setFocus, setProjectField, toggleStep, touchProject,
} from '../services/projects.js';
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

// ------------------------------------------------------------------ the three stations
export const STATIONS = ['collect', 'keep', 'apply'];
const STATION = {
  clip: 'collect', research: 'collect',
  formula: 'keep', definition: 'keep', theorem: 'keep', term: 'keep', convention: 'keep', topic: 'keep', note: 'keep', rule: 'keep', part: 'keep', device: 'keep',
  page: 'keep', library: 'keep',   // what you write in the project (0.16.0)
  snippet: 'apply', recipe: 'apply', pin_map: 'apply', tool: 'apply',
};
export const stationOf = (type) => STATION[type] || 'keep';
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

// The track: three stations joined by a line. onStation(id) is what a tap does.
export function track(d, { onStation } = {}) {
  const counts = stationCounts(d);
  const el = h('div', { class: 'track', role: 'group', 'aria-label': t('project.track') });
  STATIONS.forEach((id, i) => {
    if (i) el.append(h('span', { class: 'track-line', 'aria-hidden': 'true' }));
    el.append(h('button', { type: 'button', class: `track-stop${counts[id] ? '' : ' empty'}`, dataset: { station: id }, onclick: () => onStation?.(id) },
      iconEl(STATION_ICON[id]), h('span', { class: 'track-name', text: t(`station.${id}`) }), h('span', { class: 'track-n', text: String(counts[id]) })));
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
  const redraw = async () => {
    if (!isCurrent()) return;
    const top = main.scrollTop;
    main.replaceChildren();
    await renderProject(main, path, ctx);
    main.scrollTop = top;
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

  // the way of the knowledge: three stations; a tap goes to its section
  const sections = {};
  box.append(track(d, { onStation: (id) => sections[id]?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }));

  // next steps
  const steps = h('ul', { class: 'steps-list' });
  p.steps.forEach((s, i) => {
    const boxEl = h('input', { type: 'checkbox', checked: s.done ? true : null, 'aria-label': s.text });
    boxEl.addEventListener('change', async () => { await toggleStep(path, i); redraw(); });
    const del = h('button', { type: 'button', class: 'icon-btn small step-del', 'aria-label': `${t('action.remove')}: ${s.text}`, title: t('action.remove'), html: icon('close') });
    del.addEventListener('click', async () => { await removeStep(path, i); redraw(); });
    steps.append(h('li', { class: s.done ? 'done' : '' }, h('label', {}, boxEl, h('span', { text: s.text })), del));
  });
  const stepIn = h('input', { class: 'field step-input', type: 'text', placeholder: t('project.step.add'), 'aria-label': t('project.step.add'), enterkeyhint: 'done' });
  stepIn.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !stepIn.value.trim()) return;
    e.preventDefault();
    await addStep(path, stepIn.value);
    refocus = 'step';
    redraw();
  });
  box.append(h('section', { class: 'project-steps' }, h('h2', { text: t('project.steps') }), steps, stepIn));

  // catch a thought for this project
  const quick = h('input', { class: 'field quick-note', type: 'text', placeholder: t('project.quick'), 'aria-label': t('project.quick'), enterkeyhint: 'done' });
  quick.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !quick.value.trim()) return;
    e.preventDefault();
    try { await capture(quick.value, { project: path }); toast(t('note.kept'), 'ok'); refocus = 'quick'; redraw(); } catch { toast(t('create.failed'), 'error', 5000); }
  });

  // what belongs to it, by station
  const members = projectNodes(p.links);
  const lang = getLang();
  const row = (n) => {
    const rm = h('button', { type: 'button', class: 'icon-btn small member-rm', title: t('project.takeOut'), 'aria-label': `${t('project.takeOut')}: ${nodeTitle(n, lang)}`, html: icon('close') });
    rm.addEventListener('click', async () => { await removeFromProject(path, n.slug); redraw(); });
    // a folder from before 0.16.0: one tap moves its works and notes into the project, the folder goes
    if (n.type === 'research' && !n.crawl && !n.pdfInbox) {
      const take = h('button', { type: 'button', class: 'btn small member-dissolve', title: t('project.dissolve.hint') }, iconEl('check'), h('span', { text: t('project.dissolve') }));
      take.addEventListener('click', async () => {
        take.disabled = true;
        try { await dissolveFolder(n.path, path); toast(t('research.adopted', { project: p.title }), 'ok'); } catch (e) { console.warn(e); toast(t('create.failed'), 'error', 5000); }
        redraw();
      });
      return h('li', { class: 'member member-old' }, h('a', { class: 'member-main', href: nodeHref(n.path) }, typeTile(n.type, 'small'),
        h('span', { class: 'member-text' }, h('span', { class: 'member-title', text: nodeTitle(n, lang) }), h('span', { class: 'muted small member-lead', text: t('project.oldFolder', { n: n.clips.length }) }))), take);
    }
    return h('li', { class: 'member' }, h('a', { class: 'member-main', href: nodeHref(n.path) }, typeTile(n.type, 'small'),
      h('span', { class: 'member-text' }, h('span', { class: 'member-title', text: nodeTitle(n, lang) }), h('span', { class: 'muted small member-lead', text: n.type === 'research' ? t('research.kept', { n: n.clips.length }) : n.type === 'note' ? `${typeLabel('note')}${n.at ? `, ${new Date(n.at).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB')}` : ''}` : nodeLead(n, lang) || typeLabel(n.type) }))), rm);
  };
  const act = (key, iconName, fn) => h('button', { type: 'button', class: 'btn small', onclick: fn }, iconEl(iconName), h('span', { text: t(key) }));
  // while this project is not in focus, what its buttons create still lands here
  const here = async (fn) => {
    const before = focusPath();
    if (before !== path) setFocus(path);
    return fn();
  };
  const ACTIONS = {
    collect: [act('project.do.search', 'search', () => here(() => { queueSearch(p.title); go('#/m/scraper'); })), act('create.crawl', 'globe', () => here(() => newCrawl({ go })))],
    keep: [act('project.write', 'file', () => openWriting(path, { go })), act('create.card', 'vars', () => here(() => newCard({ go }))), act('create.note', 'edit', async () => { if (await newNote({ project: path })) redraw(); })],
    apply: [act('create.snippet', 'code', () => here(() => newSnippet({ go })))],
  };
  // the pages you write in the project (0.16.0): they sit in its library, shown here by chapter
  const lib = members.find((n) => n.type === 'library');
  const pagesBox = h('div', { class: 'project-pages' });
  if (lib) {
    loadLibrary(lib.path).then((l) => {
      const chapters = l.chapters.filter((c) => c.pages.length);
      if (!chapters.length) { pagesBox.replaceChildren(h('p', { class: 'muted small', text: t('project.pages.empty') })); return; }
      pagesBox.replaceChildren(...chapters.map((c) => h('div', { class: 'project-chapter' },
        h('span', { class: 'muted small project-chapter-title', text: c.title }),
        h('ul', { class: 'members' }, c.pages.map((slug) => {
          const d = allNodes().find((x) => x.slug === slug && x.type === 'page');
          return d ? h('li', { class: 'member' }, h('button', { type: 'button', class: 'member-main project-page', onclick: () => openWriting(path, { page: d.path, go }) }, typeTile('page', 'small'),
            h('span', { class: 'member-text' }, h('span', { class: 'member-title', text: nodeTitle(d, lang) }), h('span', { class: 'muted small member-lead', text: nodeLead(d, lang) || t('project.page') })))) : null;
        }).filter(Boolean)))));
    }).catch(() => {});
  }
  for (const id of STATIONS) {
    const items = members.filter((n) => stationOf(n.type) === id && n.type !== 'library');
    const sec = h('section', { class: `station station-${id}`, id: `station-${id}` },
      h('h2', {}, iconEl(STATION_ICON[id]), h('span', { text: t(`station.${id}`) }), h('span', { class: 'count', text: String(items.length + (id === 'keep' && lib ? 1 : 0)) })),
      h('p', { class: 'muted small station-what', text: t(`station.${id}.what`) }),
      id === 'keep' ? quick : null,
      id === 'keep' && lib ? pagesBox : null,
      items.length ? h('ul', { class: 'members' }, items.map(row)) : null,
      h('div', { class: 'btn-row' }, ACTIONS[id]));
    sections[id] = sec;
    box.append(sec);
  }

  // what your knowledge already has on it: one tap adds it
  const sugIn = h('input', { class: 'field', type: 'search', placeholder: t('project.fromKnowledge'), 'aria-label': t('project.fromKnowledge'), autocapitalize: 'off', spellcheck: 'false' });
  const sugList = h('ul', { class: 'members suggestions' });
  const has = new Set(p.links);
  const drawSug = () => {
    const query = sugIn.value.trim() || `${p.title} ${p.goal}`.trim();
    const hits = searchNodes(query, { limit: 8, filter: (n) => n && !n.conflict && n.type !== 'project' && !has.has(n.slug) && !(n.type === 'clip' && n.run) && n.path !== path });
    sugList.replaceChildren(...hits.map((n) => {
      const add = h('button', { type: 'button', class: 'btn small member-add', 'aria-label': `${t('project.add')}: ${nodeTitle(n, lang)}` }, iconEl('plus'), h('span', { text: t('project.add') }));
      add.addEventListener('click', async () => { await addToProject(path, [n.slug]); redraw(); });
      return h('li', { class: 'member' }, h('a', { class: 'member-main', href: nodeHref(n.path) }, typeTile(n.type, 'small'),
        h('span', { class: 'member-text' }, h('span', { class: 'member-title', text: nodeTitle(n, lang) }), h('span', { class: 'muted small member-lead', text: typeLabel(n.type) }))), add);
    }));
    if (!hits.length) sugList.append(h('li', { class: 'muted small', text: t(sugIn.value.trim() ? 'project.fromKnowledge.none' : 'project.fromKnowledge.empty') }));
  };
  sugIn.addEventListener('input', debounce(drawSug, 150));
  drawSug();
  box.append(h('section', { class: 'project-suggest' }, h('h2', { text: t('project.fits') }), sugIn, sugList));

  // free notes of the project
  const notes = h('textarea', { class: 'field project-notes', rows: '6', placeholder: t('project.notesHint'), 'aria-label': t('project.notes') });
  notes.value = p.notes;
  const saved = h('span', { class: 'muted small' });
  const save = async () => { try { if (await saveProjectNotes(path, notes.value)) saved.textContent = t('research.saved'); } catch { saved.textContent = t('research.saveFailed'); } };
  const later = debounce(save, 1200);
  notes.addEventListener('input', () => { saved.textContent = ''; later(); });
  notes.addEventListener('blur', () => { later.cancel(); save(); });
  box.append(h('section', { class: 'project-notes-box' }, h('h2', { text: t('project.notes') }), notes, saved));

  // a station tapped on a card elsewhere: go to its section; after adding a step or a note the field keeps the focus
  const want = loadPref('project.station', null);
  if (want && want.path === path && Date.now() - want.at < 4000 && sections[want.id]) {
    savePref('project.station', null);
    requestAnimationFrame(() => sections[want.id].scrollIntoView({ block: 'start' }));
  }
  if (refocus) { (refocus === 'step' ? stepIn : quick).focus({ preventScroll: true }); refocus = ''; }
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
