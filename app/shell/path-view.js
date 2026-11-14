// A path in the node view (0.30.0, Etappe 5). ENTE chose "Selbermachen mit Check": every step has a goal, an example
// from your own snippets, a task you write yourself in Kobra, and a check that tells you whether it is right. A
// practical step (solder, print, measure) you tick yourself. "Als Projekt beginnen" turns the path into a project
// whose next steps are the steps of the path, with their lights.
//
//   pathSection(node, { go })   the part of the node view below the head (renderNode in node-view.js)
//
// For Python readers: the section is drawn from the path (services/paths.js) and redrawn after each change; which
// step is open lives in `opened` while the app is open. "Prüfen" runs the check like a snippet's check
// (services/python.js): your file from Kobra comes first, its functions are there for the check.
import { h, toast } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { getLang, t } from '../i18n/i18n.js';
import { nodeBySlug } from '../services/search.js';
import { runPython } from '../services/python.js';
import { focusPath } from '../services/projects.js';
import {
  THEMES, doneCount, markStep, nextStepOf, parsePath, projectOfPath, startProject, stepStates, touchPath,
} from '../services/paths.js';
import { renderMarkdown } from './markdown.js';
import { ConsoleView } from './console.js';
import { light } from './steps-ui.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const opened = new Map();   // slug of a path -> id of the open step
const passed = new Map();   // "slug|id" -> true after a check passed (shown after the view is drawn again)

const nodeHref = (path) => `#/n/${path.split('/').map(encodeURIComponent).join('/')}`;

// The task file in Kobra: what you begin with, under a short head that says where it belongs.
function starterFile(d, step, i, lang) {
  const head = lang === 'de'
    ? `# ${d.title} · Schritt ${i + 1}: ${step.title}\n# Schreib die Funktion(en) unten. Prüfen: zurück im Pfad in Toollib auf „Prüfen“ tippen.\n\n`
    : `# ${d.title} · step ${i + 1}: ${step.title}\n# Write the function(s) below. To check: back in the path in Toollib, tap "Check".\n\n`;
  return `${head}${step.starter || ''}`;
}

// Your code for a step, from Kobra's files on this device (null when there is no file yet).
async function kobraCode(project, file) {
  const store = await import('../../kobra/js/storage.js');
  const p = `${store.projectPath(project)}/${file}`;
  if (!(await store.exists(p))) return null;
  return store.readText(p);
}

