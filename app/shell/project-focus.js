// Fokus, the rabbit hole of a project (0.33.0, entwurf J5 "Struktur und Tiefe"): where you are deep in your project,
// and the way back.
//
//   the trail       Ebene 1 is the project, every card you went into one level more; tap a level to go back there.
//                   "Auftauchen" (Esc) goes up one level; from the first card up to the project, where the finds
//                   join the section you came from (setting "Funde ans Kapitel", loom.attach; services/dive.js).
//   at the top      "Wo steigst du ein?": the next step, and the cards of every section as ways in.
//   deep inside     three columns: where you came from (faded), here (the card in the light, its formula, its first
//                   sentence; what you take along when you surface) with "one level deeper" (what it rests on), and
//                   "hängt daran" (what rests on it) with what lies two steps away.
//   while you are deep inside, what you note or say to Loom hangs on the card you are at (loom-talk.js).
//
// For Python readers: focusView builds the element from the dive state and draws itself again when it changes
// (onDiveChange), like a small view bound to a model.
import { h, toast, actionSheet, loadPref } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { nodeByPath, nodeBySlug } from '../services/search.js';
import { getNode, localize } from '../services/nodes.js';
import { boardOf, nextUp } from '../services/projects.js';
import { neighbourhood, relationsOf } from '../services/relations.js';
import { firstFormula } from '../services/library-store.js';
import { diveInto, diveOf, onDiveChange, setFrom, surfaceWith, upTo } from '../services/dive.js';
import { nodeHref, nodeLead, nodeTitle, typeLabel } from './node-view.js';
import { colourVar, typeColour } from './colors.js';
import { typeset } from './math.js';
import { setTalkPlace } from './loom-talk.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const sectionName = (s) => s.title || (['collect', 'keep', 'apply'].includes(s.id) ? t(`station.${s.id}`) : s.id);
const DEEP_KINDS = new Set(['link', 'derived', 'convention', 'cite', 'page']);

function tile(d, { onclick, cls = '', meta = '' }) {
  const lang = getLang();
  const b = h('button', { type: 'button', class: `lf-tile ${cls}`, dataset: { path: d.path }, onclick },
    h('span', { class: 'lf-kind', text: typeLabel(d.type) }), h('b', { text: nodeTitle(d, lang) }),
    meta || nodeLead(d, lang) ? h('span', { class: 'lf-meta', text: meta || nodeLead(d, lang) }) : null);
  b.style.setProperty('--k', colourVar(typeColour(d.type)));
  return b;
}

