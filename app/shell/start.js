// Start (0.15.0; a board of your own since 0.28.0). At the top, fixed: the question and the ways to answer it
// (search, and everything you can create). Below: your widgets, which you choose, order, make wide and take away,
// kept in start.md in your knowledge (start-store.js), so the Mac and the iPhone show the same:
//   pult      the control panel: up to four projects, the one in focus open (pult.js)
//   resume    where you left off
//   inbox     quick notes and what waits in the inbox
//   projects  your other projects
//   tools     your tools
//   and building blocks you put together (a list from a search, a note, a checklist, links, a piece of the network,
//   a countdown; widget-blocks.js).
// At the bottom: the knowledge, the sync, installing.
//
// For Python readers: renderStart draws the fixed parts at once and the board from the last start it read (cache),
// then reads start.md again and draws the board anew if something changed; every change to the board writes the file
// and draws again (start-store.js onStartChange).
import { h, toast, savePref, loadPref } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { PLANNED, READY, paintAccent } from './modules.js';
import { indexState, nodeByPath } from '../services/search.js';
import { isConfigured, knowledgeStats, syncState } from '../services/sync.js';
import { isStandalone, platform } from '../services/pwa.js';
import { focusProject, projects } from '../services/projects.js';
import { capture, inbox } from '../services/notes.js';
import { trail } from '../services/trail.js';
import { newBlockId } from '../services/widget-store.js';
import {
  START_WIDGETS, addStartBlock, cachedStart, loadStart, onStartChange, removeStartWidget, saveStartBlock, saveStartContent, setPult, setStartWide, setStartWidgets,
} from '../services/start-store.js';
import { CREATORS } from './create.js';
import { nodeHref, nodeTitle, typeLabel, typeTile } from './node-view.js';
import { paintProject } from './projects-view.js';
import { conflictActions } from './conflict-actions.js';
import { formatTime, syncButton } from './views.js';
import { widgetGrid } from './widget-frame.js';
import { BLOCK_ICON, blockBody, blockChoices, blockHasContent, blockTitle, editBlock } from './widget-blocks.js';
import { pultProjects, pultWidget } from './pult.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const originalOf = (copy) => copy.replace(/\.conflict-[a-z0-9-]+(\.[^./]+)?$/, '$1');
const ICON = { pult: 'target', resume: 'history', inbox: 'inbox', projects: 'folder', tools: 'blocks' };

function greeting() {
  const hr = new Date().getHours();
  return t(hr < 5 ? 'start.night' : hr < 11 ? 'start.morning' : hr < 18 ? 'start.day' : 'start.evening');
}

