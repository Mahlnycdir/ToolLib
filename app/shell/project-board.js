// A project as a board (0.18.0): your own sections in colour (the three stations to start with), cards you drag
// within and between them, sections you drag too; above them widgets you choose per project (next steps, reading
// list, pinned formulas and snippets, a scratch pad that calculates, a focus timer, a date, links, the pages, notes).
// The drawer shows the project in focus from anywhere and takes the node you are looking at into a section.
import { h, toast, promptDialog, confirmDialog, actionSheet, debounce, loadPref, savePref, modal, copyText, openSheet } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { allNodes, nodeByPath, nodeBySlug, searchNodes } from '../services/search.js';
import { getNode } from '../services/nodes.js';
import {
  WIDGETS, addLink, addSection, addStep, addTime, addToProject, boardOf, focusPath, loadProject, moveSectionTo, placeItem, projectWorks,
  removeFromProject, removeLink, removeSection, removeStep, saveCalc, saveProjectNotes, sectionsOf, setDue, setFocus, setPinned, setRead,
  setWidgets, toggleStep, updateSection, widgetsOf, SECTION_COLOURS, focusProject, projectNodes,
} from '../services/projects.js';
import { capture } from '../services/notes.js';
import { nodeHref, nodeLead, nodeTitle, typeLabel, typeTile } from './node-view.js';
import { newCard, newCrawl, newNote, newSnippet } from './create.js';
import { openWriting } from './library-home.js';
import { loadLibrary, firstFormula } from '../services/library-store.js';
import { dissolveFolder } from '../services/research-store.js';
import { queueSearch } from './research-view.js';
import { draggable, dropZone } from './drag.js';
import { typeset } from './math.js';
import { compile } from './plot.js';
import { keyTitle } from '../services/keys.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const narrow = () => window.matchMedia('(max-width: 899px)').matches;
export const COLOUR_HEX = { blue: '#1f63e0', sky: '#0b7bbd', teal: '#0f8078', green: '#1e7e3a', orange: '#c2410c', rose: '#c0265e', violet: '#6d4aff', yellow: '#c99a06', slate: '#64748b' };
const paintSection = (el, color) => el.style.setProperty('--sec', COLOUR_HEX[color] || COLOUR_HEX.slate);
export const sectionTitle = (s) => s.title || (['collect', 'keep', 'apply'].includes(s.id) ? t(`station.${s.id}`) : s.id);
const WIDGET_ICON = { steps: 'check', reading: 'book', pins: 'bookmark', calc: 'vars', timer: 'history', due: 'target', links: 'link', pages: 'file', notes: 'edit' };
const upper = (e, el) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height * 0.6 ? 'before' : 'after'; };
const side = (e, el) => { const r = el.getBoundingClientRect(); return narrow() ? upper(e, el) : (e.clientX < r.left + r.width / 2 ? 'before' : 'after'); };

// ------------------------------------------------------------------ the body of a project: actions, widgets, board
// ctx: { path, go, redraw, refocus: { get, set } }
export function projectBody(p, ctx) {
  const { path, go, redraw } = ctx;
  const lang = getLang();
  const members = projectNodes(p.links);
  const here = (fn) => { if (focusPath() !== path) setFocus(path); return fn(); };

  // actions: what you can add, and a thought caught in one line
  const quick = h('input', { class: 'field quick-note', type: 'text', placeholder: t('project.quick'), 'aria-label': t('project.quick'), enterkeyhint: 'done' });
  quick.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !quick.value.trim()) return;
    e.preventDefault();
    try { await capture(quick.value, { project: path }); toast(t('note.kept'), 'ok'); ctx.refocus.set('quick'); redraw(); } catch { toast(t('create.failed'), 'error', 5000); }
  });
  const act = (key, iconName, fn, cls = '') => h('button', { type: 'button', class: `btn small ${cls}`, onclick: fn }, iconEl(iconName), h('span', { text: t(key) }));
  const actions = h('div', { class: 'project-add' },
    quick,
    h('div', { class: 'project-add-btns' },
      act('project.fromKnowledge.btn', 'search', () => knowledgePicker(p, ctx), 'add-know'),
      act('project.do.search', 'globe', () => here(() => { queueSearch(p.title); go('#/m/scraper'); })),
      act('create.crawl', 'globe', () => here(() => newCrawl({ go }))),
      act('project.write', 'file', () => openWriting(path, { go })),
      act('create.card', 'vars', () => here(() => newCard({ go }))),
      act('create.note', 'edit', async () => { if (await newNote({ project: path })) redraw(); }),
      act('create.snippet', 'code', () => here(() => newSnippet({ go })))));

  return [actions, widgetsArea(p, members, ctx), board(p, members, ctx)];
}