export function focusView(p, ctx) {
  const { path, members, sw } = ctx;
  const lang = getLang();
  const el = h('section', { class: 'board-wrap lf', 'aria-label': t('project.view.focus') });
  setTalkPlace(path);

  const up = async (n) => {
    if (n > 0) { upTo(path, n); return; }
    const d = diveOf(path);
    const finds = await surfaceWith(path, { attach: loadPref('loom.attach', true) !== false });
    const sec = boardOf(p, members).find((s) => s.id === d.from);
    if (finds.length) toast(sec ? t('dive.finds.in', { n: finds.length, title: sectionName(sec) }) : t('dive.finds', { n: finds.length }), 'ok', 5000);
    ctx.redraw?.();
  };
  const upOne = () => { const n = diveOf(path).trail.length; if (n) up(n - 1); };

  function draw() {
    const d = diveOf(path);
    const depth = d.trail.length;
    const here = depth ? nodeByPath(d.trail[depth - 1]) : null;
    const secs = boardOf(p, members);
    const from = secs.find((s) => s.id === d.from);

    // ---- the heading and the trail
    const title = here ? t('dive.deep', { title: nodeTitle(here, lang) }) : t('dive.top');
    const trail = h('nav', { class: 'lf-trail', 'aria-label': t('dive.trail') });
    const levels = [{ title: p.title, n: 0 }, ...d.trail.map((x, i) => ({ title: nodeTitle(nodeByPath(x) || { slug: x }, lang), n: i + 1 }))];
    levels.forEach((lv, i) => {
      const last = i === levels.length - 1;
      if (i) trail.append(h('span', { class: 'lf-arrow', 'aria-hidden': 'true', text: '↘' }));
      trail.append(h('button', { type: 'button', class: `lf-level${last ? ' on' : ''}`, style: `--i:${i}`, 'aria-current': last ? 'step' : null, onclick: () => (last ? null : up(lv.n)) },
        h('span', { class: 'lf-level-n', text: t('dive.level', { n: i + 1 }) }), h('span', { class: 'lf-level-t', text: lv.title })));
    });
    const mins = depth && d.since ? Math.max(1, Math.round((Date.now() - d.since) / 60000)) : 0;
    const info = h('span', { class: 'lf-info' },
      h('span', { class: 'muted small', text: depth ? [from ? sectionName(from) : '', t(depth === 1 ? 'dive.levels.one' : 'dive.levels', { n: depth }), mins ? t('dive.mins', { n: mins }) : ''].filter(Boolean).join(' · ') : t('dive.hint') }),
      depth ? h('button', { type: 'button', class: 'btn small lf-surface', title: t('dive.surface.hint'), onclick: upOne }, iconEl('surface'), h('span', { text: t('dive.surface') })) : null);
    trail.append(info);

    const top = h('div', { class: 'board-top lf-top' }, h('h2', { class: 'board-h lf-h' }, h('span', { text: title })), sw);
    el.replaceChildren(top, trail, here ? deep(d, here, secs) : surfaceLevel(secs));
  }

  // ---- at the top: the next step and every section as a way in
  function surfaceLevel(secs) {
    const next = nextUp(p.steps || []);
    const wrap = h('div', { class: 'lf-top-level' });
    if (next) wrap.append(h('div', { class: 'lf-here' }, h('span', { class: 'lf-here-k', text: t('dive.next') }), h('p', { class: 'lf-here-t', text: next.text }),
      p.goal ? h('p', { class: 'lf-here-lead', text: p.goal }) : null));
    const ways = h('div', { class: 'lf-ways' });
    for (const s of secs) {
      if (!s.items.length) continue;
      const col = h('section', { class: 'lf-way' }, h('h3', {}, h('span', { class: 'board-dot' }), h('span', { text: sectionName(s) }), h('span', { class: 'count', text: String(s.items.length) })));
      col.style.setProperty('--sec', colourVar(s.color));
      for (const n of s.items.slice(0, 6)) col.append(tile(n, { onclick: () => diveInto(path, n.path, { from: s.id }) }));
      if (s.items.length > 6) col.append(h('button', { type: 'button', class: 'link-btn small', text: t('dive.more', { n: s.items.length - 6 }), onclick: () => ctx.show?.('board') }));
      ways.append(col);
    }
    if (!ways.children.length) ways.append(h('p', { class: 'muted', text: t('dive.empty') }));
    wrap.append(h('p', { class: 'lf-label', text: t('dive.waysIn') }), ways);
    return wrap;
  }

  // ---- deep inside: where you came from · here and deeper · what hangs on it
  function deep(d, here, secs) {
    const seen = new Set([path, ...d.trail]);
    const rel = relationsOf(here.slug);
    const deeper = rel.out.filter((x) => x.d && DEEP_KINDS.has(x.kind) && !seen.has(x.d.path)).map((x) => x.d);
    const hangs = rel.in.filter((x) => x.d && !seen.has(x.d.path) && x.d.type !== 'project').map((x) => x.d);
    const near = new Set([here.slug, ...deeper.map((x) => x.slug), ...hangs.map((x) => x.slug)]);
    const far = [...neighbourhood(here.slug, { depth: 2, through: (s) => !['convention', 'project'].includes(nodeBySlug(s)?.type) }).nodes]
      .filter(([s, n]) => n === 2 && !near.has(s)).map(([s]) => nodeBySlug(s)).filter((x) => x && x.type !== 'project').slice(0, 6);

    const came = h('div', { class: 'lf-col lf-came' }, h('p', { class: 'lf-label', text: t('dive.came') }),
      ...[p.path, ...d.trail.slice(0, -1)].slice(-3).map((x, i, all) => {
        const n = nodeByPath(x);
        if (!n) return null;
        const level = d.trail.length - all.length + i;
        return tile(n, { cls: 'faded', onclick: () => up(level), meta: t('dive.level', { n: level + 1 }) });
      }).filter(Boolean));

    const card = h('div', { class: 'lf-here' }, h('span', { class: 'lf-here-k', text: t('dive.here', { n: d.trail.length + 1 }) }), h('p', { class: 'lf-here-t', text: nodeTitle(here, lang) }));
    const formula = h('div', { class: 'lf-tex' });
    const lead = h('p', { class: 'lf-here-lead', text: nodeLead(here, lang) });
    card.append(formula, lead, h('div', { class: 'btn-row lf-here-btns' },
      h('a', { class: 'btn small', href: nodeHref(here.path) }, iconEl('external'), h('span', { text: t('dive.open') })),
      h('button', { type: 'button', class: 'btn small lf-think', onclick: () => document.querySelector('.lp-side .talk-in, .loom-talk:not([hidden]) .talk-in')?.focus() }, iconEl('mic'), h('span', { text: t('dive.think') }))));
    getNode(here.path).then((n) => {
      if (!n || !card.isConnected) return;
      const tex = firstFormula(n.body);
      if (tex) typeset(formula, tex, true);
      if (!lead.textContent) lead.textContent = localize(n.body, lang).replace(/\$\$[\s\S]*?\$\$|```[\s\S]*?```|^:::.*$/gm, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
    }).catch(() => {});

    const middle = h('div', { class: 'lf-col lf-mid' }, card);
    if (d.finds.length) {
      const fromSec = secs.find((s) => s.id === d.from);
      const change = h('button', { type: 'button', class: 'btn small', text: t('dive.change') });
      change.addEventListener('click', async () => {
        const pick = await actionSheet(t('dive.takeTo'), secs.map((s) => ({ label: sectionName(s), value: s.id, icon: 'blocks' })));
        if (pick) setFrom(path, pick);
      });
      const names = d.finds.map((x) => nodeByPath(x)).filter(Boolean).map((x) => nodeTitle(x, lang)).slice(0, 3).join(', ');
      middle.append(h('div', { class: 'lf-take' }, h('span', {}, t('dive.take'), ' ', h('b', { text: names }), fromSec ? ` → ${sectionName(fromSec)}` : ''), change));
    }
    middle.append(h('p', { class: 'lf-label', text: t('dive.deeper') }));
    middle.append(deeper.length ? h('div', { class: 'lf-grid' }, deeper.slice(0, 6).map((n) => tile(n, { onclick: () => diveInto(path, n.path) })))
      : h('p', { class: 'muted small', text: t('dive.deeper.none') }));

    const right = h('div', { class: 'lf-col lf-hangs' }, h('p', { class: 'lf-label', text: t('dive.hangs') }),
      ...(hangs.length ? hangs.slice(0, 5).map((n) => tile(n, { cls: 'bar', onclick: () => diveInto(path, n.path) })) : [h('p', { class: 'muted small', text: t('dive.hangs.none') })]));
    if (far.length) right.append(h('p', { class: 'lf-label far', text: t('dive.far') }), h('div', { class: 'lf-far' }, far.map((n) => h('button', { type: 'button', class: 'chip', text: nodeTitle(n, lang), onclick: () => diveInto(path, n.path) }))));
    return h('div', { class: 'lf-deep' }, came, middle, right);
  }

  // Escape (no dialog, not typing) surfaces one level; Loom's "auftauchen" too
  const key = (e) => {
    if (!el.isConnected) { stop(); return; }
    if (e.key !== 'Escape' || !diveOf(path).trail.length) return;
    if (document.querySelector('.modal-backdrop, .sheet-backdrop, .action-sheet')) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
    e.preventDefault();
    upOne();
  };
  const said = (e) => { if (!el.isConnected) { stop(); return; } if (!e.detail || e.detail === path) upOne(); };
  const offDive = onDiveChange((pp) => { if (!el.isConnected) { stop(); return; } if (pp === path) draw(); });
  document.addEventListener('keydown', key, true);
  window.addEventListener('loom:surface', said);
  function stop() { offDive(); document.removeEventListener('keydown', key, true); window.removeEventListener('loom:surface', said); }
  el.cleanup = stop;
  draw();
  return el;
}
