// The canvas of a project (0.27.0): the same cards as on the board, laid out freely like a mind map.
//
//   move       drag the empty surface (or one finger), zoom with ctrl + wheel or a pinch, 0 shows everything.
//              The trackpad moves the canvas once you clicked into it; before that it scrolls the page.
//   cards      drag a card to put it elsewhere, tap it to light up its threads, double-click (double-tap) opens it
//   threads    drag from the small dot at the right of a card onto another card (or switch on "Thread"): that ties
//              them, as a link in the knowledge (relations.js connect), so it shows in every project, in the
//              network and beside the node. Click a thread to let go of it. Thicker threads hold closer knowledge
//              (the same tension as in the network: same topic, same group, shared neighbours).
//   red thread "Red thread": tap the cards in the order you want (definition → formula → snippet …); they get
//              numbers, a glowing red line joins them, the board shows the numbers, every card offers back / next.
//   groups     frames with a name and a colour; dragging the name moves the cards inside along
//   notes      double-click the empty surface (or "Note"): what you type becomes a note of the project, right there
//
// Places and groups live in projects/<name>.canvas (canvas-store.js, JSON Canvas like Obsidian), the red thread in
// the project (`thread:`), threads in the nodes. Everything follows live: a link drawn elsewhere, a card added on
// the board, a sync from the phone.
//
// For Python readers: `state.cards` is a dict slug → box {x, y, w, h}; render once, then layout() moves the
// elements and drawLines() redraws the SVG with the threads. Two coordinate systems: world = where a card lies on
// the surface, screen = world × zoom + shift (state.k, state.tx, state.ty), like an affine transform in matplotlib.
import { h, toast, promptDialog, actionSheet, confirmDialog, debounce } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { nodeBySlug, onNodesChange } from '../services/search.js';
import { getNode } from '../services/nodes.js';
import { connect, disconnect, graph, isDrawn, onRelationsChange } from '../services/relations.js';
import { boardOf, loadProject, setThread } from '../services/projects.js';
import { capture } from '../services/notes.js';
import { loadCanvas, saveCanvas, canvasPathOf } from '../services/canvas-store.js';
import { onAnnounce } from '../services/channel.js';
import { firstFormula } from '../services/library-store.js';
import { nodeHref, nodeLead, nodeTitle, typeLabel, typeTile } from './node-view.js';
import { typeset } from './math.js';
import { PALETTE, COLOURS, colourVar, typeColour } from './colors.js';
import { tension } from './net-view.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (name, attrs = {}) => { const el = document.createElementNS(SVG, name); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const CARD_W = 230;
const MATH = new Set(['formula', 'theorem', 'definition', 'term']);
const GROUP_COLOURS = ['blue', 'violet', 'teal', 'green', 'orange', 'rose', 'yellow', 'slate'];
// JSON Canvas keeps colours as hex: a group is written with the light shade of its colour and read back to its name
const hexOf = (name) => PALETTE[name]?.[0] || PALETTE.slate[0];
const nameOf = (hex) => COLOURS.find((c) => PALETTE[c][0].toLowerCase() === String(hex || '').toLowerCase()) || 'slate';
// where you looked last per project, so a redraw of the page (after a quick note, say) keeps the view
const views = new Map();

// The cards of a project right now, from the relations (so a card added anywhere shows at once); libraries apart.
function membersOf(projectSlug) {
  const g = graph();
  return (g.out.get(projectSlug) || []).filter((e) => e.kind === 'member').map((e) => g.nodes.get(e.to)).filter((d) => d && d.type !== 'library');
}