// ------------------------------------------------------------------ the board
function board(p, members, ctx) {
  const { path, redraw } = ctx;
  const lang = getLang();
  const secs = boardOf(p, members);
  const collapsed = new Set(loadPref('board.collapsed', []));
  const wrap = h('div', { class: 'board', role: 'list', 'aria-label': t('board.title') });
  secs.forEach((s, si) => {
    const col = h('section', { class: `board-col station station-${s.id}${collapsed.has(`${p.slug}:${s.id}`) ? ' collapsed' : ''}`, id: `station-${s.id}`, dataset: { sec: s.id }, role: 'listitem' });
    paintSection(col, s.color);
    const menu = h('button', { type: 'button', class: 'icon-btn board-menu no-drag', 'aria-label': t('board.section.menu'), title: t('board.section.menu'), html: icon('more') });
    menu.addEventListener('click', () => sectionMenu(p, s, si, secs.length, ctx));
    const fold = h('button', { type: 'button', class: 'board-title', 'aria-expanded': String(!col.classList.contains('collapsed')) },
      h('span', { class: 'board-dot' }), h('span', { class: 'board-name', text: sectionTitle(s) }), h('span', { class: 'count', text: String(s.items.length) }));
    fold.addEventListener('click', () => {
      const key = `${p.slug}:${s.id}`;
      if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
      savePref('board.collapsed', [...collapsed].slice(-200));
      col.classList.toggle('collapsed');
      fold.setAttribute('aria-expanded', String(!col.classList.contains('collapsed')));
    });
    const head = h('header', { class: 'board-head' }, fold, menu);
    draggable(head, { data: { kind: 'section', id: s.id, project: path }, label: sectionTitle(s) });
    dropZone(head, {
      accept: (x) => (x.kind === 'section' && x.project === path && x.id !== s.id) || (x.kind === 'card' && x.project === path),
      place: (x, e, el) => (x.kind === 'card' ? 'into' : side(e, el)),
      drop: async (x, place) => {
        if (x.kind === 'card') { if (await placeItem(path, x.slug, s.id, -1)) redraw(); return; }
        if (await moveSectionTo(path, x.id, place === 'before' ? si : si + 1)) redraw();
      },
    });
    const list = h('ul', { class: 'board-cards members' }, ...s.items.map((n, k) => cardRow(n, k, s, p, ctx, lang)));
    if (!s.items.length) list.append(h('li', { class: 'board-empty muted small', text: t('board.empty') }));
    dropZone(list, { accept: (x) => x.kind === 'card' && x.project === path, place: () => 'into', drop: async (x) => { if (await placeItem(path, x.slug, s.id, -1)) redraw(); } });
    const add = h('button', { type: 'button', class: 'btn small board-add' }, iconEl('plus'), h('span', { text: t('board.add') }));
    add.addEventListener('click', () => addToSection(p, s, ctx));
    col.append(head, h('div', { class: 'board-body' }, list, add));
    wrap.append(col);
  });
  const newSec = h('button', { type: 'button', class: 'btn small board-new', id: 'board-new-section' }, iconEl('plus'), h('span', { text: t('board.section.new') }));
  newSec.addEventListener('click', async () => {
    const v = await promptDialog(t('board.section.new'), { label: t('board.section.name'), validate: (x) => (x.trim() ? '' : t('project.needTitle')) });
    if (!v) return;
    const used = new Set(sectionsOf(p).map((x) => x.color));
    await addSection(path, v, SECTION_COLOURS.find((c) => !used.has(c)) || 'slate');
    redraw();
  });
  return h('section', { class: 'board-wrap' }, h('div', { class: 'board-top' }, h('h2', { class: 'board-h' }, h('span', { text: t('board.title') }), h('span', { class: 'muted small board-hint', text: t(narrow() ? 'board.hint.touch' : 'board.hint') })), newSec), wrap);
}

