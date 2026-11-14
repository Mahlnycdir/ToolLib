// "Problem zuerst" (0.30.0, Etappe 5): suggestions from your own knowledge, the way into a path.
//   problemBox({ go, themes, saveThemes })   on Start, under the question: "Was willst du lösen?" with suggestions as
//                                            you type; without a question one small step (a bad day) and ideas by
//                                            theme (ENTE: "zu jedem Thema, welche Interessen ich habe, und mich anleiten")
//   aheadBody(p, { go })                     the project widget "Weiterkommen": its path, what fits its next step
//   ownHelp(query, { go })                   a row for the research window: what your knowledge already has
//   suggestRows(items, { go })               the list all three draw
//
// For Python readers: services/paths.js finds the suggestions (search over your nodes, paths first); this file only
// draws them and says where a tap leads.
import { h, toast, modal, promptDialog } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { getLang, t } from '../i18n/i18n.js';
import { loadPref, savePref } from '../services/prefs.js';
import { nodeByPath } from '../services/search.js';
import { capture, inbox } from '../services/notes.js';
import { focusProject } from '../services/projects.js';
import {
  THEMES, doneCount, nextStepOf, pathsInProgress, pathsOf, projectOfPath, smallSteps, stepStates, stepTitle, suggest, suggestForProject, themeById,
} from '../services/paths.js';
import { works, READ_AT } from '../services/shelf.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const nodeHref = (path) => `#/n/${path.split('/').map(encodeURIComponent).join('/')}`;
const titleOf = (d, lang) => (lang === 'de' && d.title_de ? d.title_de : d.title);
const typeName = (type) => (t(`type.${type}`) === `type.${type}` ? type : t(`type.${type}`));
const TYPE_ICON = { path: 'route', recipe: 'list', snippet: 'code', project: 'target', formula: 'vars', definition: 'book', theorem: 'book', term: 'book', convention: 'outline', topic: 'outline', rule: 'warn' };

// while the app is open: which theme is open on Start, which small step is shown
const st = { theme: '', small: 0, query: '' };

// How far you are on a path, as one short line ("2 von 6 · weiter: …").
function pathLine(d, lang) {
  const states = stepStates(d);
  const done = doneCount(states);
  const next = nextStepOf(states);
  const step = next ? d.pathSteps.find((s) => s.id === next.id) : null;
  if (!done && !projectOfPath(d.slug)) return t('path.steps', { n: d.pathSteps.length });
  if (done === d.pathSteps.length) return t('path.finished');
  return [t('path.progress', { done, n: d.pathSteps.length }), step ? t('path.next', { step: stepTitle(step, lang) }) : ''].filter(Boolean).join(' · ');
}

// ------------------------------------------------------------------ the list of suggestions
export function suggestRows(items, { go }) {
  const lang = getLang();
  return h('ul', { class: 'suggest-list' }, ...items.map((x) => {
    const d = x.node;
    const isPath = d.type === 'path';
    const detail = isPath ? pathLine(d, lang) : x.problem ? t('commandbar.solves', { problem: x.problem }) : typeName(d.type);
    const row = h('button', { type: 'button', class: `suggest-row k-${x.kind}${isPath ? ' is-path' : ''}`, dataset: { path: d.path } },
      iconEl(TYPE_ICON[d.type] || 'file', 'tile small'),
      h('span', { class: 'suggest-text' },
        h('span', { class: 'suggest-title' }, h('span', { text: titleOf(d, lang) }), isPath ? h('span', { class: 'rs-tag suggest-tag', text: x.kind === 'own' ? t('path.yours') : t('path.way') }) : null),
        h('span', { class: 'muted small suggest-detail', text: detail })),
      iconEl('chevronRight', 'suggest-go'));
    row.addEventListener('click', () => go(nodeHref(d.path)));
    return h('li', {}, row);
  }));
}

// "Pfad wünschen": the wish goes into the inbox as a note, so it is not lost (paths are written for you later).
async function wishPath(theme = '', text = '') {
  const what = await promptDialog(t('path.wish'), { label: t('path.wish.label'), value: text, placeholder: t('path.wish.placeholder') });
  if (!what || !what.trim()) return;
  const name = theme ? t(`theme.${theme}`) : '';
  try {
    await capture(name ? t('path.wish.noteTheme', { theme: name, text: what.trim() }) : t('path.wish.note', { text: what.trim() }), { inbox: true });
    toast(t('path.wish.done'), 'ok', 5000);
  } catch { toast(t('create.failed'), 'error', 5000); }
}