// p: the loaded project; ctx: { path, go } as the board gets it. Returns the element; element.cleanup() stops it.
export function projectCanvas(p, ctx) {
  const { path, go } = ctx;
  const lang = getLang();
  const state = { cards: new Map(), groups: [], k: 1, tx: 40, ty: 40, thread: [...(p.thread || [])], mode: '', selected: null, hover: null, loaded: false, fitted: false, auto: false };
  const wrap = h('section', { class: 'pc', tabindex: '0', 'aria-label': t('canvas.title') });
  const world = h('div', { class: 'pc-world' });
  const lines = svg('svg', { class: 'pc-lines', 'aria-hidden': 'true' });
  const groupLayer = h('div', { class: 'pc-groups' });
  const cardLayer = h('div', { class: 'pc-cards' });
  const headLayer = h('div', { class: 'pc-group-heads' });   // names and corners of the groups, above the cards
  world.append(groupLayer, lines, cardLayer, headLayer);
  const hint = h('div', { class: 'pc-hint', hidden: true });
  const empty = h('div', { class: 'pc-empty', hidden: true, text: t('canvas.empty') });
  const pop = h('div', { class: 'pc-pop', hidden: true });
  const glowId = `pc-glow-${p.slug}`;

  // ---------------------------------------------------------------- the bar
  const btn = (key, name, fn, cls = '') => {
    const b = h('button', { type: 'button', class: `btn small ${cls}`, title: t(`${key}.hint`) }, iconEl(name), h('span', { text: t(key) }));
    b.addEventListener('click', fn);
    return b;
  };
  const linkBtn = btn('canvas.link', 'link', () => setMode(state.mode === 'link' ? '' : 'link'), 'pc-link');
  const threadBtn = btn('canvas.thread', 'thread', () => setMode(state.mode === 'thread' ? '' : 'thread'), 'pc-thread');
  const groupBtn = btn('canvas.group', 'blocks', () => addGroup(), 'pc-group-add');
  const noteBtn = btn('canvas.note', 'edit', () => { const r = wrap.getBoundingClientRect(); noteAt(toWorld(r.width / 2 - CARD_W / 2, r.height / 2 - 40)); }, 'pc-note');
  const fullBtn = h('button', { type: 'button', class: 'icon-btn pc-full-btn', title: t('canvas.full'), 'aria-label': t('canvas.full'), 'aria-pressed': 'false', html: icon('expand') });
  fullBtn.addEventListener('click', () => toggleFull());
  const zoomBtn = (key, name, fn, cls = '') => {
    const b = h('button', { type: 'button', class: `icon-btn ${cls}`, title: t(key), 'aria-label': t(key), html: icon(name) });
    b.addEventListener('click', fn);
    return b;
  };
  const zoomBox = h('div', { class: 'pc-zoom' },
    zoomBtn('net.zoomOut', 'minus', () => zoomAt(0.8), 'pc-out'),
    zoomBtn('net.fit', 'target', () => fit(), 'pc-fit'),
    zoomBtn('net.zoomIn', 'plus', () => zoomAt(1.25), 'pc-in'),
    fullBtn);
  const bar = h('div', { class: 'pc-bar' }, linkBtn, threadBtn, groupBtn, noteBtn);
  wrap.append(world, bar, zoomBox, hint, empty, pop);

  function setMode(m) {
    state.mode = m;
    wrap.dataset.mode = m;
    linkBtn.classList.toggle('on', m === 'link');
    threadBtn.classList.toggle('on', m === 'thread');
    linkBtn.setAttribute('aria-pressed', String(m === 'link'));
    threadBtn.setAttribute('aria-pressed', String(m === 'thread'));
    hint.hidden = !m;
    if (m === 'thread') {
      const clear = h('button', { type: 'button', class: 'link-btn pc-thread-clear', text: t('canvas.thread.clear') });
      clear.addEventListener('click', async () => {
        if (state.thread.length && await confirmDialog(t('canvas.thread'), t('canvas.thread.clear.confirm'), { okLabel: t('canvas.thread.clear'), danger: true })) saveThread([]);
      });
      const ready = h('button', { type: 'button', class: 'btn small primary pc-done', text: t('canvas.done') });
      ready.addEventListener('click', () => setMode(''));
      hint.replaceChildren(h('span', { text: t('canvas.thread.on') }), clear, ready);
    } else if (m === 'link') {
      const ready = h('button', { type: 'button', class: 'btn small primary pc-done', text: t('canvas.done') });
      ready.addEventListener('click', () => setMode(''));
      hint.replaceChildren(h('span', { text: t('canvas.link.on') }), ready);
    }
    hidePop();
  }

  // ---------------------------------------------------------------- camera
  const toWorld = (sx, sy) => ({ x: (sx - state.tx) / state.k, y: (sy - state.ty) / state.k });
  function applyView() {
    world.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.k})`;
    // the dot grid moves and grows with the surface
    wrap.style.backgroundSize = `${24 * state.k}px ${24 * state.k}px, auto`;
    wrap.style.backgroundPosition = `${state.tx}px ${state.ty}px, 0 0`;
    if (state.fitted) views.set(path, { k: state.k, tx: state.tx, ty: state.ty });
  }
  function zoomAt(f, sx, sy) {
    const r = wrap.getBoundingClientRect();
    sx ??= r.width / 2; sy ??= r.height / 2;
    const w0 = toWorld(sx, sy);
    state.k = Math.min(2.5, Math.max(0.2, state.k * f));
    state.tx = sx - w0.x * state.k; state.ty = sy - w0.y * state.k;
    state.fitted = true;   // you took over the view
    applyView();
  }
  // everything in sight, not larger than 1.2 (before the cards are known it waits: sync() calls it again)
  function fit() {
    const boxes = [...state.cards.values(), ...state.groups];
    const r = wrap.getBoundingClientRect();
    if (!boxes.length || !r.width) { state.k = 1; state.tx = 40; state.ty = 70; applyView(); return; }
    const x0 = Math.min(...boxes.map((b) => b.x)); const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w)); const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    const top = 64; const pad = 28;
    state.k = Math.min(1.2, Math.max(0.2, Math.min((r.width - pad * 2) / (x1 - x0 || 1), (r.height - top - pad) / (y1 - y0 || 1))));
    state.tx = (r.width - (x1 - x0) * state.k) / 2 - x0 * state.k;
    state.ty = top + (r.height - top - pad - (y1 - y0) * state.k) / 2 - y0 * state.k;
    state.fitted = true;
    applyView();
  }

  // ---------------------------------------------------------------- cards
  const els = new Map();   // slug → element
  function leadOf(d) {
    if (d.type === 'note') return d.at ? new Date(d.at).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB') : '';
    if (d.type === 'research') return t('research.kept', { n: d.clips?.length || 0 });
    return nodeLead(d, lang);
  }
  function cardEl(d) {
    const el = h('div', { class: `pc-card type-${d.type}`, dataset: { slug: d.slug }, tabindex: '0', role: 'button', 'aria-label': nodeTitle(d, lang) });
    el.style.setProperty('--c', colourVar(typeColour(d.type)));
    const body = h('div', { class: 'pc-card-body' });
    const lead = leadOf(d);
    if (lead) body.append(h('p', { class: 'pc-lead', text: lead }));
    // formulas show their formula, as on the board
    if (MATH.has(d.type)) {
      getNode(d.path).then((node) => {
        const tex = node ? firstFormula(node.body) || (node.body.match(/\$([^$\n]+)\$/) || [])[1] : '';
        if (tex) body.prepend(typeset(h('div', { class: 'pc-tex' }), tex, true));
      }).catch(() => {});
    }
    el.append(
      h('div', { class: 'pc-card-head' }, typeTile(d.type, 'small'),
        h('div', { class: 'pc-card-t' }, h('span', { class: 'pc-title', text: nodeTitle(d, lang) }), h('span', { class: 'pc-type', text: typeLabel(d.type) }))),
      body,
      h('span', { class: 'pc-num', hidden: true }),
      h('span', { class: 'pc-handle', title: t('canvas.handle') }));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); go(nodeHref(d.path)); }
      else if (e.key === ' ') { e.preventDefault(); tapCard(d.slug); }
    });
    return el;
  }
  // a card grows with its formula: the lines follow its real height
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    let changed = false;
    for (const en of entries) {
      const b = state.cards.get(en.target.dataset.slug);
      const hh = Math.round(en.target.offsetHeight);
      if (b && hh && Math.abs(b.h - hh) > 1) { b.h = hh; changed = true; }
    }
    if (!changed) return;
    if (state.auto) restack(); else drawLines();
  }) : null;
  // While the canvas still has its first layout (no file yet, nothing moved), the cards of each column close up
  // under each other by their real height, so a tall formula never covers the card below.
  function restack() {
    const cols = new Map();
    for (const b of state.cards.values()) { if (!cols.has(b.x)) cols.set(b.x, []); cols.get(b.x).push(b); }
    for (const list of cols.values()) {
      list.sort((a, b) => a.y - b.y);
      let y = list[0].y;
      for (const b of list) { b.y = y; y += b.h + 28; }
    }
    layout();
  }

  // Places for cards that have none yet: the board's sections side by side at the start, later beside a card
  // they hang on, or below everything.
  function placeMissing(members) {
    const missing = members.filter((d) => !state.cards.has(d.slug));
    if (!missing.length) return;
    if (!state.cards.size) {
      // a long section wraps into a second column, so the whole canvas stays readable at the start
      let x = 0;
      for (const s of boardOf(p, members)) {
        const rows = Math.max(3, Math.ceil(Math.sqrt(s.items.length * 1.5)));
        s.items.forEach((d, k) => state.cards.set(d.slug, { x: x + Math.floor(k / rows) * (CARD_W + 40), y: (k % rows) * 170, w: CARD_W, h: 110 }));
        x += Math.max(1, Math.ceil(s.items.length / rows)) * (CARD_W + 40) + 70;
      }
      return;
    }
    const g = graph();
    let below = Math.max(...[...state.cards.values()].map((b) => b.y + b.h)) + 60;
    for (const d of missing) {
      if (state.cards.has(d.slug)) continue;
      const near = [...(g.out.get(d.slug) || []), ...(g.in.get(d.slug) || [])].map((e) => (e.from === d.slug ? e.to : e.from)).find((s) => s !== p.slug && state.cards.has(s));
      if (near) { const b = state.cards.get(near); state.cards.set(d.slug, { x: b.x + CARD_W + 70, y: b.y + 24, w: CARD_W, h: 110 }); }
      else { state.cards.set(d.slug, { x: 0, y: below, w: CARD_W, h: 110 }); below += 150; }
    }
  }

  // brings the elements in line with the project's cards (new ones, gone ones) and lays them out
  function sync() {
    const members = membersOf(p.slug);
    const slugs = new Set(members.map((d) => d.slug));
    placeMissing(members);
    for (const [slug, el] of els) if (!slugs.has(slug)) { ro?.unobserve(el); el.remove(); els.delete(slug); }
    for (const d of members) {
      if (els.has(d.slug)) continue;
      const el = cardEl(d);
      els.set(d.slug, el);
      cardLayer.append(el);
      ro?.observe(el);
    }
    for (const slug of [...state.cards.keys()]) if (!slugs.has(slug)) state.cards.delete(slug);
    if (state.selected && !slugs.has(state.selected)) state.selected = null;
    empty.hidden = members.length > 0;
    layout();
    // the first time there are cards (the index may still have been building when the canvas opened): show them all
    if (!state.fitted && members.length && state.loaded) requestAnimationFrame(() => { if (!state.fitted) fit(); });
  }
  function layout() {
    for (const [slug, el] of els) {
      const b = state.cards.get(slug);
      if (!b) continue;
      el.style.transform = `translate(${b.x}px, ${b.y}px)`;
      el.classList.toggle('sel', slug === state.selected);
      const n = state.thread.indexOf(slug);
      const num = el.querySelector('.pc-num');
      num.hidden = n < 0;
      num.textContent = n < 0 ? '' : String(n + 1);
      el.classList.toggle('in-thread', n >= 0);
    }
    drawGroups();
    drawLines();
  }

  // ---------------------------------------------------------------- threads (one SVG over the whole surface)
  const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  // where the straight line from the middle of box b toward point q leaves the box (a little outside)
  function edgePoint(b, q) {
    const c = centre(b); const dx = q.x - c.x; const dy = q.y - c.y;
    if (!dx && !dy) return c;
    const s = Math.min((b.w / 2 + 5) / Math.abs(dx || 1e-9), (b.h / 2 + 5) / Math.abs(dy || 1e-9));
    return { x: c.x + dx * s, y: c.y + dy * s };
  }
  // a gentle curve from a to b (a quadratic Bézier, the control point pushed sideways), and its middle
  function curve(a, b, bend = 0.12) {
    const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
    const cx = mx - (b.y - a.y) * bend; const cy = my + (b.x - a.x) * bend;
    return { d: `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`, mid: { x: (mx + cx) / 2, y: (my + cy) / 2 } };
  }
  // the threads between the cards of this canvas, each with its tension (1 … 3)
  let edges = [];
  function threadsNow() {
    const g = graph();
    const shown = new Set(state.cards.keys());
    const nb = new Map([...shown].map((s) => [s, new Set()]));
    const list = [];
    for (const s of shown) {
      for (const e of g.out.get(s) || []) {
        if (!shown.has(e.to) || e.kind === 'member') continue;
        list.push(e); nb.get(s).add(e.to); nb.get(e.to).add(s);
      }
    }
    return list.map((e) => ({ ...e, strength: tension(g.nodes.get(e.from), g.nodes.get(e.to), e.kind, nb.get(e.from), nb.get(e.to)) }));
  }
  let rubber = null;   // the line you are drawing: { a, b } in world coordinates
  function drawLines() {
    edges = threadsNow();
    // the SVG covers all cards with some room, so every line lies inside it (Safari hit-tests only there)
    const boxes = [...state.cards.values()];
    const x0 = Math.min(0, ...boxes.map((b) => b.x)) - 300; const y0 = Math.min(0, ...boxes.map((b) => b.y)) - 300;
    const x1 = Math.max(0, ...boxes.map((b) => b.x + b.w), rubber ? rubber.b.x : 0) + 300; const y1 = Math.max(0, ...boxes.map((b) => b.y + b.h), rubber ? rubber.b.y : 0) + 300;
    lines.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    lines.style.cssText = `left: ${x0}px; top: ${y0}px; width: ${x1 - x0}px; height: ${y1 - y0}px;`;
    const defs = svg('defs');
    const glow = svg('filter', { id: glowId, x: '-20%', y: '-20%', width: '140%', height: '140%' });
    glow.append(svg('feGaussianBlur', { stdDeviation: '4' }));
    defs.append(glow);
    lines.replaceChildren(defs);
    const lit = state.mode ? null : state.hover || state.selected;   // while ordering or tying nothing steps back
    edges.forEach((e, i) => {
      const A = state.cards.get(e.from); const B = state.cards.get(e.to);
      if (!A || !B) return;
      const a = edgePoint(A, centre(B)); const b = edgePoint(B, centre(A));
      const { d } = curve(a, b);
      // the thread runs from the colour of one card to the colour of the other
      const id = `pcg-${p.slug}-${i}`;
      const grad = svg('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      grad.append(svg('stop', { offset: '0', style: `stop-color: ${colourVar(typeColour(nodeBySlug(e.from)?.type))}` }),
        svg('stop', { offset: '1', style: `stop-color: ${colourVar(typeColour(nodeBySlug(e.to)?.type))}` }));
      defs.append(grad);
      const on = lit && (e.from === lit || e.to === lit);
      lines.append(
        svg('path', { d, class: `pc-line k-${e.kind}${on ? ' lit' : ''}${lit && !on ? ' dim' : ''}`, stroke: `url(#${id})`, 'stroke-width': (0.9 + 0.8 * e.strength).toFixed(2) }),
        svg('path', { d, class: 'pc-hit', 'data-from': e.from, 'data-to': e.to }));
    });
    // the red thread on top: a soft glow below, the line above, small arrows that show its direction
    const pts = state.thread.map((s) => state.cards.get(s)).filter(Boolean);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = edgePoint(pts[i], centre(pts[i + 1])); const b = edgePoint(pts[i + 1], centre(pts[i]));
      const { d, mid } = curve(a, b, 0.06);
      const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      lines.append(svg('path', { d, class: 'pc-red-glow', filter: `url(#${glowId})` }), svg('path', { d, class: 'pc-red' }),
        svg('path', { d: 'M-6,-5 L5,0 L-6,5 Z', class: 'pc-red-arrow', transform: `translate(${mid.x.toFixed(1)},${mid.y.toFixed(1)}) rotate(${ang.toFixed(1)})` }));
    }
    if (rubber) lines.append(svg('path', { d: `M${rubber.a.x},${rubber.a.y} L${rubber.b.x},${rubber.b.y}`, class: 'pc-rubber' }));
    // the cards of a lit card stand out, the others step back
    const near = new Set(lit ? edges.filter((e) => e.from === lit || e.to === lit).flatMap((e) => [e.from, e.to]) : []);
    for (const [slug, el] of els) { el.classList.toggle('near', !!lit && near.has(slug) && slug !== lit); el.classList.toggle('far', !!lit && !near.has(slug) && slug !== lit); }
  }

  // ---------------------------------------------------------------- groups
  // the frame lies below the cards; its name (to drag it) and its corner (to resize it) lie above them, so a card
  // placed on the edge never hides them
  function drawGroups() {
    const frames = []; const heads = [];
    for (const gr of state.groups) {
      const colour = colourVar(nameOf(gr.color));
      const frame = h('div', { class: 'pc-group', dataset: { id: gr.id } });
      frame.style.cssText = `transform: translate(${gr.x}px, ${gr.y}px); width: ${gr.w}px; height: ${gr.h}px;`;
      frame.style.setProperty('--g', colour);
      const menu = h('button', { type: 'button', class: 'icon-btn small pc-group-menu', 'aria-label': t('canvas.group.menu'), title: t('canvas.group.menu'), html: icon('more') });
      menu.addEventListener('click', () => groupMenu(gr));
      const head = h('div', { class: 'pc-group-head', dataset: { id: gr.id } }, h('span', { class: 'pc-group-label', text: gr.label || t('canvas.group.untitled') }), menu);
      head.style.cssText = `transform: translate(${gr.x}px, ${gr.y}px); max-width: ${Math.max(60, gr.w - 12)}px;`;
      head.style.setProperty('--g', colour);
      const size = h('span', { class: 'pc-group-size', dataset: { id: gr.id }, title: t('canvas.group.size') });
      size.style.transform = `translate(${gr.x + gr.w - 22}px, ${gr.y + gr.h - 22}px)`;
      size.style.setProperty('--g', colour);
      frames.push(frame); heads.push(head, size);
    }
    groupLayer.replaceChildren(...frames);
    headLayer.replaceChildren(...heads);
  }
  async function addGroup() {
    const label = await promptDialog(t('canvas.group'), { label: t('canvas.group.name'), placeholder: t('canvas.group.placeholder') });
    if (label == null) return;
    const r = wrap.getBoundingClientRect();
    const c = toWorld(r.width / 2, r.height / 2);
    const used = new Set(state.groups.map((g) => nameOf(g.color)));
    state.groups.push({ id: `g-${Date.now().toString(36)}`, x: Math.round(c.x - 240), y: Math.round(c.y - 160), w: 480, h: 320, label: label.trim().slice(0, 120), color: hexOf(GROUP_COLOURS.find((x) => !used.has(x)) || 'slate') });
    layout();
    scheduleSave();
  }
  async function groupMenu(gr) {
    const pick = await actionSheet(gr.label || t('canvas.group.untitled'), [
      { label: t('canvas.group.rename'), value: 'rename', icon: 'edit' },
      ...GROUP_COLOURS.map((c) => ({ label: t(`colour.${c}`), value: `c:${c}`, icon: 'dot', color: hexOf(c) })), '-',
      { label: t('canvas.group.delete'), value: 'delete', icon: 'trash', danger: true },
    ]);
    if (!pick) return;
    if (pick === 'rename') {
      const v = await promptDialog(t('canvas.group.rename'), { value: gr.label, label: t('canvas.group.name') });
      if (v == null) return;
      gr.label = v.trim().slice(0, 120);
    } else if (pick === 'delete') state.groups = state.groups.filter((g) => g !== gr);
    else if (pick.startsWith('c:')) gr.color = hexOf(pick.slice(2));
    layout();
    scheduleSave();
  }

  // ---------------------------------------------------------------- a note written on the canvas: a note of the project
  function noteAt(pos) {
    if (cardLayer.querySelector('.pc-new-note')) return;
    const box = h('div', { class: 'pc-new-note' });
    const ta = h('textarea', { class: 'field', rows: 3, placeholder: t('canvas.note.placeholder'), 'aria-label': t('canvas.note') });
    box.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)`;
    box.append(ta, h('span', { class: 'muted small', text: t('canvas.note.keys') }));
    cardLayer.append(box);
    ta.focus({ preventScroll: true });
    let done = false;
    const finish = async (keep) => {
      if (done) return;
      done = true;
      const text = ta.value.trim();
      box.remove();
      if (!keep || !text) return;
      try {
        const notePath = await capture(text, { project: path });
        const slug = notePath.slice(notePath.lastIndexOf('/') + 1).replace(/\.md$/, '');
        state.cards.set(slug, { x: Math.round(pos.x), y: Math.round(pos.y), w: CARD_W, h: 110 });
        sync();
        scheduleSave();
        toast(t('note.kept'), 'ok');
      } catch { toast(t('create.failed'), 'error', 5000); }
    };
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();   // the keys of the canvas and the app stay out while you write
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); wrap.focus({ preventScroll: true }); }
    });
    ta.addEventListener('blur', () => finish(true));
  }

  // ---------------------------------------------------------------- the red thread
  async function saveThread(list) {
    state.thread = list;
    layout();
    try { await setThread(path, list); } catch { toast(t('canvas.saveFailed'), 'error', 5000); }
    scheduleSave();   // the canvas file carries the red thread as lines for Obsidian
  }
  function tapCard(slug) {
    if (state.mode === 'thread') saveThread(state.thread.includes(slug) ? state.thread.filter((x) => x !== slug) : [...state.thread, slug]);
    else { state.selected = state.selected === slug ? null : slug; layout(); }
  }

  // ---------------------------------------------------------------- a click on a thread: what it is, let go of it
  function threadPop(from, to, sx, sy) {
    const da = nodeBySlug(from); const db = nodeBySlug(to);
    if (!da || !db) return;
    const close = h('button', { type: 'button', class: 'icon-btn small', 'aria-label': t('action.close'), html: icon('close') });
    close.addEventListener('click', hidePop);
    const kids = [h('div', { class: 'pc-pop-t' }, h('span', { text: `${nodeTitle(da, lang)} → ${nodeTitle(db, lang)}` }), close)];
    if (isDrawn(from, to)) {
      const rm = h('button', { type: 'button', class: 'btn small danger pc-unlink' }, iconEl('close'), h('span', { text: t('rel.remove') }));
      rm.addEventListener('click', async () => {
        hidePop();
        if (await disconnect(from, to) === true) toast(t('rel.removed'), 'ok', 5000, { label: t('delete.undo'), run: () => connect(from, to) });
      });
      kids.push(rm);
    } else kids.push(h('p', { class: 'muted small', text: t('canvas.thread.fixed') }));
    pop.replaceChildren(...kids);
    pop.hidden = false;
    pop.style.left = `${Math.max(8, Math.min(sx - 20, wrap.clientWidth - 280))}px`;
    pop.style.top = `${Math.max(60, Math.min(sy + 10, wrap.clientHeight - 130))}px`;
  }
  function hidePop() { pop.hidden = true; }

  // ---------------------------------------------------------------- pointer: pan, pinch, drag cards and groups, draw threads
  // With pointer capture every later event goes to `wrap`, so what lies under the finger is asked with elementFromPoint.
  const pointers = new Map();
  let drag = null;
  const local = (e) => { const r = wrap.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const under = (e) => document.elementFromPoint(e.clientX, e.clientY);
  const OWN = '.pc-bar, .pc-zoom, .pc-pop, .pc-hint, .pc-new-note, .pc-group-menu, button, textarea, input, a';
  wrap.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest(OWN)) return;
    if (document.activeElement !== wrap && !wrap.contains(document.activeElement)) wrap.focus({ preventScroll: true });
    const s = local(e);
    pointers.set(e.pointerId, s);
    try { wrap.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
    hidePop();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (drag?.mode === 'card') els.get(drag.slug)?.classList.remove('dragging');
      drag = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), k0: state.k, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, tx: state.tx, ty: state.ty };
      rubber = null;
      return;
    }
    const card = e.target.closest('.pc-card');
    const hit = e.target.closest('.pc-hit');
    const groupHead = e.target.closest('.pc-group-head');
    const groupSize = e.target.closest('.pc-group-size');
    if (card && (e.target.closest('.pc-handle') || state.mode === 'link' || e.altKey)) {
      drag = { mode: 'link', slug: card.dataset.slug, sx: s.x, sy: s.y, moved: false };
      rubber = { a: centre(state.cards.get(card.dataset.slug)), b: toWorld(s.x, s.y) };
    } else if (card) {
      const b = state.cards.get(card.dataset.slug);
      drag = { mode: 'card', slug: card.dataset.slug, sx: s.x, sy: s.y, ox: b.x, oy: b.y, moved: false };
    } else if (groupSize) {
      const gr = state.groups.find((g) => g.id === groupSize.dataset.id);
      drag = { mode: 'size', gr, sx: s.x, sy: s.y, ow: gr.w, oh: gr.h, moved: false };
    } else if (groupHead) {
      const gr = state.groups.find((g) => g.id === groupHead.dataset.id);
      // the cards whose middle lies inside the frame move along
      const inside = [...state.cards.values()].filter((b) => { const c = centre(b); return c.x > gr.x && c.x < gr.x + gr.w && c.y > gr.y && c.y < gr.y + gr.h; }).map((b) => ({ b, ox: b.x, oy: b.y }));
      drag = { mode: 'group', gr, inside, sx: s.x, sy: s.y, ox: gr.x, oy: gr.y, moved: false };
    } else if (hit) {
      drag = { mode: 'hit', from: hit.dataset.from, to: hit.dataset.to, sx: s.x, sy: s.y, moved: false };
    } else {
      drag = { mode: 'pan', sx: s.x, sy: s.y, tx: state.tx, ty: state.ty, moved: false };
    }
  });
  wrap.addEventListener('pointermove', (e) => {
    const s = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, s);
    if (!drag) {
      // the mouse lights up the threads of the card below it
      if (e.pointerType !== 'mouse') return;
      const slug = e.target.closest?.('.pc-card')?.dataset.slug || null;
      if (slug !== state.hover) { state.hover = slug; drawLines(); }
      return;
    }
    if (drag.mode === 'pinch') {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const k = Math.min(2.5, Math.max(0.2, drag.k0 * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, drag.d0))));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const w0 = { x: (drag.mid.x - drag.tx) / drag.k0, y: (drag.mid.y - drag.ty) / drag.k0 };
      state.k = k; state.tx = mid.x - w0.x * k; state.ty = mid.y - w0.y * k;
      state.fitted = true;
      applyView();
      return;
    }
    const dx = s.x - drag.sx; const dy = s.y - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < (e.pointerType === 'mouse' ? 4 : 9)) return;
    drag.moved = true;
    if (drag.mode === 'pan') { state.tx = drag.tx + dx; state.ty = drag.ty + dy; state.fitted = true; applyView(); wrap.classList.add('panning'); }
    else if (drag.mode === 'card') {
      const b = state.cards.get(drag.slug);
      b.x = Math.round(drag.ox + dx / state.k); b.y = Math.round(drag.oy + dy / state.k);
      els.get(drag.slug)?.classList.add('dragging');
      layout();
    } else if (drag.mode === 'group') {
      drag.gr.x = Math.round(drag.ox + dx / state.k); drag.gr.y = Math.round(drag.oy + dy / state.k);
      for (const c of drag.inside) { c.b.x = Math.round(c.ox + dx / state.k); c.b.y = Math.round(c.oy + dy / state.k); }
      layout();
    } else if (drag.mode === 'size') {
      drag.gr.w = Math.max(180, Math.round(drag.ow + dx / state.k)); drag.gr.h = Math.max(120, Math.round(drag.oh + dy / state.k));
      drawGroups();
    } else if (drag.mode === 'link') {
      rubber.b = toWorld(s.x, s.y);
      const over = under(e)?.closest('.pc-card')?.dataset.slug;
      state.hover = over && over !== drag.slug ? over : drag.slug;
      drawLines();
    }
  });
  wrap.addEventListener('pointerup', async (e) => {
    pointers.delete(e.pointerId);
    const d = drag;
    if (!d) return;
    if (d.mode === 'pinch') { if (!pointers.size) drag = null; return; }
    drag = null;
    wrap.classList.remove('panning');
    if (d.mode === 'link') {
      rubber = null;
      const to = under(e)?.closest('.pc-card')?.dataset.slug;
      state.hover = null;
      drawLines();
      if (d.moved && to && to !== d.slug) {
        const ok = await connect(d.slug, to);
        if (ok) toast(t('net.linked', { a: nodeTitle(nodeBySlug(d.slug), lang), b: nodeTitle(nodeBySlug(to), lang) }), 'ok', 5000, { label: t('delete.undo'), run: () => disconnect(d.slug, to) });
        else toast(t('net.already'), 'info');
      } else if (!d.moved) tapCard(d.slug);
      return;
    }
    if (d.mode === 'card') {
      els.get(d.slug)?.classList.remove('dragging');
      if (d.moved) scheduleSave(); else tapCard(d.slug);
      return;
    }
    if (d.mode === 'group' || d.mode === 'size') { if (d.moved) scheduleSave(); return; }
    if (d.mode === 'hit' && !d.moved) { const s = local(e); threadPop(d.from, d.to, s.x, s.y); return; }
    if (d.mode === 'pan' && !d.moved && state.selected) { state.selected = null; layout(); }
  });
  wrap.addEventListener('pointercancel', (e) => {
    pointers.delete(e.pointerId);
    if (drag?.mode === 'card') els.get(drag.slug)?.classList.remove('dragging');
    drag = null; rubber = null;
    wrap.classList.remove('panning');
    drawLines();
  });
  wrap.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !drag && state.hover) { state.hover = null; drawLines(); } });

  // double-click (double-tap): on a card it opens the card, on the empty surface a note begins
  let lastTap = { at: 0, x: 0, y: 0 };
  wrap.addEventListener('dblclick', (e) => onDouble(e));
  wrap.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;   // the mouse has dblclick
    const now = performance.now();
    if (now - lastTap.at < 330 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 26) { lastTap = { at: 0, x: 0, y: 0 }; onDouble(e); }
    else lastTap = { at: now, x: e.clientX, y: e.clientY };
  });
  function onDouble(e) {
    if (state.mode) return;   // while ordering or tying, a second tap is just a tap
    const el = under(e);
    if (!el || !wrap.contains(el) || el.closest(`${OWN}, .pc-group-head, .pc-group-size, .pc-hit`)) return;
    const card = el.closest('.pc-card');
    if (card) { const d = nodeBySlug(card.dataset.slug); if (d) go(nodeHref(d.path)); return; }
    const s = local(e);
    noteAt(toWorld(s.x - 20, s.y - 20));
  }

  // Wheel and trackpad: ctrl (a pinch on the trackpad) zooms; plain scrolling moves the canvas once you are in it
  // (clicked, or full screen), before that it scrolls the page past the canvas.
  const wheelHint = debounce(() => { if (!state.mode) hint.hidden = true; }, 1600);
  wrap.addEventListener('wheel', (e) => {
    const engaged = wrap.classList.contains('pc-full') || wrap.contains(document.activeElement);
    if (!engaged && !e.ctrlKey && !e.metaKey) {
      if (!state.mode) { hint.replaceChildren(h('span', { text: t('canvas.wheel') })); hint.hidden = false; wheelHint(); }
      return;
    }
    e.preventDefault();
    const s = local(e);
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), s.x, s.y);
    else if (e.deltaMode === 1) zoomAt(Math.exp(-e.deltaY * 0.06), s.x, s.y);   // a mouse wheel in lines: zoom like a map
    else { state.tx -= e.deltaX; state.ty -= e.deltaY; state.fitted = true; applyView(); }
  }, { passive: false });
  wrap.addEventListener('keydown', (e) => {
    if (e.target.closest('textarea, input')) return;
    if (e.key === '+' || e.key === '=') zoomAt(1.25);
    else if (e.key === '-') zoomAt(0.8);
    else if (e.key === '0') fit();
    else if (e.key === 'Escape') { if (!pop.hidden) hidePop(); else if (state.mode) setMode(''); else if (wrap.classList.contains('pc-full')) toggleFull(); else return; }
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  function toggleFull() {
    const on = wrap.classList.toggle('pc-full');
    fullBtn.innerHTML = icon(on ? 'shrink' : 'expand');
    fullBtn.setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('pc-full-open', on);
    wrap.focus({ preventScroll: true });
    requestAnimationFrame(() => fit());
  }

  // ---------------------------------------------------------------- saving (a moment after the last change)
  const files = (slug) => nodeBySlug(slug)?.path || '';
  const save = debounce(async () => {
    try {
      const out = edges.map((e) => ({ from: e.from, to: e.to }));
      state.thread.forEach((s, i) => { if (state.thread[i + 1]) out.push({ from: s, to: state.thread[i + 1], color: '1', label: String(i + 1) }); });
      await saveCanvas(path, { cards: state.cards, groups: state.groups, files, edges: out });
    } catch (err) { console.warn('canvas save', err); toast(t('canvas.saveFailed'), 'error', 5000); }
  }, 700);
  // every save follows something you did: from then on the places are yours and stay as they are
  function scheduleSave() { state.auto = false; save(); }

  // ---------------------------------------------------------------- start, and live from then on
  async function load({ keepView = false } = {}) {
    let c;
    try { c = await loadCanvas(path); } catch { c = { cards: new Map(), groups: [] }; }
    if (drag) return;
    state.cards = c.cards;
    state.groups = c.groups;
    state.auto = !c.found;
    state.loaded = true;
    sync();
    if (keepView) return;
    const seen = views.get(path);
    if (seen) { Object.assign(state, seen, { fitted: true }); applyView(); } else requestAnimationFrame(() => fit());
  }
  // a link drawn or a card added anywhere (this window, another one, a sync): lay out again
  const stopRel = onRelationsChange(() => { if (!wrap.isConnected) { if (state.loaded) stopAll(); return; } if (!drag) sync(); });
  const stopNodes = onNodesChange((paths) => {
    if (!wrap.isConnected) return;
    // a sync brought files from another device: read the places again
    if (paths === null) { load({ keepView: true }); return; }
    // the red thread changed in the project (here, on the board, in another window): take it over
    if (paths.includes(path)) loadProject(path).then((fresh) => { if (fresh && !drag) { state.thread = [...fresh.thread]; layout(); } }).catch(() => {});
  });
  const stopWin = onAnnounce((msg) => { if (msg?.kind === 'canvas' && msg.path === canvasPathOf(path) && wrap.isConnected && !drag) load({ keepView: true }); });
  function stopAll() { stopRel(); stopNodes(); stopWin(); ro?.disconnect(); document.body.classList.remove('pc-full-open'); }
  wrap.cleanup = stopAll;
  applyView();
  load();
  return wrap;
}