function cardRow(n, index, s, p, ctx, lang) {
  const { path, redraw } = ctx;
  const pinned = p.pins.includes(n.slug);
  const rm = h('button', { type: 'button', class: 'icon-btn small member-rm no-drag', title: t('project.takeOut'), 'aria-label': `${t('project.takeOut')}: ${nodeTitle(n, lang)}`, html: icon('close') });
  rm.addEventListener('click', async (e) => { e.preventDefault(); await removeFromProject(path, n.slug); redraw(); });
  const pin = h('button', { type: 'button', class: `icon-btn small member-pin no-drag${pinned ? ' on' : ''}`, title: t(pinned ? 'board.unpin' : 'board.pin'), 'aria-label': t(pinned ? 'board.unpin' : 'board.pin'), 'aria-pressed': String(pinned), html: icon('bookmark') });
  pin.addEventListener('click', async (e) => {
    e.preventDefault();
    await setPinned(path, n.slug);
    if (!pinned && !widgetsOf(p).includes('pins')) await setWidgets(path, [...widgetsOf(p), 'pins']);
    redraw();
  });
  let li;
  if (n.type === 'research' && !n.crawl && !n.pdfInbox) {
    // a folder from before 0.16.0: one tap moves its works and notes into the project, the folder goes
    const take = h('button', { type: 'button', class: 'btn small member-dissolve no-drag', title: t('project.dissolve.hint') }, iconEl('check'), h('span', { text: t('project.dissolve') }));
    take.addEventListener('click', async () => {
      take.disabled = true;
      try { await dissolveFolder(n.path, path); toast(t('research.adopted', { project: p.title }), 'ok'); } catch (e) { console.warn(e); toast(t('create.failed'), 'error', 5000); }
      redraw();
    });
    li = h('li', { class: 'member member-old board-card', dataset: { slug: n.slug } }, h('a', { class: 'member-main', href: nodeHref(n.path) }, typeTile(n.type, 'small'),
      h('span', { class: 'member-text' }, h('span', { class: 'member-title', text: nodeTitle(n, lang) }), h('span', { class: 'muted small member-lead', text: t('project.oldFolder', { n: n.clips.length }) }))), take);
  } else {
    const lead = n.type === 'research' ? t('research.kept', { n: n.clips.length }) : n.type === 'note' ? `${typeLabel('note')}${n.at ? `, ${new Date(n.at).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB')}` : ''}` : nodeLead(n, lang) || typeLabel(n.type);
    const read = n.type === 'clip' && p.read.includes(n.slug) ? h('span', { class: 'board-read', title: t('reading.read'), html: icon('check') }) : null;
    li = h('li', { class: `member board-card type-${n.type}`, dataset: { slug: n.slug } }, h('a', { class: 'member-main', href: nodeHref(n.path) }, typeTile(n.type, 'small'),
      h('span', { class: 'member-text' }, h('span', { class: 'member-title', text: nodeTitle(n, lang) }), h('span', { class: 'muted small member-lead', text: lead }))), read, pin, rm);
  }
  draggable(li, { data: { kind: 'card', slug: n.slug, project: path }, label: nodeTitle(n, lang) });
  dropZone(li, {
    accept: (x) => x.kind === 'card' && x.project === path && x.slug !== n.slug,
    place: (x, e, el) => upper(e, el),
    drop: async (x, place) => { if (await placeItem(path, x.slug, s.id, place === 'before' ? index : index + 1)) redraw(); },
  });
  return li;
}

async function sectionMenu(p, s, si, count, ctx) {
  const { path, redraw } = ctx;
  const pick = await actionSheet(sectionTitle(s), [
    { label: t('board.section.rename'), value: 'rename', icon: 'edit' },
    { label: t('board.section.colour'), value: 'colour', icon: 'palette' },
    { label: t('board.section.left'), value: 'left', icon: 'arrowLeft', disabled: si === 0 },
    { label: t('board.section.right'), value: 'right', icon: 'arrowRight', disabled: si === count - 1 },
    '-',
    { label: t('board.section.delete'), value: 'delete', icon: 'trash', danger: true, disabled: count < 2 },
  ]);
  if (pick === 'rename') {
    const v = await promptDialog(t('board.section.rename'), { value: sectionTitle(s), validate: (x) => (x.trim() ? '' : t('project.needTitle')) });
    if (v && await updateSection(path, s.id, { title: v })) redraw();
  } else if (pick === 'colour') {
    const c = await actionSheet(t('board.section.colour'), SECTION_COLOURS.map((id) => ({ label: t(`colour.${id}`), value: id, icon: 'dot', color: COLOUR_HEX[id] })));
    if (c && await updateSection(path, s.id, { color: c })) redraw();
  } else if (pick === 'left' || pick === 'right') {
    if (await moveSectionTo(path, s.id, pick === 'left' ? si - 1 : si + 2)) redraw();
  } else if (pick === 'delete') {
    if (!(await confirmDialog(t('board.section.delete'), t('board.section.delete.confirm', { title: sectionTitle(s), n: s.items.length }), { okLabel: t('board.section.delete'), danger: true }))) return;
    if (await removeSection(path, s.id)) redraw();
  }
}

async function addToSection(p, s, ctx) {
  const { path, redraw } = ctx;
  const pick = await actionSheet(sectionTitle(s), [
    { label: t('board.add.note'), value: 'note', icon: 'edit' },
    { label: t('project.fromKnowledge.btn'), value: 'know', icon: 'search' },
  ]);
  if (pick === 'note') {
    const v = await promptDialog(t('board.add.note'), { label: t('project.quick') });
    if (!v || !v.trim()) return;
    const made = await capture(v, { project: path });
    await placeItem(path, made.slice(made.lastIndexOf('/') + 1).replace(/\.md$/, ''), s.id, -1);
    redraw();
  } else if (pick === 'know') knowledgePicker(p, ctx, s);
}

// What your knowledge already has on the project: search, one tap adds it (into a section, if one was chosen).
function knowledgePicker(p, ctx, section = null) {
  const { path, redraw } = ctx;
  const lang = getLang();
  const input = h('input', { class: 'field', type: 'search', placeholder: t('project.fromKnowledge'), 'aria-label': t('project.fromKnowledge'), autocapitalize: 'off', spellcheck: 'false' });
  const list = h('ul', { class: 'members suggestions' });
  const has = new Set(p.links);
  let changed = false;
  const draw = () => {
    const query = input.value.trim() || `${p.title} ${p.goal}`.trim();
    const hits = searchNodes(query, { limit: 12, filter: (n) => n && !n.conflict && n.type !== 'project' && !has.has(n.slug) && !(n.type === 'clip' && n.run) && n.path !== path });
    list.replaceChildren(...(hits.length ? hits.map((n) => {
      const add = h('button', { type: 'button', class: 'btn small member-add', 'aria-label': `${t('project.add')}: ${nodeTitle(n, lang)}` }, iconEl('plus'), h('span', { text: t('project.add') }));
      add.addEventListener('click', async () => {
        add.disabled = true;
        await addToProject(path, [n.slug]);
        if (section) await placeItem(path, n.slug, section.id, -1);
        has.add(n.slug);
        changed = true;
        add.replaceChildren(iconEl('check'), h('span', { text: t('project.added') }));
      });
      return h('li', { class: 'member' }, h('span', { class: 'member-main' }, typeTile(n.type, 'small'),
        h('span', { class: 'member-text' }, h('span', { class: 'member-title', text: nodeTitle(n, lang) }), h('span', { class: 'muted small member-lead', text: typeLabel(n.type) }))), add);
    }) : [h('li', { class: 'muted small', text: t(input.value.trim() ? 'project.fromKnowledge.none' : 'project.fromKnowledge.empty') })]));
  };
  input.addEventListener('input', debounce(draw, 150));
  draw();
  modal({ title: section ? t('board.add.into', { section: sectionTitle(section) }) : t('project.fits'), body: h('div', { class: 'project-suggest' }, input, list), actions: [{ label: t('action.close'), value: true, kind: 'primary' }], onOpen: () => setTimeout(() => input.focus(), 60) })
    .then(() => { if (changed) redraw(); });
}

// ------------------------------------------------------------------ widgets
function widgetsArea(p, members, ctx) {
  const { path, redraw } = ctx;
  const list = widgetsOf(p);
  const area = h('div', { class: 'widgets' });
  list.forEach((id, i) => {
    const body = WIDGET_BODY[id]?.(p, members, ctx);
    if (!body) return;
    const menu = h('button', { type: 'button', class: 'icon-btn small widget-menu no-drag', title: t('widget.menu'), 'aria-label': t('widget.menu'), html: icon('more') });
    menu.addEventListener('click', async () => {
      const pick = await actionSheet(t(`widget.${id}`), [
        { label: t('widget.earlier'), value: 'up', icon: 'arrowLeft', disabled: i === 0 },
        { label: t('widget.later'), value: 'down', icon: 'arrowRight', disabled: i === list.length - 1 },
        '-', { label: t('widget.remove'), value: 'remove', icon: 'close', danger: true },
      ]);
      if (!pick) return;
      const next = [...list];
      if (pick === 'remove') next.splice(i, 1);
      else { const j = pick === 'up' ? i - 1 : i + 1; [next[i], next[j]] = [next[j], next[i]]; }
      if (await setWidgets(path, next)) redraw();
    });
    const head = h('header', { class: 'widget-head' }, iconEl(WIDGET_ICON[id], 'widget-icon'), h('h3', { text: t(`widget.${id}`) }), menu);
    const w = h('section', { class: `widget widget-${id}`, dataset: { widget: id } }, head, body);
    draggable(head, { data: { kind: 'widget', id, project: path }, label: t(`widget.${id}`) });
    dropZone(w, {
      accept: (x) => x.kind === 'widget' && x.project === path && x.id !== id,
      place: (x, e, el) => side(e, el),
      drop: async (x, place) => {
        const next = list.filter((y) => y !== x.id);
        let at = next.indexOf(id) + (place === 'after' ? 1 : 0);
        next.splice(at, 0, x.id);
        if (await setWidgets(path, next)) redraw();
      },
    });
    area.append(w);
  });
  const missing = WIDGETS.filter((w) => !list.includes(w));
  if (missing.length) {
    const add = h('button', { type: 'button', class: 'widget-add', id: 'widget-add' }, iconEl('plus'), h('span', { text: t('widget.add') }));
    add.addEventListener('click', async () => {
      const pick = await actionSheet(t('widget.add'), missing.map((w) => ({ label: t(`widget.${w}`), value: w, icon: WIDGET_ICON[w], detail: t(`widget.${w}.hint`) })));
      if (pick && await setWidgets(path, [...list, pick])) redraw();
    });
    area.append(add);
  }
  return area;
}

const WIDGET_BODY = {
  // next steps: tick, remove, add; the field keeps the focus
  steps(p, members, ctx) {
    const { path, redraw } = ctx;
    const steps = h('ul', { class: 'steps-list' });
    p.steps.forEach((s, i) => {
      const box = h('input', { type: 'checkbox', checked: s.done ? true : null, 'aria-label': s.text });
      box.addEventListener('change', async () => { await toggleStep(path, i); redraw(); });
      const del = h('button', { type: 'button', class: 'icon-btn small step-del', 'aria-label': `${t('action.remove')}: ${s.text}`, title: t('action.remove'), html: icon('close') });
      del.addEventListener('click', async () => { await removeStep(path, i); redraw(); });
      steps.append(h('li', { class: s.done ? 'done' : '' }, h('label', {}, box, h('span', { text: s.text })), del));
    });
    const input = h('input', { class: 'field step-input', type: 'text', placeholder: t('project.step.add'), 'aria-label': t('project.step.add'), enterkeyhint: 'done' });
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      e.preventDefault();
      await addStep(path, input.value);
      ctx.refocus.set('step');
      redraw();
    });
    ctx.fields.step = input;
    return h('div', { class: 'project-steps' }, steps, input);
  },

  // the works of the project: read or not yet, read them from here
  reading(p, members, ctx) {
    const { path, go, redraw } = ctx;
    const works = projectWorks(p).clips;
    if (!works.length) return h('p', { class: 'muted small', text: t('reading.none') });
    const done = works.filter((w) => p.read.includes(w.slug)).length;
    const bar = h('span', { class: 'meter reading-meter' }, h('span', { style: { width: `${Math.round((done / works.length) * 100)}%` } }));
    const list = h('ul', { class: 'reading-list' }, ...works.sort((a, b) => Number(p.read.includes(a.slug)) - Number(p.read.includes(b.slug))).map((w) => {
      const read = p.read.includes(w.slug);
      const box = h('input', { type: 'checkbox', checked: read ? true : null, 'aria-label': `${t('reading.read')}: ${w.title}` });
      box.addEventListener('change', async () => { await setRead(path, w.slug, box.checked); redraw(); });
      const open = h('button', { type: 'button', class: 'icon-btn small reading-open', title: t('research.read'), 'aria-label': `${t('research.read')}: ${w.title}`, html: icon('book') });
      open.addEventListener('click', () => { savePref('research.read', w.path); savePref('research.readFrom', nodeHref(path)); go('#/m/scraper'); });
      return h('li', { class: read ? 'read' : '' }, h('label', {}, box, h('span', { class: 'reading-title', text: w.title })), open);
    }));
    return h('div', {}, h('div', { class: 'reading-progress small' }, h('span', { text: t('reading.progress', { n: done, of: works.length }) }), bar), list);
  },

  // pinned cards and snippets, readable at a glance: the formula set, the code to copy
  pins(p, members, ctx) {
    const { path, redraw } = ctx;
    const nodes = p.pins.map((s) => nodeBySlug(s)).filter(Boolean);
    const box = h('div', { class: 'pins' });
    if (!nodes.length) box.append(h('p', { class: 'muted small', text: t('pins.none') }));
    for (const n of nodes) {
      const body = h('div', { class: 'pin-body' });
      const unpin = h('button', { type: 'button', class: 'icon-btn small', title: t('board.unpin'), 'aria-label': t('board.unpin'), html: icon('close') });
      unpin.addEventListener('click', async () => { await setPinned(path, n.slug, false); redraw(); });
      box.append(h('article', { class: 'pin' }, h('div', { class: 'pin-head' }, typeTile(n.type, 'small'), h('a', { href: nodeHref(n.path), class: 'pin-title', text: nodeTitle(n) }), unpin), body));
      if (n.code) {
        const copy = h('button', { type: 'button', class: 'btn small', onclick: async () => { const ok = await copyText(n.code); toast(t(ok ? 'node.copied' : 'node.copyFailed'), ok ? 'ok' : 'error'); } }, iconEl('copy'), h('span', { text: t('node.copy') }));
        body.append(h('pre', { class: 'pin-code' }, h('code', { text: n.code.split('\n').slice(0, 8).join('\n') })), copy);
      } else {
        getNode(n.path).then((node) => {
          const tex = node ? firstFormula(node.body) || (node.body.match(/\$([^$\n]+)\$/) || [])[1] : '';
          if (tex) body.append(typeset(h('div', { class: 'pin-tex' }), tex, true));
          else body.append(h('p', { class: 'muted small', text: nodeLead(n, getLang()) }));
        }).catch(() => {});
      }
    }
    const add = h('button', { type: 'button', class: 'btn small' }, iconEl('plus'), h('span', { text: t('pins.add') }));
    add.addEventListener('click', () => pinPicker(p, ctx));
    box.append(add);
    return box;
  },

  // a scratch pad that calculates: "m = 9.11e-31", "v = 2e6", "m v^2 / 2" → the result beside each line
  calc(p, members, ctx) {
    const { path } = ctx;
    const area = h('textarea', { class: 'field code-edit calc-text', rows: '6', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', placeholder: 'c = 2.998e8\nm = 9.109e-31\nm c^2', 'aria-label': t('widget.calc') });
    area.value = p.calc;
    const out = h('ol', { class: 'calc-out', 'aria-live': 'polite' });
    const status = h('span', { class: 'muted small' });
    const draw = () => out.replaceChildren(...calcLines(area.value).map((r) => h('li', { class: r.error ? 'err' : r.name ? 'def' : '', title: r.error || '' }, r.text)));
    const save = debounce(async () => { try { if (await saveCalc(path, area.value)) status.textContent = t('research.saved'); } catch { status.textContent = t('research.saveFailed'); } }, 1200);
    area.addEventListener('input', () => { draw(); status.textContent = ''; save(); });
    draw();
    return h('div', {}, h('div', { class: 'calc' }, area, out), h('p', { class: 'muted small calc-hint' }, h('span', { text: t('calc.hint') }), ' ', status));
  },

  // a focus timer: 15, 25 or 50 minutes; finished sessions are written into the project
  timer(p, members, ctx) {
    const { path } = ctx;
    const box = h('div', { class: 'timer' });
    const clock = h('div', { class: 'timer-clock', 'aria-live': 'polite' });
    const btns = h('div', { class: 'btn-row timer-btns' });
    const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;   // local, as the sessions are written
    const today = day(new Date());
    const weekAgo = day(new Date(Date.now() - 6 * 864e5));
    const sum = (f) => p.time.filter(f).reduce((a, x) => a + x.minutes, 0);
    const stats = h('p', { class: 'muted small', text: t('timer.stats', { today: sum((x) => x.day === today), week: sum((x) => x.day >= weekAgo) }) });
    let tick = 0;
    const draw = () => {
      const s = loadPref('timer', null);
      const mine = s && s.path === path;
      if (mine) {
        const left = s.start + s.minutes * 60000 - Date.now();
        if (left <= 0) { finish(s); return; }
        clock.textContent = `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
        box.classList.add('running');
        btns.replaceChildren(h('button', { type: 'button', class: 'btn small timer-stop', onclick: () => { savePref('timer', null); draw(); } }, iconEl('stop'), h('span', { text: t('timer.stop') })));
        clearTimeout(tick);
        tick = setTimeout(() => { if (box.isConnected) draw(); }, 1000);
      } else {
        box.classList.remove('running');
        clock.textContent = s ? t('timer.elsewhere') : '–';
        btns.replaceChildren(...[15, 25, 50].map((m) => h('button', { type: 'button', class: 'btn small timer-start', dataset: { min: String(m) }, onclick: () => { savePref('timer', { path, start: Date.now(), minutes: m }); draw(); } }, h('span', { text: `${m} min` }))));
      }
    };
    const finish = async (s) => {
      savePref('timer', null);
      await addTime(path, s.minutes, new Date(s.start));
      toast(t('timer.done', { n: s.minutes }), 'ok', 6000);
      ctx.redraw();
    };
    draw();
    box.append(clock, btns, stats);
    return box;
  },

  // a date the project works towards, with the days left
  due(p, members, ctx) {
    const { path, redraw } = ctx;
    const box = h('div', { class: 'due' });
    if (p.due) {
      const days = Math.round((new Date(`${p.due}T00:00:00`) - new Date(new Date().toDateString())) / 864e5);
      box.classList.toggle('soon', days <= 3);
      box.append(h('div', { class: 'due-days' }, days === 0 ? h('b', { text: t('due.today') }) : [h('b', { text: String(Math.abs(days)) }), h('span', { text: t(days < 0 ? 'due.ago' : days === 1 ? 'due.day' : 'due.days') })]),
        h('p', { class: 'small', text: `${p.dueWhat ? `${p.dueWhat} · ` : ''}${new Date(`${p.due}T00:00:00`).toLocaleDateString(getLang() === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium' })}` }));
    } else box.append(h('p', { class: 'muted small', text: t('due.none') }));
    const edit = h('button', { type: 'button', class: 'btn small due-edit' }, iconEl('edit'), h('span', { text: t(p.due ? 'due.change' : 'due.set') }));
    edit.addEventListener('click', async () => {
      const date = h('input', { class: 'field', type: 'date', id: 'due-date', value: p.due || '' });
      const what = h('input', { class: 'field', type: 'text', id: 'due-what', value: p.dueWhat, placeholder: t('due.whatHint') });
      const ok = await modal({ title: t('widget.due'), body: h('div', { class: 'due-form' }, h('label', { class: 'set-field', for: 'due-date' }, h('span', { class: 'field-label', text: t('due.date') }), date), h('label', { class: 'set-field', for: 'due-what' }, h('span', { class: 'field-label', text: t('due.what') }), what)),
        actions: [...(p.due ? [{ label: t('due.clear'), value: 'clear' }] : []), { label: t('action.cancel'), value: null }, { label: t('action.save'), value: 'save', kind: 'primary' }] });
      if (ok === 'clear') { await setDue(path, ''); redraw(); } else if (ok === 'save' && await setDue(path, date.value, what.value)) redraw();
    });
    box.append(edit);
    return box;
  },

  // links to the outside: the repository, the Overleaf project, a course page
  links(p, members, ctx) {
    const { path, redraw } = ctx;
    const list = h('ul', { class: 'links-list' }, ...p.links2.map((l, i) => {
      const rm = h('button', { type: 'button', class: 'icon-btn small', title: t('action.remove'), 'aria-label': `${t('action.remove')}: ${l.title}`, html: icon('close') });
      rm.addEventListener('click', async () => { await removeLink(path, i); redraw(); });
      return h('li', {}, iconEl('external'), h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', text: l.title }), rm);
    }));
    const url = h('input', { class: 'field links-url', type: 'url', placeholder: 'https://…', 'aria-label': t('links.url'), inputmode: 'url', autocapitalize: 'off' });
    const title = h('input', { class: 'field links-title', type: 'text', placeholder: t('links.title'), 'aria-label': t('links.title') });
    const add = async () => {
      const u = url.value.trim();
      if (!/^https?:\/\/\S+$/.test(u)) { toast(t('links.bad'), 'error'); return; }
      if (await addLink(path, title.value, u)) redraw();
    };
    for (const f of [url, title]) f.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    return h('div', {}, p.links2.length ? list : h('p', { class: 'muted small', text: t('links.none') }), h('div', { class: 'links-add' }, url, title, h('button', { type: 'button', class: 'btn small', onclick: add }, iconEl('plus'))));
  },

  // the pages you write in the project, by chapter
  pages(p, members, ctx) {
    const { path, go } = ctx;
    const lang = getLang();
    const lib = members.find((n) => n.type === 'library');
    const box = h('div', { class: 'project-pages' });
    const write = h('button', { type: 'button', class: 'btn small', onclick: () => openWriting(path, { go }) }, iconEl('file'), h('span', { text: t('project.write') }));
    if (!lib) { box.append(h('p', { class: 'muted small', text: t('project.pages.empty') }), write); return box; }
    loadLibrary(lib.path).then((l) => {
      const chapters = l.chapters.filter((c) => c.pages.length);
      if (!chapters.length) { box.replaceChildren(h('p', { class: 'muted small', text: t('project.pages.empty') }), write); return; }
      box.replaceChildren(...chapters.map((c) => h('div', { class: 'project-chapter' },
        h('span', { class: 'muted small project-chapter-title', text: c.title }),
        h('ul', { class: 'members' }, c.pages.map((slug) => {
          const d = allNodes().find((x) => x.slug === slug && x.type === 'page');
          return d ? h('li', { class: 'member' }, h('button', { type: 'button', class: 'member-main project-page', onclick: () => openWriting(path, { page: d.path, go }) }, typeTile('page', 'small'),
            h('span', { class: 'member-text' }, h('span', { class: 'member-title', text: nodeTitle(d, lang) })))) : null;
        }).filter(Boolean)))), write);
    }).catch(() => {});
    return box;
  },

  // free notes of the project
  notes(p, members, ctx) {
    const { path } = ctx;
    const notes = h('textarea', { class: 'field project-notes', rows: '5', placeholder: t('project.notesHint'), 'aria-label': t('project.notes') });
    notes.value = p.notes;
    const saved = h('span', { class: 'muted small' });
    const save = async () => { try { if (await saveProjectNotes(path, notes.value)) saved.textContent = t('research.saved'); } catch { saved.textContent = t('research.saveFailed'); } };
    const later = debounce(save, 1200);
    notes.addEventListener('input', () => { saved.textContent = ''; later(); });
    notes.addEventListener('blur', () => { later.cancel?.(); save(); });
    return h('div', { class: 'project-notes-box' }, notes, saved);
  },
};

// The lines of the scratch pad: definitions (name = expression) carry on to the lines below.
export function calcLines(text) {
  const env = Object.create(null);
  const fmt = (v) => (!Number.isFinite(v) ? String(v) : Math.abs(v) !== 0 && (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-3) ? v.toExponential(6).replace(/\.?0+e/, 'e').replace('e+', 'e') : String(+v.toPrecision(8)));
  return String(text).split('\n').map((raw) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return { text: '' };
    const m = line.match(/^([a-zA-Zα-ω_][\wα-ω]*)\s*=\s*(.+)$/);
    const expr = m ? m[2] : line;
    try {
      const names = Object.keys(env);
      const v = compile(expr, names)(...names.map((k) => env[k]));
      if (m) env[m[1]] = v;
      return { text: m ? `${m[1]} = ${fmt(v)}` : `= ${fmt(v)}`, name: m ? m[1] : '' };
    } catch (e) {
      return { text: '?', error: String(e.message || e) };
    }
  });
}

function pinPicker(p, ctx) {
  const { path, redraw } = ctx;
  const input = h('input', { class: 'field', type: 'search', placeholder: t('pins.search'), 'aria-label': t('pins.search'), autocapitalize: 'off', spellcheck: 'false' });
  const list = h('ul', { class: 'members' });
  let changed = false;
  const draw = () => {
    const q = input.value.trim();
    const own = projectNodes(p.links).filter((n) => ['formula', 'definition', 'theorem', 'term', 'snippet', 'convention', 'recipe'].includes(n.type) && !p.pins.includes(n.slug));
    const hits = q ? searchNodes(q, { limit: 12, filter: (n) => n && !n.conflict && !p.pins.includes(n.slug) && n.type !== 'project' }) : own.slice(0, 12);
    list.replaceChildren(...(hits.length ? hits.map((n) => {
      const b = h('button', { type: 'button', class: 'btn small' }, iconEl('bookmark'), h('span', { text: t('board.pin') }));
      b.addEventListener('click', async () => { b.disabled = true; await addToProject(path, [n.slug]); await setPinned(path, n.slug, true); p.pins.push(n.slug); changed = true; b.replaceChildren(iconEl('check')); });
      return h('li', { class: 'member' }, h('span', { class: 'member-main' }, typeTile(n.type, 'small'), h('span', { class: 'member-text' }, h('span', { class: 'member-title', text: nodeTitle(n) }), h('span', { class: 'muted small member-lead', text: typeLabel(n.type) }))), b);
    }) : [h('li', { class: 'muted small', text: t('project.fromKnowledge.none') })]));
  };
  input.addEventListener('input', debounce(draw, 150));
  draw();
  modal({ title: t('pins.add'), body: h('div', {}, input, list), actions: [{ label: t('action.close'), value: true, kind: 'primary' }], onOpen: () => setTimeout(() => input.focus(), 60) }).then(() => { if (changed) redraw(); });
}

// ------------------------------------------------------------------ the drawer: the project in focus, from anywhere
// current: the path of the node on screen, if any; it can go into a section with one tap.
export async function openProjectDrawer({ go, current = '' } = {}) {
  const d = focusProject();
  if (!d) { go('#/m/projects'); return; }
  let p;
  try { p = await loadProject(d.path); } catch { go(nodeHref(d.path)); return; }
  const lang = getLang();
  const body = h('div', { class: 'drawer' });
  const sheet = openSheet(d.title, body, { onClose: () => {} });
  sheet.sheet.classList.add('project-drawer');
  const draw = async () => {
    p = await loadProject(d.path);
    const secs = boardOf(p);
    const node = current ? nodeByPath(current) : null;
    const open = h('button', { type: 'button', class: 'btn small primary drawer-open', onclick: () => { sheet.close(); go(nodeHref(d.path)); } }, iconEl('target'), h('span', { text: t('drawer.open') }));
    const next = p.steps.find((s) => !s.done);
    const parts = [h('div', { class: 'drawer-top' }, next ? h('p', { class: 'small' }, h('span', { class: 'muted', text: `${t('project.next')} ` }), h('span', { text: next.text })) : h('span'), open)];
    if (node && node.type !== 'project' && node.path !== d.path) {
      const inIt = p.links.includes(node.slug);
      const row = h('div', { class: 'drawer-here' }, h('p', { class: 'small', text: t(inIt ? 'drawer.move' : 'drawer.take', { title: nodeTitle(node, lang) }) }),
        h('div', { class: 'chips' }, ...secs.map((s) => {
          const c = h('button', { type: 'button', class: 'chip drawer-sec' }, h('span', { class: 'board-dot' }), h('span', { text: sectionTitle(s) }));
          paintSection(c, s.color);
          c.addEventListener('click', async () => {
            if (!inIt) await addToProject(d.path, [node.slug]);
            await placeItem(d.path, node.slug, s.id, -1);
            toast(t('drawer.done', { section: sectionTitle(s) }), 'ok');
            draw();
          });
          return c;
        })));
      parts.push(row);
    }
    for (const s of secs) {
      const col = h('section', { class: 'drawer-col' }, h('h3', {}, h('span', { class: 'board-dot' }), h('span', { text: sectionTitle(s) }), h('span', { class: 'count', text: String(s.items.length) })),
        h('ul', { class: 'drawer-items' }, ...s.items.slice(0, 8).map((n) => h('li', {}, h('a', { href: nodeHref(n.path), onclick: () => sheet.close() }, typeTile(n.type, 'small'), h('span', { text: nodeTitle(n, lang) })))),
          ...(s.items.length > 8 ? [h('li', { class: 'muted small', text: t('drawer.more', { n: s.items.length - 8 }) })] : [])));
      paintSection(col, s.color);
      parts.push(col);
    }
    body.replaceChildren(...parts);
  };
  await draw();
}