export function pathSection(node, { go }) {
  const lang = getLang();
  const d = parsePath(node, lang);
  touchPath(d.slug);
  const box = h('section', { class: 'path-view', dataset: { path: d.slug } });
  const onNodeLink = (slug) => { const x = nodeBySlug(slug); return x ? { href: nodeHref(x.path), label: lang === 'de' && x.title_de ? x.title_de : x.title } : null; };

  function draw() {
    const project = projectOfPath(d.slug);
    const states = stepStates(d, project);
    const done = doneCount(states);
    const next = nextStepOf(states);
    if (!opened.has(d.slug)) opened.set(d.slug, next?.id || d.steps[0]?.id || '');
    const parts = [];
    if (d.intro) parts.push(h('div', { class: 'path-intro' }, renderMarkdown(d.intro, { onNodeLink })));
    // the themes it belongs to
    if (d.themes.length) {
      parts.push(h('div', { class: 'path-themes' }, ...d.themes.map((id) => h('span', { class: 'chip path-theme' }, iconEl(THEMES.find((x) => x.id === id)?.icon || 'route'), h('span', { text: t(`theme.${id}`) })))));
    }
    // the project begun from it, or the button that begins one
    if (project) {
      const inFocus = focusPath() === project.path;
      parts.push(h('div', { class: 'path-project' }, iconEl('target'),
        h('span', {}, h('span', { class: 'muted small', text: t('path.project') }), ' ', h('a', { href: nodeHref(project.path), class: 'path-project-link', text: project.title })),
        inFocus ? h('span', { class: 'chip small', text: t('start.focus') }) : null));
    } else {
      const begin = h('button', { type: 'button', class: 'btn primary path-begin' }, iconEl('target'), h('span', { text: t('path.begin') }));
      begin.addEventListener('click', async () => {
        begin.disabled = true;
        try {
          const p = await startProject(d, lang);
          toast(t('path.begun'), 'ok', 7000, { label: t('path.toProject'), run: () => go(nodeHref(p)) });
          draw();
        } catch (e) { console.warn(e); toast(t('create.failed'), 'error', 5000); begin.disabled = false; }
      });
      parts.push(h('div', { class: 'path-project none' }, begin, h('p', { class: 'muted small', text: t('path.begin.hint') })));
    }
    // how far you are
    const left = d.steps.reduce((a, s, i) => a + (states[i].status === 'done' ? 0 : s.min || 0), 0);
    parts.push(h('div', { class: 'path-progress' },
      h('span', { class: 'meter' }, h('span', { style: { width: `${d.steps.length ? Math.round((done / d.steps.length) * 100) : 0}%` } })),
      h('span', { class: 'small', text: done === d.steps.length && done ? t('path.finished') : t('path.progress', { done, n: d.steps.length }) }),
      left && done < d.steps.length ? h('span', { class: 'muted small', text: t('path.left', { min: left }) }) : null));
    // the steps
    parts.push(h('ol', { class: 'path-steps' }, ...d.steps.map((s, i) => stepRow(s, i, states[i], states))));
    box.replaceChildren(...parts);
  }

  function stepRow(s, i, st, states) {
    const open = opened.get(d.slug) === s.id;
    const headBtn = h('button', { type: 'button', class: 'path-step-head', 'aria-expanded': String(open) },
      light(st.status),
      h('span', { class: 'path-step-num', text: String(i + 1) }),
      h('span', { class: 'path-step-title', text: s.title }),
      s.min ? h('span', { class: 'path-step-min muted small', text: t('path.min', { min: s.min }) }) : null,
      iconEl(s.kind === 'code' ? 'code' : 'hammer', 'path-step-kind'));
    headBtn.addEventListener('click', () => { opened.set(d.slug, open ? '' : s.id); draw(); });
    const row = h('li', { class: `path-step s-${st.status}${open ? ' open' : ''}`, dataset: { step: s.id } }, headBtn);
    if (open) row.append(stepBody(s, i, st, states));
    return row;
  }

  function stepBody(s, i, st, states) {
    const body = h('div', { class: 'path-step-body' });
    if (s.text) body.append(renderMarkdown(s.text, { onNodeLink }));
    // the example from your own snippets: a link, and its code to look at
    const ex = s.example ? nodeBySlug(s.example) : null;
    if (ex) {
      const exTitle = lang === 'de' && ex.title_de ? ex.title_de : ex.title;
      const exBox = h('div', { class: 'path-example' }, iconEl('book'), h('span', {}, h('span', { class: 'muted small', text: t('path.example') }), ' ', h('a', { href: nodeHref(ex.path), text: exTitle })));
      body.append(exBox);
      if (ex.code) body.append(h('details', { class: 'path-example-code' }, h('summary', { text: t('path.example.code') }), h('pre', {}, h('code', { text: ex.code }))));
    }
    const status = h('p', { class: 'path-status small', role: 'status' });
    const consoleHost = h('div', { class: 'path-console' });
    const done = st.status === 'done';
    if (passed.get(`${d.slug}|${s.id}`) && done) status.append(iconEl('check'), h('span', { text: t('path.passed') }));
    const actions = h('div', { class: 'btn-row path-actions' });
    if (s.kind === 'code') {
      const write = h('button', { type: 'button', class: `btn ${done ? '' : 'primary '}path-write` }, iconEl('code'), h('span', { text: t('path.write') }));
      write.addEventListener('click', () => {
        // Kobra takes the task when it opens: a project "pfad-…" with this step's file (only made the first time)
        try {
          localStorage.setItem('kobra.open', JSON.stringify({ task: { project: d.kobra, file: s.file, starter: starterFile(d, s, i, lang), node: d.path, title: d.title } }));
        } catch { /* without storage Kobra just opens */ }
        go('#/m/kobra');
      });
      const check = h('button', { type: 'button', class: 'btn path-check' }, iconEl('check'), h('span', { text: t('path.check') }));
      check.addEventListener('click', () => runCheck(s, check, status, consoleHost, states));
      actions.append(write, check);
    } else {
      const tick = h('button', { type: 'button', class: `btn ${done ? '' : 'primary '}path-done` }, iconEl('check'), h('span', { text: t(done ? 'path.reopen' : 'path.done') }));
      tick.addEventListener('click', async () => { await markStep(d, s.id, !done); if (!done) openNext(s.id, states); draw(); });
      actions.append(tick);
    }
    if (done && s.kind === 'code') {
      const again = h('button', { type: 'button', class: 'link-btn small path-reopen', text: t('path.reopen') });
      again.addEventListener('click', async () => { passed.delete(`${d.slug}|${s.id}`); await markStep(d, s.id, false); draw(); });
      actions.append(again);
    }
    body.append(actions, status, consoleHost);
    if (s.hint) body.append(h('details', { class: 'path-hint' }, h('summary', {}, iconEl('info'), h('span', { text: t('path.hint') })), renderMarkdown(s.hint, { onNodeLink })));
    return body;
  }

  // the next step that is not done yet opens
  function openNext(id, states) {
    const i = d.steps.findIndex((x) => x.id === id);
    const after = d.steps.slice(i + 1).find((x, k) => states[i + 1 + k].status !== 'done') || d.steps.find((x, k) => k !== i && states[k].status !== 'done');
    opened.set(d.slug, after?.id || '');
    return after;
  }

  // "Prüfen": your file from Kobra, then the check. Passing ticks the step (and its light in the project).
  async function runCheck(s, btn, status, host, states) {
    status.replaceChildren();
    let code;
    try { code = await kobraCode(d.kobra, s.file); } catch (e) { console.warn(e); code = null; }
    if (code == null) { status.append(iconEl('info'), h('span', { text: t('path.noFile') })); return; }
    btn.disabled = true;
    const con = new ConsoleView();
    host.replaceChildren(con.root);
    const sink = {
      started: () => con.started(), write: (x, kind) => con.write(x, kind), figure: (...a) => con.figure(...a), figureClosed: (k) => con.figureClosed(k),
      progress: (c, v) => con.progress(c, v), note: (c, v, k) => con.note(c, v, k), requestInput: () => con.requestInput(), cancelInput: () => con.cancelInput(),
      liveEnded: () => con.liveEnded(),
      done: async (result, ms) => {
        con.done(result, ms);
        btn.disabled = false;
        if (result.failed || result.exit !== 0) { status.replaceChildren(iconEl('warn'), h('span', { text: t('path.failed') })); return; }
        passed.set(`${d.slug}|${s.id}`, true);
        await markStep(d, s.id, true);
        const fresh = stepStates(d, projectOfPath(d.slug));
        const after = openNext(s.id, fresh);
        toast(after ? t('path.goOn', { step: after.title }) : t('path.finished'), 'ok', 6000);
        draw();
      },
    };
    try { await runPython({ name: `${d.slug}-${s.id}`, code, deps: [], check: s.check }, sink); } catch (e) { console.warn(e); btn.disabled = false; }
  }

  draw();
  return box;
}
