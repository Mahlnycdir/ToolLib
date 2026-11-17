// Loom (0.32.0): the small pieces of the new frame that several places share.
//
//   loomMark()        the mark: two threads, the warm one above the green one (the brand in the rail, the tab "Heute")
//   benchItems(n)     "Auf der Werkbank": what lies half finished, newest first, from the trail of this device
//                     (services/trail.js: what you read, wrote and opened) plus a snippet draft
//   benchStrip(o)     the strip itself: a title and up to n chips; in the status line on wide screens, on Heute on the phone
//   openTabs()        the projects shown as tabs in the bar: the one in focus and the ones you used last, at most three
//   loomVoice(o)      Loom's card on Heute: what is open today, as a sentence and one chip per thing to start with.
//   loomWidget(o)     0.33.0: the widget "Loom" on Heute: that card, the suggestions with their reasons and a line to
//                     speak or type to Loom (the conversation opens beside, loom-talk.js)
//                     No language model (decided 16.11.): the sentence is made from your projects and their next steps.
//                     A model can be added later as one more source of what Loom says (see loomSay below).
//
// For Python readers: these are plain functions returning elements (like small widgets); nothing here keeps state.
import { h } from '../services/ui.js';
import { t, getLang } from '../i18n/i18n.js';
import { loadPref, savePref } from '../services/prefs.js';
import { trail } from '../services/trail.js';
import { nodeByPath } from '../services/search.js';
import { focusProject, projects, setFocus } from '../services/projects.js';
import { nodeHref, nodeTitle } from './node-view.js';
import { icon } from '../services/icons.js';
import { suggestions } from '../services/loom-mind.js';
import { loomSuggest } from './settings/loom.js';
import { openTalk, sendToLoom, suggestRow } from './loom-talk.js';

const SVG = 'http://www.w3.org/2000/svg';

export function loomMark(size = 24) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  for (const [d, colour] of [['M3 17 C 8 10, 12 14, 21 6', 'var(--light)'], ['M3 21 C 9 15, 13 18, 21 11', 'var(--c-teal)']]) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', colour);
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    svg.append(p);
  }
  return svg;
}

// ------------------------------------------------------------------ the workbench
export function benchItems(n = 4) {
  const lang = getLang();
  const items = [];
  const draft = loadPref('snippet.draft', null);
  if (draft && (draft.code || draft.title)) items.push({ title: draft.title || draft.fromTitle || t('cmd.newSnippet'), meta: t('bench.draft'), href: '#/new' });
  const seen = new Set();
  for (const e of trail()) {
    if (items.length >= n) break;
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    const d = nodeByPath(e.path);
    const title = d ? nodeTitle(d, lang) : e.title;
    if (!title) continue;
    if (e.kind === 'read') items.push({ title, meta: t('bench.read'), href: '#/m/scraper', run: () => savePref('research.read', e.path) });
    else if (e.kind === 'write') items.push({ title, meta: t('bench.write'), href: '#/m/library', run: () => savePref('library.open', { path: e.lib, page: e.path, at: Date.now() }) });
    else if (d) items.push({ title, meta: ago(e.at), href: nodeHref(e.path) });
  }
  return items;
}

function ago(at) {
  if (!at) return '';
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 60) return t('bench.min', { n: Math.max(1, min) });
  const hours = Math.round(min / 60);
  if (hours < 24) return t('bench.hours', { n: hours });
  return t('bench.days', { n: Math.round(hours / 24) });
}

export function benchStrip({ n = 4 } = {}) {
  const items = benchItems(n);
  const strip = h('div', { class: 'bench', role: 'navigation', 'aria-label': t('bench.title') }, h('span', { class: 'bench-title', text: t('bench.title') }));
  if (!items.length) strip.append(h('span', { class: 'muted small', text: t('bench.empty') }));
  for (const it of items) {
    const a = h('a', { class: 'bench-item', href: it.href, title: it.title }, h('b', { text: it.title }), it.meta ? h('span', { text: it.meta }) : null);
    if (it.run) a.addEventListener('click', it.run);
    strip.append(a);
  }
  return strip;
}

// ------------------------------------------------------------------ tabs of the open projects
export function openTabs(max = 3) {
  const list = [];
  const f = focusProject();
  if (f) list.push(f);
  const used = loadPref('projects.used', []);
  for (const p of used) {
    if (list.length >= max) break;
    const d = nodeByPath(p);
    if (d && d.type === 'project' && !d.conflict && d.state !== 'done' && !list.some((x) => x.path === d.path)) list.push(d);
  }
  return list;
}

// ------------------------------------------------------------------ what Loom says on Heute
// One source today: your projects. loomSay returns { text, chips }; a later source (a model, 0.33+) would add to it.
export function loomSay() {
  const open = projects().filter((p) => p.state === 'active' && p.steps?.next).slice(0, 3);
  if (!open.length) return { text: t('loom.say.none'), chips: [] };
  const short = (x) => (x.length > 42 ? `${x.slice(0, 40).replace(/\s+\S*$/, '')} …` : x);
  const names = open.map((p) => short(p.steps.next));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} ${t('loom.and')} ${names[names.length - 1]}`;
  return { text: t('loom.say.open', { n: open.length, list }), chips: open.map((p) => ({ label: p.title, path: p.path })) };
}

export function loomVoice({ go }) {
  const say = loomSay();
  const chips = h('div', { class: 'loom-chips' }, say.chips.map((c) => h('button', {
    type: 'button', class: 'loom-chip', text: c.label,
    onclick: () => { setFocus(c.path); go(nodeHref(c.path)); },
  })));
  return h('section', { class: 'loom-voice', 'aria-label': 'Loom' },
    h('div', { class: 'loom-voice-head' }, h('span', { text: 'Loom' }), h('span', { class: 'loom-voice-state', text: t('loom.state') })),
    h('p', { text: say.text }), say.chips.length ? chips : null);
}

// 0.33.0: the widget on Heute. Speaking opens the conversation beside (Mac) or over the page (iPhone).
export function loomWidget({ go }) {
  const card = loomVoice({ go });
  const mode = loomSuggest();
  const host = h('div', { class: 'loom-sugs' });
  const draw = () => {
    const dismissed = loadPref('loom.dismissed', []);
    const list = mode === 'off' ? [] : suggestions({ max: mode === 'more' ? 3 : 1, dismissed: Array.isArray(dismissed) ? dismissed : [] });
    host.replaceChildren(...list.map((x) => suggestRow(x, { go, redraw: draw })));
  };
  draw();
  const field = h('input', { class: 'loom-ask', type: 'text', placeholder: t('loom.talk.placeholder'), 'aria-label': t('loom.talk.placeholder'), enterkeyhint: 'send' });
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter' && field.value.trim()) { e.preventDefault(); const v = field.value; field.value = ''; sendToLoom(v, { go }); } });
  const mic = h('button', { type: 'button', class: 'talk-mic small', 'aria-label': t('loom.mic'), title: t('loom.mic'), html: icon('mic') });
  mic.addEventListener('click', () => { const panel = openTalk({ go }); panel.querySelector('.talk-mic')?.click(); });
  card.append(host, h('div', { class: 'loom-ask-row' }, field, mic));
  card.querySelector('.loom-voice-state').textContent = t('loom.state.listen');
  return card;
}
