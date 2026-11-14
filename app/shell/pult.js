// The control panel on Start (0.28.0). ENTE: "like a small control panel for the project in focus … I work on 3–4
// projects at the same time and need more structure for that." Up to four projects of your choice:
//   the one in focus is open: its next step with "Done" and "Handed in", all steps with their lights, where you
//   stand in its red thread, what you did last in it (a page, a work, a card), the focus timer and its date;
//   the others take one line each: their light, their next step, how many wait, how far they are, the days left.
// When a step turns green or yellow, the panel says what to go on with: the next step here, or the red step of
// another project in the panel (one tap puts that one in focus).
//
//   pultWidget({ go, pult, savePult })   pult: the paths kept in start.md (null: not chosen yet), savePult(paths)
//
// For Python readers: the open project is read from its file (loadProject); the others come from the index
// (their summaries carry their steps), so the panel stays quick with several projects.
import { h, toast, actionSheet, savePref } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { nodeByPath, nodeBySlug, onNodesChange } from '../services/search.js';
import { focusPath, loadProject, nextUp, projectLibrary, projectWorks, projects, setFocus, setStepStatus } from '../services/projects.js';
import { PULT_MAX } from '../services/start-store.js';
import { trail } from '../services/trail.js';
import { nodeHref, nodeTitle, typeTile } from './node-view.js';
import { paintProject } from './projects-view.js';
import { stepsEditor, light, lightButton } from './steps-ui.js';
import { projectWidgetBody } from './project-board.js';
import { openWriting } from './library-home.js';
import { CREATORS } from './create.js';
import { formatTime } from './views.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const days = (date) => Math.round((new Date(`${date}T00:00:00`) - new Date(new Date().toDateString())) / 864e5);

// The projects in the panel: the ones you chose, or (not chosen yet) the one in focus and the next active ones.
export function pultProjects(pult) {
  const all = projects().filter((p) => p.state !== 'done');
  if (pult) return pult.map((path) => all.find((p) => p.path === path)).filter(Boolean).slice(0, PULT_MAX);
  const focus = all.find((p) => p.path === focusPath());
  return [...new Set([focus, ...all.filter((p) => p.state === 'active')].filter(Boolean))].slice(0, PULT_MAX);
}

// The light of a whole project: red when a step is next, yellow when something waits, green when all is done.
function projectLight(p) {
  const s = p.steps || {};
  if (s.red) return 'next';
  if (s.wait) return 'wait';
  if (s.done && !s.open) return 'done';
  return 'open';
}

