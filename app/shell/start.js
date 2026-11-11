// Start (0.15.0): one place to begin. A question and the ways to answer it, the project in focus with its next
// step, where you left off, and what waits in the inbox. Numbers about the knowledge and the sync moved to the
// bottom line and the settings.
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
import { CREATORS } from './create.js';
import { nodeHref, nodeTitle, typeLabel, typeTile } from './node-view.js';
import { projectCard, paintProject } from './projects-view.js';
import { conflictActions } from './conflict-actions.js';
import { formatTime, syncButton } from './views.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const originalOf = (copy) => copy.replace(/\.conflict-[a-z0-9-]+(\.[^./]+)?$/, '$1');

function greeting() {
  const hr = new Date().getHours();
  return t(hr < 5 ? 'start.night' : hr < 11 ? 'start.morning' : hr < 18 ? 'start.day' : 'start.evening');
}

export function renderStart(main, { go, onSync, onSetup, focusCommand }) {
  main.dataset.view = 'start';
  const lang = getLang();
  const ready = indexState().ready;

  // ---------------------------------------------------------------- the question and the ways to answer it
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

  // ---------------------------------------------------------------- the project in focus
  const focus = focusProject();
  const all = ready ? projects() : [];
  if (focus) {
    main.append(h('section', { class: 'start-focus' }, h('h2', { class: 'start-h' }, iconEl('target'), h('span', { text: t('start.focus') })), projectCard(focus, { go, big: true })));
  } else if (ready && indexState().hasKnowledge) {
    main.append(h('section', { class: 'start-focus none' }, h('h2', { class: 'start-h' }, iconEl('target'), h('span', { text: t('start.focus') })),
      h('div', { class: 'empty-invite' }, h('p', { text: t(all.length ? 'start.focus.pick' : 'project.none') }),
        h('p', { class: 'muted small', text: t(all.length ? 'project.focusHint' : 'project.none.hint') }),
        all.length ? null : h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn primary', onclick: () => CREATORS.find((c) => c.id === 'project').run({ go }) }, iconEl('plus'), h('span', { text: t('create.project') }))))));
  }

  // ---------------------------------------------------------------- go on, and the inbox
  const cols = h('div', { class: 'start-cols' });
  main.append(cols);

  const resume = h('section', { class: 'start-resume' }, h('h2', { class: 'start-h' }, iconEl('history'), h('span', { text: t('start.resume') })));
  const items = [];
  const draft = loadPref('snippet.draft', null);
  if (draft && (draft.code || draft.title)) items.push({ icon: 'code', accent: 'cheatsheet', verb: t('start.resume.draft'), title: draft.title || draft.fromTitle || t('cmd.newSnippet'), run: () => go('#/new') });
  for (const e of trail()) {
    const d = nodeByPath(e.path);
    if (ready && !d) continue;
    const title = d ? nodeTitle(d, lang) : e.title;
    if (e.kind === 'read') items.push({ type: 'clip', verb: t('start.resume.read'), title, run: () => { savePref('research.read', e.path); go('#/m/scraper'); } });
    else if (e.kind === 'write') items.push({ type: 'page', verb: t('start.resume.write'), title, run: () => { savePref('library.open', { path: e.lib, page: e.path, at: Date.now() }); go('#/m/scraper'); } });
    else if (d?.type !== 'project' || d.path !== focus?.path) items.push({ type: d?.type || 'note', verb: d ? typeLabel(d.type) : '', title, run: () => go(nodeHref(e.path)) });
    if (items.length >= 5) break;
  }
  if (items.length) {
    resume.append(h('ul', { class: 'resume-list' }, items.map((it) => {
      const tile = it.type ? typeTile(it.type, 'small') : iconEl(it.icon, 'tile small');
      if (it.accent) paintAccent(tile, it.accent);
      return h('li', {}, h('button', { type: 'button', class: 'resume-item', onclick: it.run }, tile,
        h('span', { class: 'resume-text' }, h('span', { class: 'resume-verb muted small', text: it.verb }), h('span', { class: 'resume-title', text: it.title }))));
    })));
  } else resume.append(h('p', { class: 'muted small', text: t('start.resume.none') }));
  cols.append(resume);

  const box = h('section', { class: 'start-inbox' });
  const drawInbox = () => {
    const notes = ready ? inbox() : [];
    const quick = h('input', { class: 'field quick-note', type: 'text', placeholder: t('start.inbox.quick'), 'aria-label': t('start.inbox.quick'), enterkeyhint: 'done' });
    quick.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !quick.value.trim()) return;
      e.preventDefault();
      try { await capture(quick.value, { inbox: true }); drawInbox(); box.querySelector('.quick-note')?.focus(); } catch { toast(t('create.failed'), 'error', 5000); }
    });
    box.replaceChildren(...[h('h2', { class: 'start-h' }, iconEl('inbox'), h('span', { text: t('start.inbox') }), notes.length ? h('span', { class: 'count', text: String(notes.length) }) : null), quick,
      notes.length ? h('ul', { class: 'inbox-list' }, notes.slice(0, 5).map((n) => h('li', {}, h('a', { class: 'inbox-item', href: nodeHref(n.path) }, h('span', { class: 'inbox-title', text: nodeTitle(n, lang) }),
        h('span', { class: 'muted small', text: n.at ? formatTime(new Date(n.at).getTime()) : '' })))))
        : h('p', { class: 'muted small', text: t('start.inbox.none') }),
      notes.length > 5 ? h('p', { class: 'muted small', text: t('start.inbox.more', { n: notes.length - 5 }) }) : null].filter(Boolean));
  };
  drawInbox();
  cols.append(box);

  // ---------------------------------------------------------------- your other projects
  const others = all.filter((p) => p.path !== focus?.path && p.state !== 'done');
  if (others.length) {
    main.append(h('section', { class: 'start-projects' }, h('h2', { class: 'start-h' }, h('span', { text: t(focus ? 'start.others' : 'module.projects.name') }), h('a', { class: 'small start-all', href: '#/m/projects', text: t('start.all') })),
      h('div', { class: 'project-chips' }, others.slice(0, 8).map((p) => {
        const a = h('a', { class: 'project-chip', href: nodeHref(p.path) }, h('span', { class: 'project-dot', 'aria-hidden': 'true' }), h('span', { class: 'project-chip-title', text: p.title }),
          p.steps?.next ? h('span', { class: 'muted small project-chip-next', text: p.steps.next }) : null);
        paintProject(a, p.slug);
        return a;
      }))));
  }

  // ---------------------------------------------------------------- your tools
  const tools = h('div', { class: 'tool-row' });
  for (const m of READY) {
    const tile = iconEl(m.icon, 'tile');
    paintAccent(tile, m.id);
    tools.append(h('a', { class: 'tool', href: m.href || `#/m/${m.id}`, dataset: { id: m.id } }, tile, h('span', { class: 'tool-text' }, h('span', { class: 'tool-name', text: t(`module.${m.id}.name`) }), h('span', { class: 'muted small', text: t(`module.${m.id}.desc`) }))));
  }
  main.append(h('section', { class: 'start-tools' }, h('h2', { class: 'start-h' }, h('span', { text: t('start.tools') })), tools,
    PLANNED.length ? h('p', { class: 'muted small start-planned', text: t('start.planned', { list: PLANNED.map((m) => t(`module.${m.id}.name`)).join(', ') }) }) : null));

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