// ------------------------------------------------------------------ Start: the question, a small step, ideas
export function problemBox({ go, themes = THEMES.map((x) => x.id), saveThemes }) {
  const lang = getLang();
  const box = h('section', { class: 'problem' });
  const input = h('input', { class: 'field problem-in', type: 'search', placeholder: t('problem.placeholder'), 'aria-label': t('problem.label'), value: st.query, enterkeyhint: 'search', autocomplete: 'off' });
  const results = h('div', { class: 'problem-results', 'aria-live': 'polite' });
  const rest = h('div', { class: 'problem-rest' });
  box.append(h('label', { class: 'problem-label', for: 'problem-in' }, iconEl('route'), h('span', { text: t('problem.label') })), input, results, rest);
  input.id = 'problem-in';

  let current = [];
  const show = () => {
    st.query = input.value;
    const q = input.value.trim();
    rest.hidden = q.length >= 2;
    if (q.length < 2) { results.replaceChildren(); current = []; return; }
    current = suggest(q, { lang, limit: 8 });
    if (!current.length) {
      results.replaceChildren(h('div', { class: 'problem-none' }, h('p', { class: 'muted small', text: t('problem.none') }),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn small', onclick: async () => { const { queueSearch } = await import('./research-view.js'); queueSearch(q); go('#/m/scraper'); } }, iconEl('globe'), h('span', { text: t('problem.research') })),
          h('button', { type: 'button', class: 'btn small', onclick: () => wishPath(st.theme, q) }, iconEl('route'), h('span', { text: t('path.wish') })))));
      return;
    }
    results.replaceChildren(suggestRows(current, { go }));
  };
  let timer = 0;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(show, 140); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && current[0]) { e.preventDefault(); go(nodeHref(current[0].node.path)); } });

  // ---- one small step
  function smallCard() {
    const list = smallSteps({ lang, themes, inbox: inbox(), started: works().filter((w) => !w.read && w.progress > 0 && w.progress < READ_AT) });
    const sec = h('section', { class: 'small-step' }, h('h2', { class: 'problem-h' }, iconEl('sparkle'), h('span', { text: t('small.title') })));
    if (!list.length) { sec.append(h('p', { class: 'muted small', text: t('small.none') })); return sec; }
    const x = list[st.small % list.length];
    const what = {
      project: t('small.project', { project: x.detail }),
      path: t('small.path', { path: x.detail }),
      new: t('small.new', { path: x.detail }),
      read: t('small.read'),
      inbox: t('small.inbox'),
    }[x.kind];
    const title = x.kind === 'inbox' ? t('small.inbox.title', { n: x.count }) : x.title;
    const go1 = h('button', { type: 'button', class: 'btn primary small-go' }, iconEl('play'), h('span', { text: t('small.go', { min: x.min }) }));
    go1.addEventListener('click', () => {
      if (x.kind === 'project') {
        // a quarter of an hour on the clock of the project (its timer widget shows it), unless one runs already
        if (!loadPref('timer', null)) savePref('timer', { path: x.node.path, start: Date.now(), minutes: x.min });
        go(nodeHref(x.node.path));
      } else if (x.kind === 'read') { savePref('research.read', x.node.path); savePref('research.readFrom', '#/home'); go('#/m/scraper'); }
      else go(nodeHref(x.node.path));
    });
    const other = h('button', { type: 'button', class: 'btn small-other' }, iconEl('refresh'), h('span', { text: t('small.other') }));
    other.addEventListener('click', () => { st.small += 1; sec.replaceWith(smallCard()); });
    sec.append(h('div', { class: `small-card k-${x.kind}` },
      h('span', { class: 'muted small', text: what }),
      h('strong', { class: 'small-title', text: title }),
      h('div', { class: 'btn-row' }, go1, list.length > 1 ? other : null)));
    return sec;
  }

  // ---- ideas by theme
  function ideas() {
    const sec = h('section', { class: 'ideas' }, h('h2', { class: 'problem-h' }, iconEl('sparkle'), h('span', { text: t('ideas.title') })));
    const chips = h('div', { class: 'ideas-themes', role: 'group', 'aria-label': t('ideas.title') });
    for (const id of themes) {
      const th = themeById(id);
      if (!th) continue;
      const n = pathsOf(id).length;
      const b = h('button', { type: 'button', class: `chip ideas-theme${st.theme === id ? ' on' : ''}`, 'aria-pressed': String(st.theme === id), dataset: { theme: id } },
        iconEl(th.icon), h('span', { text: t(`theme.${id}`) }), n ? h('b', { text: String(n) }) : null);
      b.addEventListener('click', () => { st.theme = st.theme === id ? '' : id; sec.replaceWith(ideas()); });
      chips.append(b);
    }
    if (saveThemes) {
      const edit = h('button', { type: 'button', class: 'chip ideas-edit', title: t('ideas.choose') }, iconEl('settings'), h('span', { text: t('ideas.choose') }));
      edit.addEventListener('click', () => chooseThemes(themes, saveThemes));
      chips.append(edit);
    }
    sec.append(chips);
    const body = h('div', { class: 'ideas-body' });
    if (st.theme) {
      const list = pathsOf(st.theme);
      body.append(h('p', { class: 'muted small', text: t(`theme.${st.theme}.hint`) }));
      if (list.length) body.append(suggestRows(list.map((d) => ({ node: d, kind: 'path', problem: '' })), { go }));
      else body.append(h('p', { class: 'muted small', text: t('ideas.noPath') }));
      body.append(h('button', { type: 'button', class: 'btn small ideas-wish', onclick: () => wishPath(st.theme) }, iconEl('route'), h('span', { text: t('path.wish') })));
    } else {
      const on = pathsInProgress().map((x) => ({ node: x.node, kind: 'path', problem: '' }));
      if (on.length) body.append(h('p', { class: 'muted small', text: t('ideas.onPaths') }), suggestRows(on.slice(0, 4), { go }));
      else body.append(h('p', { class: 'muted small', text: t('ideas.pick') }));
    }
    sec.append(body);
    return sec;
  }

  rest.append(smallCard(), ideas());
  if (st.query.trim().length >= 2) show();
  return box;
}