export function pultWidget({ go, pult, savePult }) {
  const lang = getLang();
  const list = pultProjects(pult);
  const box = h('div', { class: 'pult' });
  if (!list.length) {
    box.append(h('div', { class: 'empty-invite' }, h('p', { text: t(projects().length ? 'pult.empty' : 'project.none') }),
      h('p', { class: 'muted small', text: t(projects().length ? 'pult.empty.hint' : 'project.none.hint') }),
      h('div', { class: 'btn-row' }, projects().length ? choose() : h('button', { type: 'button', class: 'btn primary', onclick: () => CREATORS.find((c) => c.id === 'project').run({ go }) }, iconEl('plus'), h('span', { text: t('create.project') })))));
    return box;
  }
  const open = list.find((p) => p.path === focusPath()) || list[0];
  const openBox = h('div', { class: 'pult-open' });
  const others = h('div', { class: 'pult-others' });
  box.append(openBox, others);

  // ---------------------------------------------------------------- which projects (at most four)
  function choose() {
    const b = h('button', { type: 'button', class: 'btn small pult-choose' }, iconEl('edit'), h('span', { text: t('pult.choose') }));
    b.addEventListener('click', async () => {
      const now = list.map((p) => p.path);
      const pick = await actionSheet(t('pult.choose.title', { n: PULT_MAX }), projects().filter((p) => p.state !== 'done').map((p) => ({
        label: `${now.includes(p.path) ? '✓ ' : ''}${p.title}`, value: p.path, icon: 'target', detail: p.steps?.next ? `${t('project.next')} ${p.steps.next}` : p.goal || '',
      })));
      if (!pick) return;
      if (now.includes(pick)) { await savePult(now.filter((x) => x !== pick)); return; }
      if (now.length >= PULT_MAX) { toast(t('pult.full', { n: PULT_MAX }), 'info', 5000); return; }
      await savePult([...now, pick]);
    });
    return b;
  }

  // ---------------------------------------------------------------- what to go on with (after a step turned green or yellow)
  async function goOn(p) {
    const fresh = await loadProject(p.path).catch(() => null);
    const here = fresh && nextUp(fresh.steps);
    if (here) { toast(t('steps.goOn', { step: here.text }), 'ok', 7000); return; }
    const other = list.filter((x) => x.path !== p.path).map((x) => ({ x, s: (nodeByPath(x.path)?.steps?.list || []).find((i) => i.status === 'next') })).find((y) => y.s);
    if (other) toast(t('pult.goOnOther', { step: other.s.text, project: other.x.title }), 'ok', 8000, { label: t('pult.toFocus'), run: () => setFocus(other.x.path) });
    else toast(t('steps.allDone'), 'ok', 6000);
  }

  // ---------------------------------------------------------------- the open project
  const refocus = { want: '', set(name) { this.want = name; } };
  async function drawOpen() {
    const p = await loadProject(open.path).catch(() => null);
    if (!p || !openBox.isConnected) return;
    const fields = {};
    const ctx = { path: p.path, go, redraw: drawOpen, fields, refocus };
    const head = h('div', { class: 'pult-head' },
      h('a', { class: 'pult-title', href: nodeHref(p.path), text: p.title }),
      focusPath() === p.path ? h('span', { class: 'chip pult-focus-chip' }, iconEl('target'), h('span', { text: t('start.focus') }))
        : h('button', { type: 'button', class: 'btn small pult-to-focus', onclick: () => setFocus(p.path) }, iconEl('target'), h('span', { text: t('pult.toFocus') })),
      p.due ? h('span', { class: `chip pult-due${days(p.due) <= 3 ? ' soon' : ''}`, title: p.dueWhat || '', text: days(p.due) === 0 ? t('due.today') : t(days(p.due) < 0 ? 'pult.dueAgo' : 'pult.dueIn', { n: Math.abs(days(p.due)) }) }) : null);
    paintProject(openBox, p.slug);
    const parts = [head];
    if (p.goal) parts.push(h('p', { class: 'muted small pult-goal', text: p.goal }));
    // the next step, with the two ways it ends
    const next = nextUp(p.steps);
    if (next) {
      const i = p.steps.indexOf(next);
      const mark = (status) => async () => { await setStepStatus(p.path, i, status); await goOn(p); drawOpen(); };
      parts.push(h('div', { class: `pult-next s-${next.status}` }, lightButton(p, i, { path: p.path, redraw: drawOpen, after: goOn }), h('span', { class: 'pult-next-text' }, h('span', { class: 'muted small', text: t('project.next') }), h('b', { text: next.text })),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn small pult-done', onclick: mark('done') }, iconEl('check'), h('span', { text: t('steps.light.done') })),
          h('button', { type: 'button', class: 'btn small pult-wait', onclick: mark('wait') }, iconEl('arrowRight'), h('span', { text: t('steps.light.wait') })))));
    }
    parts.push(stepsEditor(p, { ...ctx, compact: true, skip: next ? p.steps.indexOf(next) : -1, after: goOn }));
    // where you stand in the red thread
    if (p.thread.length) {
      const seen = trail().filter((e) => e.kind === 'node').map((e) => nodeByPath(e.path)?.slug).filter(Boolean);
      const at = seen.find((s) => p.thread.includes(s));
      const i = at ? p.thread.indexOf(at) : -1;
      const card = (slug) => nodeBySlug(slug);
      const go1 = p.thread[i + 1] || null;
      const cur = i >= 0 ? card(p.thread[i]) : null;
      const nxt = go1 ? card(go1) : null;
      parts.push(h('div', { class: 'pult-thread' }, iconEl('thread'),
        h('span', { class: 'small', text: cur ? t('pult.thread.at', { title: nodeTitle(cur, lang), i: i + 1, n: p.thread.length }) : t('pult.thread.start', { n: p.thread.length }) }),
        nxt ? h('a', { class: 'pult-thread-next small', href: nodeHref(nxt.path) }, h('span', { text: nodeTitle(nxt, lang) }), iconEl('arrowRight')) : h('span', { class: 'muted small', text: t('pult.thread.end') })));
    }
    // what you did last in it
    const last = lastIn(p);
    if (last.length) {
      parts.push(h('div', { class: 'pult-last' }, h('p', { class: 'muted small pult-sub', text: t('pult.last') }), h('ul', { class: 'resume-list' }, last.map((it) => h('li', {},
        h('button', { type: 'button', class: 'resume-item', onclick: it.run }, typeTile(it.type, 'small'),
          h('span', { class: 'resume-text' }, h('span', { class: 'resume-verb muted small', text: `${it.verb} · ${formatTime(it.at)}` }), h('span', { class: 'resume-title', text: it.title }))))))));
    }
    // timer and date, the project's own widgets
    parts.push(h('div', { class: 'pult-tools' }, h('div', { class: 'pult-tool' }, h('p', { class: 'muted small pult-sub', text: t('widget.timer') }), projectWidgetBody('timer', p, ctx)),
      h('div', { class: 'pult-tool' }, h('p', { class: 'muted small pult-sub', text: t('widget.due') }), projectWidgetBody('due', p, ctx))));
    parts.push(h('div', { class: 'btn-row pult-actions' },
      h('a', { class: 'btn small', href: nodeHref(p.path) }, iconEl('board'), h('span', { text: t('pult.open') })),
      h('button', { type: 'button', class: 'btn small', onclick: () => openWriting(p.path, { go }) }, iconEl('pen'), h('span', { text: t('pult.write') })),
      h('a', { class: 'btn small', href: `#/m/net/${encodeURIComponent(p.slug)}` }, iconEl('net'), h('span', { text: t('net.title') }))));
    openBox.replaceChildren(...parts);
    if (refocus.want === 'step') { refocus.want = ''; fields.step?.focus(); }
  }

  // ---------------------------------------------------------------- the others, one line each
  function drawOthers() {
    const rest = list.filter((p) => p.path !== open.path).map((p) => nodeByPath(p.path) || p);
    others.replaceChildren(...rest.map((p) => {
      const s = p.steps || {};
      const total = (s.open || 0) + (s.done || 0);
      const row = h('div', { class: 'pult-row', dataset: { path: p.path } },
        light(projectLight(p), t(`pult.light.${projectLight(p)}`)),
        h('button', { type: 'button', class: 'pult-row-main', title: t('pult.toFocus'), onclick: () => setFocus(p.path) },
          h('span', { class: 'pult-row-title', text: p.title }),
          h('span', { class: 'muted small pult-row-next', text: s.next ? s.next : t(total ? 'steps.allDone' : 'pult.noSteps') })),
        h('span', { class: 'pult-row-meta small' },
          s.wait ? h('span', { class: 'chip pult-wait-chip', text: t('pult.waiting', { n: s.wait }) }) : null,
          total ? h('span', { class: 'meter pult-meter', title: t('pult.progress', { n: s.done, of: total }) }, h('span', { style: { width: `${Math.round((s.done / total) * 100)}%` } })) : null,
          p.due ? h('span', { class: `muted${days(p.due) <= 3 ? ' soon' : ''}`, text: t(days(p.due) < 0 ? 'pult.dueAgo' : 'pult.dueIn', { n: Math.abs(days(p.due)) }) }) : null),
        h('a', { class: 'icon-btn small', href: nodeHref(p.path), title: t('pult.open'), 'aria-label': `${t('pult.open')}: ${p.title}`, html: icon('arrowRight') }));
      paintProject(row, p.slug);
      return row;
    }), h('div', { class: 'pult-foot' }, choose()));
  }

  drawOpen();
  drawOthers();
  // the panel follows the files: a step ticked on the phone, a project changed in another window
  const stop = onNodesChange((paths) => {
    if (!box.isConnected) { stop(); return; }
    if (box.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
    if (paths === null || paths.includes(open.path)) drawOpen();
    drawOthers();
  });
  return box;
}

// What you did last in a project (this device): pages written in its library, works read, cards opened.
function lastIn(p) {
  const lib = projectLibrary(p)?.path;
  const works = new Set(projectWorks(p).clips.map((w) => w.path));
  const out = [];
  for (const e of trail()) {
    const d = nodeByPath(e.path);
    if (e.kind === 'write' && lib && e.lib === lib) out.push({ type: 'page', verb: t('start.resume.write'), title: e.title || (d ? nodeTitle(d) : ''), at: e.at, run: () => { savePref('library.open', { path: e.lib, page: e.path, at: Date.now() }); location.hash = '#/m/library'; } });
    else if (e.kind === 'read' && (works.has(e.path) || (d && p.links.includes(d.slug)))) out.push({ type: 'clip', verb: t('start.resume.read'), title: e.title || (d ? nodeTitle(d) : ''), at: e.at, run: () => { savePref('research.read', e.path); location.hash = '#/m/scraper'; } });
    else if (e.kind === 'node' && d && p.links.includes(d.slug) && d.type !== 'library') out.push({ type: d.type, verb: t('pult.opened'), title: nodeTitle(d), at: e.at, run: () => { location.hash = nodeHref(d.path); } });
    if (out.length >= 3) break;
  }
  return out;
}