export function renderStart(main, { go, onSync, onSetup, focusCommand }) {
  main.dataset.view = 'start';
  const ready = indexState().ready;

  // ---------------------------------------------------------------- the question and the ways to answer it (fixed)
  const verbs = h('div', { class: 'verbs', role: 'group', 'aria-label': t('create.title') });
  verbs.append(h('button', { type: 'button', class: 'verb verb-search', onclick: focusCommand }, iconEl('search'), h('span', { text: t('start.search') })));
  for (const c of CREATORS.filter((x) => x.start !== false)) {
    const b = h('button', { type: 'button', class: 'verb', dataset: { id: c.id }, title: t(`create.${c.id}.hint`), onclick: () => c.run({ go }) }, iconEl(c.icon), h('span', { text: t(`create.${c.id}`) }));
    paintAccent(b, c.accent);
    verbs.append(b);
  }
  main.append(h('header', { class: 'start-head' }, h('p', { class: 'start-hello muted', text: greeting() }), h('h1', { class: 'start-ask', text: t('start.ask') }), verbs));

  if (!isConfigured() || indexState().hasKnowledge === false) {
    main.append(h('section', { class: 'card start-setup' }, h('h2', { text: t('home.knowledge.title') }),
      h('p', { class: 'muted', text: t(isConfigured() ? 'home.knowledge.first' : 'home.knowledge.setup') }),
      isConfigured() ? syncButton(onSync) : h('button', { type: 'button', class: 'btn primary', onclick: onSetup }, iconEl('settings'), h('span', { text: t('action.setup') }))));
  }

  // ---------------------------------------------------------------- your board
  const board = h('div', { class: 'start-board' });
  main.append(board);
  let shown = '';
  const draw = (s) => {
    const key = JSON.stringify([s.widgets, s.wide, s.pult, [...s.blocks].map(([id, b]) => [id, b])]);
    if (key === shown && board.firstChild) return;
    shown = key;
    board.replaceChildren(startGrid(s, { go, ready }));
  };
  if (cachedStart()) draw(cachedStart());
  loadStart().then((s) => { if (board.isConnected) draw(s); });
  const stop = onStartChange(() => {
    if (!board.isConnected) { stop(); return; }
    // while you type in a widget the board waits, so the field keeps its text and its focus
    if (board.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
    draw(cachedStart());
  });

  // ---------------------------------------------------------------- the bottom line: knowledge, sync, install
  const foot = h('footer', { class: 'start-foot muted small' });
  main.append(foot);
  (async () => {
    if (!isConfigured()) return;
    let stats = null;
    try { stats = await knowledgeStats(); } catch { /* nothing on this device yet */ }
    if (!foot.isConnected || !stats) return;
    const s = syncState();
    foot.append(...[h('span', { class: 'know-count', text: t('home.knowledge.count', { count: stats.total }) }),
      s.last?.time ? h('span', { text: t('status.sync.last', { time: formatTime(s.last.time) }) }) : null,
      s.error ? h('span', { class: 'error-text', text: s.error }) : null,
      !isStandalone() ? h('span', { text: t({ ios: 'home.install.ios', mac: 'home.install.mac' }[platform()] || 'home.install.other') }) : null].filter(Boolean));
    const sync = syncButton(onSync, { primary: false });
    sync.classList.add('small', 'start-sync');
    foot.append(sync);
    if (stats.conflicts.length) {
      const list = h('ul', { class: 'conflicts' });
      const note = h('div', { class: 'note warn' });
      for (const copy of stats.conflicts) {
        const li = h('li', {}, h('a', { href: nodeHref(copy), text: copy }), ' ', h('span', { class: 'muted small', text: t('home.knowledge.conflictOf', { path: originalOf(copy) }) }),
          conflictActions(copy, () => { li.remove(); if (!list.children.length) note.remove(); }));
        list.append(li);
      }
      note.append(iconEl('warn'), h('div', {}, h('p', { text: t('home.knowledge.conflicts', { count: stats.conflicts.length }) }), list));
      foot.before(note);
    }
  })();
}

// The widgets of Start in the shared frame.
function startGrid(s, { go, ready }) {
  return widgetGrid({
    scope: 'start',
    list: s.widgets,
    wide: s.wide,
    render: (id) => {
      const block = s.blocks.get(id);
      if (block) {
        const body = blockBody(block, { go, focus: focusProject(), saveContent: (text) => saveStartContent(id, text) });
        return body && { kind: `block-${block.kind}`, title: blockTitle(block), icon: BLOCK_ICON[block.kind], body, editable: true, hasContent: blockHasContent(block) };
      }
      const body = OWN[id]?.({ go, ready, s });
      return body && { kind: id === 'pult' ? 'pult' : `start-${id}`, title: t(`start.widget.${id}`), icon: ICON[id], body };
    },
    save: async ({ list, wide }) => {
      if (list.join() !== s.widgets.join()) await setStartWidgets(list);
      if (wide.join() !== s.wide.join()) await setStartWide(wide);
    },
    remove: (id) => removeStartWidget(id),
    edit: async (id) => { const cfg = await editBlock(s.blocks.get(id)); if (cfg) await saveStartBlock(id, cfg); },
    choices: () => {
      const own = START_WIDGETS.filter((w) => !s.widgets.includes(w)).map((w) => ({ label: t(`start.widget.${w}`), value: w, icon: ICON[w], detail: t(`start.widget.${w}.hint`) }));
      return [...own, ...(own.length ? ['-'] : []), ...blockChoices()];
    },
    add: async (value) => {
      if (!value.startsWith('block:')) { await setStartWidgets([...s.widgets, value]); return; }
      const cfg = await editBlock({ kind: value.slice(6), title: '' });
      if (cfg) await addStartBlock(newBlockId(), cfg);
    },
  });
}

// ------------------------------------------------------------------ the widgets Start brings
const OWN = {
  // the control panel
  pult: ({ go, s }) => pultWidget({ go, pult: s.pult, savePult: setPult }),

  // where you left off: a snippet draft, a work you read, a page you wrote, a node you opened
  resume({ go, ready }) {
    const lang = getLang();
    const focus = focusProject();
    const items = [];
    const draft = loadPref('snippet.draft', null);
    if (draft && (draft.code || draft.title)) items.push({ icon: 'code', accent: 'cheatsheet', verb: t('start.resume.draft'), title: draft.title || draft.fromTitle || t('cmd.newSnippet'), run: () => go('#/new') });
    for (const e of trail()) {
      const d = nodeByPath(e.path);
      if (ready && !d) continue;
      const title = d ? nodeTitle(d, lang) : e.title;
      if (e.kind === 'read') items.push({ type: 'clip', verb: t('start.resume.read'), title, run: () => { savePref('research.read', e.path); go('#/m/scraper'); } });
      else if (e.kind === 'write') items.push({ type: 'page', verb: t('start.resume.write'), title, run: () => { savePref('library.open', { path: e.lib, page: e.path, at: Date.now() }); go('#/m/library'); } });
      else if (d?.type !== 'project' || d.path !== focus?.path) items.push({ type: d?.type || 'note', verb: d ? typeLabel(d.type) : '', title, run: () => go(nodeHref(e.path)) });
      if (items.length >= 5) break;
    }
    // 0.29.0: everything you read and write stands in the library
    const shelf = h('a', { class: 'small resume-shelf', href: '#/m/shelf' }, iconEl('shelf'), h('span', { text: t('start.resume.shelf') }));
    if (!items.length) return h('div', { class: 'start-resume' }, h('p', { class: 'muted small', text: t('start.resume.none') }), shelf);
    return h('div', { class: 'start-resume' }, h('ul', { class: 'resume-list' }, items.map((it) => {
      const tile = it.type ? typeTile(it.type, 'small') : iconEl(it.icon, 'tile small');
      if (it.accent) paintAccent(tile, it.accent);
      return h('li', {}, h('button', { type: 'button', class: 'resume-item', onclick: it.run }, tile,
        h('span', { class: 'resume-text' }, h('span', { class: 'resume-verb muted small', text: it.verb }), h('span', { class: 'resume-title', text: it.title }))));
    })), shelf);
  },

  // a quick note, and what waits in the inbox
  inbox({ ready }) {
    const lang = getLang();
    const box = h('div', { class: 'start-inbox' });
    const draw = () => {
      const notes = ready ? inbox() : [];
      const quick = h('input', { class: 'field quick-note', type: 'text', placeholder: t('start.inbox.quick'), 'aria-label': t('start.inbox.quick'), enterkeyhint: 'done' });
      quick.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter' || !quick.value.trim()) return;
        e.preventDefault();
        try { await capture(quick.value, { inbox: true }); draw(); box.querySelector('.quick-note')?.focus(); } catch { toast(t('create.failed'), 'error', 5000); }
      });
      box.replaceChildren(...[quick,
        notes.length ? h('p', { class: 'muted small inbox-count', text: t('start.inbox.count', { n: notes.length }) }) : null,
        notes.length ? h('ul', { class: 'inbox-list' }, notes.slice(0, 5).map((n) => h('li', {}, h('a', { class: 'inbox-item', href: nodeHref(n.path) }, h('span', { class: 'inbox-title', text: nodeTitle(n, lang) }),
          h('span', { class: 'muted small', text: n.at ? formatTime(new Date(n.at).getTime()) : '' })))))
          : h('p', { class: 'muted small', text: t('start.inbox.none') }),
        notes.length > 5 ? h('p', { class: 'muted small', text: t('start.inbox.more', { n: notes.length - 5 }) }) : null].filter(Boolean));
    };
    draw();
    return box;
  },

  // your other projects (the ones not in the control panel)
  projects({ s }) {
    const inPult = new Set(pultProjects(s.pult).map((p) => p.path));
    const rest = projects().filter((p) => !inPult.has(p.path) && p.state !== 'done');
    return h('div', { class: 'start-projects' },
      rest.length ? h('div', { class: 'project-chips' }, rest.slice(0, 10).map((p) => {
        const a = h('a', { class: 'project-chip', href: nodeHref(p.path) }, h('span', { class: 'project-dot', 'aria-hidden': 'true' }), h('span', { class: 'project-chip-title', text: p.title }),
          p.steps?.next ? h('span', { class: 'muted small project-chip-next', text: p.steps.next }) : null);
        paintProject(a, p.slug);
        return a;
      })) : h('p', { class: 'muted small', text: t('start.projects.none') }),
      h('a', { class: 'small start-all', href: '#/m/projects', text: t('start.all') }));
  },

  // your tools
  tools() {
    const row = h('div', { class: 'tool-row' });
    for (const m of READY) {
      const tile = iconEl(m.icon, 'tile');
      paintAccent(tile, m.id);
      row.append(h('a', { class: 'tool', href: m.href || `#/m/${m.id}`, dataset: { id: m.id } }, tile, h('span', { class: 'tool-text' }, h('span', { class: 'tool-name', text: t(`module.${m.id}.name`) }), h('span', { class: 'muted small', text: t(`module.${m.id}.desc`) }))));
    }
    return h('div', { class: 'start-tools' }, row, PLANNED.length ? h('p', { class: 'muted small start-planned', text: t('start.planned', { list: PLANNED.map((m) => t(`module.${m.id}.name`)).join(', ') }) }) : null);
  },
};