// "Themen wählen": which of your interests Start shows, kept in start.md (the same on every device).
async function chooseThemes(current, save) {
  const boxes = THEMES.map((th) => {
    const cb = h('input', { type: 'checkbox', value: th.id, checked: current.includes(th.id) ? true : null });
    return { th, cb, row: h('label', { class: 'set-check theme-choice' }, cb, iconEl(th.icon), h('span', {}, h('b', { text: t(`theme.${th.id}`) }), h('span', { class: 'field-hint', text: t(`theme.${th.id}.hint`) }))) };
  });
  const ok = await modal({ title: t('ideas.choose'), body: h('div', { class: 'theme-choices' }, ...boxes.map((b) => b.row)), actions: [{ label: t('action.cancel'), value: null }, { label: t('action.save'), value: 'save', kind: 'primary' }] });
  if (ok !== 'save') return;
  // the ones you keep stay in their order, new ones come after
  const picked = boxes.filter((b) => b.cb.checked).map((b) => b.th.id);
  await save([...current.filter((x) => picked.includes(x)), ...picked.filter((x) => !current.includes(x))]);
}

// ------------------------------------------------------------------ the project: "Weiterkommen"
export function aheadBody(project, { go }) {
  const lang = getLang();
  const p = nodeByPath(project.path) || project;
  const box = h('div', { class: 'ahead' });
  const input = h('input', { class: 'field ahead-in', type: 'search', placeholder: t('ahead.placeholder'), 'aria-label': t('ahead.placeholder'), enterkeyhint: 'search', autocomplete: 'off' });
  const list = h('div', { class: 'ahead-list' });
  const draw = () => {
    const items = suggestForProject(p, { lang, query: input.value.trim(), limit: 5 });
    if (!items.length) { list.replaceChildren(h('p', { class: 'muted small', text: t('ahead.none') }), h('button', { type: 'button', class: 'btn small', onclick: () => wishPath('', input.value.trim() || p.steps?.next || p.goal || '') }, iconEl('route'), h('span', { text: t('path.wish') }))); return; }
    list.replaceChildren(suggestRows(items, { go }));
  };
  let timer = 0;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 160); });
  box.append(input, list);
  draw();
  return box;
}

// ------------------------------------------------------------------ the research window: what you already have
// ENTE: "gerade wenn man im Research ist und nicht weiter weiß". A row above the hits: the project in focus first.
export function ownHelp(query, { go }) {
  const lang = getLang();
  const f = focusProject();
  const items = f ? suggestForProject(nodeByPath(f.path) || f, { lang, query, limit: 3 }) : suggest(query, { lang, limit: 3 }).filter((x) => x.kind !== 'project');
  if (!items.length) return null;
  return h('div', { class: 'own-help' }, h('p', { class: 'muted small own-help-h' }, iconEl('route'), h('span', { text: f ? t('ahead.in', { project: f.title }) : t('ahead.own') })), suggestRows(items, { go }));
}

