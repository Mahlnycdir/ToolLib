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
//              "Suggest" orders them along their derivations first (0.27.1); you change it by tapping.
//   groups     0.33.0: the groups are the sections of the project, the same as on the board (one structure for both,
//              with subgroups): every card lies in the frame of its section, the frame grows with its cards.
//              Drop a card into another frame and it moves to that section; drag a frame by its name and its cards
//              and subgroups move along; drop it inside another frame and it becomes a subgroup there. Groups of a
//              canvas from before 0.33.0 become sections the first time it opens.
//   notes      double-click the empty surface (or "Note"): what you type becomes a note of the project, right there
//
// Places and groups live in projects/<name>.canvas (canvas-store.js, JSON Canvas like Obsidian), the red thread in
// the project (`thread:`), threads in the nodes. Everything follows live: a link drawn elsewhere, a card added on
// the board, a sync from the phone.
//
// For Python readers: `state.cards` is a dict slug → box {x, y, w, h}; render once, then layout() moves the
// elements and drawLines() redraws the SVG with the threads. Two coordinate systems: world = where a card lies on
// the surface, screen = world × zoom + shift (state.k, state.tx, state.ty), like an affine transform in matplotlib.
import { h, toast, promptDialog, actionSheet, confirmDialog, debounce, loadPref, savePref } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { nodeBySlug, onNodesChange } from '../services/search.js';
import { getNode } from '../services/nodes.js';
import { connect, disconnect, graph, isDrawn, onRelationsChange } from '../services/relations.js';
import { addSection, boardOf, depthOfSection, loadProject, placeItem, removeSection, repairSections, sectionTree, sectionsOf, setSectionParent, setThread, suggestThread, updateSection } from '../services/projects.js';
import { capture } from '../services/notes.js';
import { loadCanvas, saveCanvas, canvasPathOf } from '../services/canvas-store.js';
import { onAnnounce } from '../services/channel.js';
import { firstFormula } from '../services/library-store.js';
import { nodeHref, nodeLead, nodeTitle, typeLabel, typeTile } from './node-view.js';
import { typeset } from './math.js';
import { renderMarkdown } from './markdown.js';
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
const adopting = new Set();   // 0.33.7: projects whose old groups are being taken over right now

// The cards of a project right now, from the relations (so a card added anywhere shows at once); libraries apart.
function membersOf(projectSlug) {
  const g = graph();
  return (g.out.get(projectSlug) || []).filter((e) => e.kind === 'member').map((e) => g.nodes.get(e.to)).filter((d) => d && d.type !== 'library');
}

// p: the loaded project; ctx: { path, go } as the board gets it. Returns the element; element.cleanup() stops it.
export function projectCanvas(p, ctx) {
  const { path, go } = ctx;
  const lang = getLang();
  let cur = p;   // the project as it stands now (its sections change while the canvas is open)
  const secName = (x) => x.title || (['collect', 'keep', 'apply'].includes(x.id) ? t(`station.${x.id}`) : x.id);
  const state = { cards: new Map(), frames: new Map(), k: 1, tx: 40, ty: 40, thread: [...(p.thread || [])], mode: '', selected: null, hover: null, loaded: false, fitted: false, auto: false };
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
      const suggest = h('button', { type: 'button', class: 'btn small pc-suggest', title: t('canvas.thread.suggest.hint') }, iconEl('wand'), h('span', { text: t('canvas.thread.suggest') }));
      suggest.addEventListener('click', () => suggestNow());
      const ready = h('button', { type: 'button', class: 'btn small primary pc-done', text: t('canvas.done') });
      ready.addEventListener('click', () => setMode(''));
      hint.replaceChildren(h('span', { text: t('canvas.thread.on') }), suggest, clear, ready);
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
    const boxes = [...state.cards.values(), ...rects().values()];
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
    // a note shows its text (0.31.0); drag the corner to give it more room
    if (d.type === 'note') noteText(d, body);
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
      h('span', { class: 'pc-handle', title: t('canvas.handle') }),
      h('span', { class: 'pc-size', title: t('canvas.size') }));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); go(nodeHref(d.path)); }
      else if (e.key === ' ') { e.preventDefault(); tapCard(d.slug); }
    });
    return el;
  }
  function noteText(d, body) {
    const box = body.querySelector('.pc-note-text') || body.appendChild(h('div', { class: 'pc-note-text' }));
    getNode(d.path).then((node) => {
      const text = node ? String(node.body || '').replace(/^\s*#\s.*\n?/, '').trim() : '';
      box.replaceChildren(text ? renderMarkdown(text) : '');
    }).catch(() => {});
  }
  // a card grows with its formula: the lines follow its real height
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    let changed = false;
    for (const en of entries) {
      const b = state.cards.get(en.target.dataset.slug);
      const hh = Math.round(en.target.offsetHeight);
      if (b && !b.sized && hh && Math.abs(b.h - hh) > 1) { b.h = hh; changed = true; }
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
      // the size you gave it (0.31.0); without one the card is as wide as all and as high as its content
      el.style.width = b.w && b.w !== CARD_W ? `${b.w}px` : '';
      el.style.height = b.sized ? `${b.h}px` : '';
      el.classList.toggle('sized', !!b.sized);
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
    // one line per pair of cards (0.31.0, ENTE: "wenn vor und zurück hinterlegt sind, nur ein Link"): a link both
    // ways or of two kinds draws once, with the strongest tension; `both` notes that it runs both ways
    const pairs = new Map();
    for (const e of list) {
      const key = e.from < e.to ? `${e.from}\n${e.to}` : `${e.to}\n${e.from}`;
      const strength = tension(g.nodes.get(e.from), g.nodes.get(e.to), e.kind, nb.get(e.from), nb.get(e.to));
      const had = pairs.get(key);
      if (!had) { pairs.set(key, { ...e, strength, both: false, back: null }); continue; }
      if (had.from !== e.from) { had.both = true; had.back = had.back || e; }
      if (strength > had.strength) Object.assign(had, { kind: e.kind, strength });
    }
    return [...pairs.values()];
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
        svg('path', { d, class: 'pc-hit', 'data-from': e.from, 'data-to': e.to, 'data-both': e.both ? '1' : null }));
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

  // ---------------------------------------------------------------- groups = the sections (0.33.0)
  // The frame of a section holds the boxes of its cards and of its subgroups (with room for the name above) and what
  // you gave it yourself (moved or sized: state.frames). skip: a card left out (the one you drag), so a frame does
  // not follow it while it moves.
  const PAD = 22; const HEAD = 40;
  // without: sections left out entirely (while you carry a group, so its old parent does not grow around it)
  function rects({ skip = '', without = null } = {}) {
    const board = boardOf(cur, membersOf(p.slug));
    const out = new Map();
    const order = [...board].sort((a, b) => depthOfSection(board, b.id) - depthOfSection(board, a.id));
    for (const sec of order) {
      if (without?.has(sec.id)) continue;
      const boxes = sec.items.filter((d) => d.slug !== skip).map((d) => state.cards.get(d.slug)).filter(Boolean);
      for (const c of board) if (c.parent === sec.id && out.has(c.id)) boxes.push(out.get(c.id));
      const own = state.frames.get(sec.id);
      if (!boxes.length && !own) continue;
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      for (const b of boxes) { x0 = Math.min(x0, b.x - PAD); y0 = Math.min(y0, b.y - HEAD); x1 = Math.max(x1, b.x + b.w + PAD); y1 = Math.max(y1, b.y + b.h + PAD); }
      if (own) { x0 = Math.min(x0, own.x); y0 = Math.min(y0, own.y); x1 = Math.max(x1, own.x + own.w); y1 = Math.max(y1, own.y + own.h); }
      out.set(sec.id, { id: sec.id, x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0), sec, depth: depthOfSection(board, sec.id) });
    }
    return out;
  }
  // the deepest frame at a point of the surface, leaving out the ones in `not`
  function frameAt(pt, all, not = new Set()) {
    let best = null;
    for (const r of all.values()) {
      if (not.has(r.id)) continue;
      // the deepest wins; among frames of one depth the smaller one (it is the more particular place)
      if (pt.x > r.x && pt.x < r.x + r.w && pt.y > r.y && pt.y < r.y + r.h && (!best || r.depth > best.depth || (r.depth === best.depth && r.w * r.h < best.w * best.h))) best = r;
    }
    return best;
  }
  // the deepest frame that holds box whole (0.33.6): a group you carry becomes a subgroup only when it lies wholly
  // inside another frame; touching one with its name is not enough (that put groups into each other by accident)
  function frameAround(box, all) {
    const tol = 10;
    let best = null;
    for (const r of all.values()) {
      if (!(r.x <= box.x + tol && r.y <= box.y + tol && r.x + r.w >= box.x + box.w - tol && r.y + r.h >= box.y + box.h - tol)) continue;
      if (!best || r.depth > best.depth || (r.depth === best.depth && r.w * r.h < best.w * best.h)) best = r;
    }
    return best;
  }
  // the frame lies below the cards; its name (to drag it) and its corner (to resize it) lie above them, so a card
  // placed on the edge never hides them
  function drawGroups(all = drag?.rects || rects()) {
    const frames = []; const heads = [];
    for (const gr of all.values()) {
      const colour = colourVar(gr.sec.color);
      const frame = h('div', { class: `pc-group${drag?.target === gr.id ? ' target' : ''}`, dataset: { id: gr.id, depth: String(gr.depth) } });
      frame.style.cssText = `transform: translate(${gr.x}px, ${gr.y}px); width: ${gr.w}px; height: ${gr.h}px;`;
      frame.style.setProperty('--g', colour);
      const menu = h('button', { type: 'button', class: 'icon-btn small pc-group-menu', 'aria-label': t('canvas.group.menu'), title: t('canvas.group.menu'), html: icon('more') });
      menu.addEventListener('click', () => groupMenu(gr.sec));
      const head = h('div', { class: 'pc-group-head', dataset: { id: gr.id } }, h('span', { class: 'pc-group-label', text: secName(gr.sec) }), h('span', { class: 'pc-group-n', text: String(gr.sec.items.length) }), menu);
      head.style.cssText = `transform: translate(${gr.x}px, ${gr.y}px); max-width: ${Math.max(60, gr.w - 12)}px;`;
      head.style.setProperty('--g', colour);
      const size = h('span', { class: 'pc-group-size', dataset: { id: gr.id }, title: t('canvas.group.size') });
      size.style.transform = `translate(${gr.x + gr.w - 22}px, ${gr.y + gr.h - 22}px)`;
      size.style.setProperty('--g', colour);
      frames.push(frame); heads.push(head, size);
    }
    groupLayer.replaceChildren(...frames.sort((a, b) => Number(a.dataset.depth) - Number(b.dataset.depth)));
    headLayer.replaceChildren(...heads);
  }
  // a new group is a new section, its frame where you look
  async function addGroup(parent = '') {
    const label = await promptDialog(parent ? t('board.sub.new') : t('canvas.group'), { label: t('canvas.group.name'), placeholder: t('canvas.group.placeholder') });
    if (!label || !label.trim()) return;
    const r = wrap.getBoundingClientRect();
    const c = toWorld(r.width / 2, r.height / 2);
    const used = new Set(sectionsOf(cur).map((x) => x.color));
    const up = parent ? rects().get(parent) : null;
    const id = await addSection(path, label.trim().slice(0, 120), GROUP_COLOURS.find((x) => !used.has(x)) || 'slate', parent);
    if (!id) return;
    state.frames.set(id, up ? { x: up.x + 30, y: up.y + up.h - 10, w: 300, h: 200 } : { x: Math.round(c.x - 200), y: Math.round(c.y - 130), w: 400, h: 260 });
    await reloadProject();
    scheduleSave();
  }
  async function groupMenu(sec) {
    const board = sectionsOf(cur);
    const pick = await actionSheet(secName(sec), [
      { label: t('canvas.group.rename'), value: 'rename', icon: 'edit' },
      ...GROUP_COLOURS.map((c) => ({ label: t(`colour.${c}`), value: `c:${c}`, icon: 'dot', color: hexOf(c) })), '-',
      ...(depthOfSection(board, sec.id) < 2 ? [{ label: t('board.sub.new'), value: 'sub', icon: 'plus' }] : []),
      ...(sec.parent ? [{ label: t('board.sub.out'), value: 'out', icon: 'arrowUp' }] : []),
      { label: t('canvas.group.delete'), value: 'delete', icon: 'trash', danger: true, disabled: board.length < 2 },
    ]);
    if (!pick) return;
    if (pick === 'rename') {
      const v = await promptDialog(t('canvas.group.rename'), { value: secName(sec), label: t('canvas.group.name') });
      if (v == null || !v.trim()) return;
      await updateSection(path, sec.id, { title: v.trim().slice(0, 120) });
    } else if (pick === 'sub') { await addGroup(sec.id); return; }
    else if (pick === 'out') { const up = board.find((x) => x.id === sec.parent); await setSectionParent(path, sec.id, up?.parent || ''); }
    else if (pick === 'delete') { if (await removeSection(path, sec.id)) state.frames.delete(sec.id); }
    else if (pick.startsWith('c:')) await updateSection(path, sec.id, { color: pick.slice(2) });
    await reloadProject();
    scheduleSave();
  }
  async function reloadProject() {
    try { const fresh = await loadProject(path); if (fresh) { cur = fresh; state.thread = [...fresh.thread]; } } catch { /* keeps the old one */ }
    layout();
  }
  // Groups from a canvas of before 0.33.0 (frames of their own) become sections, with the cards inside them.
  // 0.33.7: only once at a time per project (on 17.11. it ran twice for ENTE's thesis, from two loads of the canvas
  // before the first had saved, and every group came twice); a section of the same name is taken instead of a new
  // one; a group that lies wholly inside another becomes its subgroup; the canvas is saved at once.
  async function adoptOldGroups(old) {
    if (adopting.has(path)) return;
    adopting.add(path);
    try { await adoptNow(old); } finally { adopting.delete(path); }
  }
  async function adoptNow(old) {
    const known = new Set(sectionsOf(cur).map((x) => x.id));
    for (const g of old) if (known.has(g.id) && !g.auto) state.frames.set(g.id, { x: g.x, y: g.y, w: g.w, h: g.h });
    // only a canvas written before 0.33.0 (no frame of a section, none drawn by Loom) has groups of its own; a frame
    // of a section removed elsewhere is not brought back
    const before033 = old.length && !old.some((g) => g.auto || known.has(g.id));
    const strange = before033 ? old : [];
    if (!strange.length) { if (state.frames.size) layout(); await repairOnce(old); return; }
    const used = new Set();
    const idOf = new Map();
    for (const g of strange) {
      const name = (g.label || t('canvas.group.untitled')).slice(0, 120);
      const twin = sectionsOf(cur).find((x) => !used.has(x.id) && x.title.trim().toLowerCase() === name.trim().toLowerCase());
      const id = twin ? twin.id : await addSection(path, name, nameOf(g.color));
      if (!id) continue;
      used.add(id);
      idOf.set(g, id);
      state.frames.set(id, { x: g.x, y: g.y, w: g.w, h: g.h });
      for (const [slug, b] of state.cards) { const c = centre(b); if (c.x > g.x && c.x < g.x + g.w && c.y > g.y && c.y < g.y + g.h) await placeItem(path, slug, id, -1); }
    }
    const parents = {};
    for (const g of strange) { const outer = innermost(g, strange); if (outer && idOf.get(outer) && idOf.get(g)) parents[idOf.get(g)] = idOf.get(outer); }
    if (Object.keys(parents).length) await repairSections(path, { parents });
    markRepaired();
    await reloadProject();
    scheduleSave();
    save.flush();
    toast(t(strange.length === 1 ? 'canvas.groups.adopted.one' : 'canvas.groups.adopted', { n: strange.length }), 'ok', 6000);
  }
  const markRepaired = () => markCanvasRepaired(path);
  async function repairOnce(old) { if (await repairCanvasSections(path, cur, old)) await reloadProject(); }

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
  // "Suggest" (0.27.1): the red thread along the derivations (projects.js suggestThread), with Undo
  async function suggestNow() {
    const fresh = (await loadProject(path).catch(() => null)) || p;
    const list = suggestThread(fresh, membersOf(p.slug));
    if (list.length < 2) { toast(t('canvas.thread.suggest.none'), 'info'); return; }
    const was = [...state.thread];
    await saveThread(list);
    toast(t('canvas.thread.suggested', { n: list.length }), 'ok', 6000, { label: t('delete.undo'), run: () => saveThread(was) });
  }
  function tapCard(slug) {
    if (state.mode === 'thread') saveThread(state.thread.includes(slug) ? state.thread.filter((x) => x !== slug) : [...state.thread, slug]);
    else { state.selected = state.selected === slug ? null : slug; layout(); }
  }

  // ---------------------------------------------------------------- a click on a thread: what it is, let go of it
  function threadPop(from, to, sx, sy, both = false) {
    const da = nodeBySlug(from); const db = nodeBySlug(to);
    if (!da || !db) return;
    const close = h('button', { type: 'button', class: 'icon-btn small', 'aria-label': t('action.close'), html: icon('close') });
    close.addEventListener('click', hidePop);
    const kids = [h('div', { class: 'pc-pop-t' }, h('span', { text: `${nodeTitle(da, lang)} ${both ? '↔' : '→'} ${nodeTitle(db, lang)}` }), close)];
    // a line that runs both ways goes as a whole (both links, where they stand in the head)
    const ways = [[from, to], ...(both ? [[to, from]] : [])].filter(([a, b]) => isDrawn(a, b));
    if (ways.length) {
      const rm = h('button', { type: 'button', class: 'btn small danger pc-unlink' }, iconEl('close'), h('span', { text: t('rel.remove') }));
      rm.addEventListener('click', async () => {
        hidePop();
        const gone = [];
        for (const [a, b] of ways) if (await disconnect(a, b) === true) gone.push([a, b]);
        if (gone.length) toast(t('rel.removed'), 'ok', 5000, { label: t('delete.undo'), run: async () => { for (const [a, b] of gone) await connect(a, b); } });
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
    if (card && e.target.closest('.pc-size')) {
      const b = state.cards.get(card.dataset.slug);
      drag = { mode: 'csize', slug: card.dataset.slug, sx: s.x, sy: s.y, ow: b.w || CARD_W, oh: b.h, moved: false };
    } else if (card && (e.target.closest('.pc-handle') || state.mode === 'link' || e.altKey)) {
      drag = { mode: 'link', slug: card.dataset.slug, sx: s.x, sy: s.y, moved: false };
      rubber = { a: centre(state.cards.get(card.dataset.slug)), b: toWorld(s.x, s.y) };
    } else if (card) {
      const b = state.cards.get(card.dataset.slug);
      drag = { mode: 'card', slug: card.dataset.slug, sx: s.x, sy: s.y, ox: b.x, oy: b.y, moved: false, rects: rects({ skip: card.dataset.slug }) };
    } else if (groupSize) {
      const r = rects().get(groupSize.dataset.id);
      if (r) drag = { mode: 'size', id: r.id, x: r.x, y: r.y, sx: s.x, sy: s.y, ow: r.w, oh: r.h, moved: false };
    } else if (groupHead) {
      // the section, its subgroups, their cards and the frames you set move along
      const id = groupHead.dataset.id;
      const all = rects();
      const tree = new Set([id, ...sectionTree(sectionsOf(cur), id)]);
      const slugs = boardOf(cur, membersOf(p.slug)).filter((x) => tree.has(x.id)).flatMap((x) => x.items.map((d) => d.slug));
      const inside = slugs.map((slug) => state.cards.get(slug)).filter(Boolean).map((b) => ({ b, ox: b.x, oy: b.y }));
      const frames = [...tree].map((x) => [x, all.get(x)]).filter(([, r]) => r).map(([x, r]) => ({ id: x, ox: r.x, oy: r.y, w: r.w, h: r.h }));
      drag = { mode: 'group', id, tree, inside, frames, sx: s.x, sy: s.y, moved: false };
    } else if (hit) {
      drag = { mode: 'hit', from: hit.dataset.from, to: hit.dataset.to, both: hit.dataset.both === '1', sx: s.x, sy: s.y, moved: false };
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
      drag.target = frameAt(centre(b), drag.rects)?.id || '';
      layout();
    } else if (drag.mode === 'group') {
      for (const c of drag.inside) { c.b.x = Math.round(c.ox + dx / state.k); c.b.y = Math.round(c.oy + dy / state.k); }
      for (const f of drag.frames) state.frames.set(f.id, { x: Math.round(f.ox + dx / state.k), y: Math.round(f.oy + dy / state.k), w: f.w, h: f.h });
      const mine = drag.frames.find((f) => f.id === drag.id);
      const box = mine ? { x: mine.ox + dx / state.k, y: mine.oy + dy / state.k, w: mine.w, h: mine.h } : null;
      drag.target = box ? frameAround(box, rects({ without: drag.tree }))?.id || '' : '';
      layout();
    } else if (drag.mode === 'csize') {
      const b = state.cards.get(drag.slug);
      b.w = Math.max(150, Math.round(drag.ow + dx / state.k));
      b.h = Math.max(64, Math.round(drag.oh + dy / state.k));
      b.sized = true;
      layout();
    } else if (drag.mode === 'size') {
      state.frames.set(drag.id, { x: drag.x, y: drag.y, w: Math.max(180, Math.round(drag.ow + dx / state.k)), h: Math.max(120, Math.round(drag.oh + dy / state.k)) });
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
      if (!d.moved) { tapCard(d.slug); return; }
      // into another frame: the card moves to that section (on the board too)
      const now = boardOf(cur, membersOf(p.slug)).find((x) => x.items.some((y) => y.slug === d.slug));
      if (d.target && now && d.target !== now.id && await placeItem(path, d.slug, d.target, -1)) {
        const to = sectionsOf(cur).find((x) => x.id === d.target);
        toast(t('canvas.card.moved', { title: to ? secName(to) : '' }), 'ok');
        await reloadProject();
      } else layout();
      scheduleSave();
      return;
    }
    if (d.mode === 'group') {
      if (!d.moved) return;
      // dropped inside another frame: a subgroup there; outside every frame: back to the top
      const secs = sectionsOf(cur);
      const sec = secs.find((x) => x.id === d.id);
      const want = d.target && depthOfSection(secs, d.target) < 2 ? d.target : '';
      if (sec && (sec.parent || '') !== want && await setSectionParent(path, d.id, want)) {
        const to = secs.find((x) => x.id === want);
        toast(want ? t('board.sub.moved', { title: secName(to) }) : t('board.sub.top'), 'ok');
        await reloadProject();
      } else layout();
      scheduleSave();
      return;
    }
    if (d.mode === 'size' || d.mode === 'csize') { if (d.moved) scheduleSave(); return; }
    if (d.mode === 'hit' && !d.moved) { const s = local(e); threadPop(d.from, d.to, s.x, s.y, d.both); return; }
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
    // the corner: back to the width of all cards and the height of the content
    if (card && el.closest('.pc-size')) { const b = state.cards.get(card.dataset.slug); if (b) { b.sized = false; b.w = CARD_W; layout(); scheduleSave(); } return; }
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
      // every frame goes into the file (for Obsidian); the ones you did not set are marked auto and not read back
      const groups = [...rects().values()].map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, label: secName(r.sec), color: hexOf(r.sec.color), auto: !state.frames.has(r.id) }));
      await saveCanvas(path, { cards: state.cards, groups, files, edges: out });
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
    state.frames = new Map();
    const old = c.groups;
    state.auto = !c.found;
    state.loaded = true;
    sync();
    adoptOldGroups(old).catch((e) => console.warn('canvas groups', e));
    if (keepView) return;
    const seen = views.get(path);
    if (seen) { Object.assign(state, seen, { fitted: true }); applyView(); } else requestAnimationFrame(() => fit());
  }
  // a link drawn or a card added anywhere (this window, another one, a sync): lay out again
  const stopRel = onRelationsChange(() => { if (!wrap.isConnected) { if (state.loaded) stopAll(); return; } if (!drag) sync(); });
  const stopNodes = onNodesChange((paths) => {
    if (!wrap.isConnected) return;
    // a sync brought files from another device: read the places again
    if (paths === null) { load({ keepView: true }); for (const [slug, el] of els) { const d = nodeBySlug(slug); if (d?.type === 'note') noteText(d, el.querySelector('.pc-card-body')); } return; }
    // a note on the canvas was written: its text on the card follows
    for (const [slug, el] of els) { const d = nodeBySlug(slug); if (d?.type === 'note' && paths.includes(d.path)) noteText(d, el.querySelector('.pc-card-body')); }
    // the red thread changed in the project (here, on the board, in another window): take it over
    if (paths.includes(path)) loadProject(path).then((fresh) => { if (fresh && !drag) { cur = fresh; state.thread = [...fresh.thread]; layout(); } }).catch(() => {});
  });
  const stopWin = onAnnounce((msg) => { if (msg?.kind === 'canvas' && msg.path === canvasPathOf(path) && wrap.isConnected && !drag) load({ keepView: true }); });
  function stopAll() { stopRel(); stopNodes(); stopWin(); ro?.disconnect(); document.body.classList.remove('pc-full-open'); }
  wrap.cleanup = stopAll;
  applyView();
  load();
  return wrap;
}

// the smallest other frame that holds g wholly (10 px play)
function innermost(g, all) {
  let best = null;
  for (const o of all) {
    if (o === g || o.w * o.h <= g.w * g.h) continue;
    if (g.x >= o.x - 10 && g.y >= o.y - 10 && g.x + g.w <= o.x + o.w + 10 && g.y + g.h <= o.y + o.h + 10 && (!best || o.w * o.h < best.w * best.h)) best = o;
  }
  return best;
}
const markCanvasRepaired = (path) => savePref('canvas.repaired', [...new Set([...loadPref('canvas.repaired', []), path])].slice(-100));
// 0.33.7: a canvas adopted twice before 0.33.7 (sections twice, the first ones empty and without a frame) and groups
// lying inside others that were never made subgroups: tidied once per project on this device. The project page calls
// it too, so board and structure are tidy without opening the canvas. True when something changed.
export async function repairCanvasSections(path, cur, groups = null) {
  if (loadPref('canvas.repaired', []).includes(path)) return false;
  if (!groups) { try { groups = (await loadCanvas(path)).groups || []; } catch { return false; } }
  const secs = sectionsOf(cur);
  // a canvas that still has its old groups (before 0.33.0) is taken over by the canvas itself
  if (groups.length && !groups.some((g) => g.auto || secs.some((x) => x.id === g.id))) return false;
  const framed = new Map(groups.filter((g) => secs.some((x) => x.id === g.id)).map((g) => [g.id, g]));
  const filled = (x) => (cur.board?.[x.id] || []).length > 0 || framed.has(x.id) || secs.some((y) => y.parent === x.id);
  const drop = secs.filter((x) => !filled(x) && secs.some((y) => y !== x && y.title.trim().toLowerCase() === x.title.trim().toLowerCase() && filled(y))).map((x) => x.id);
  const parents = {};
  const frames = [...framed.values()];
  for (const g of frames) {
    if (secs.find((x) => x.id === g.id).parent) continue;
    const outer = innermost(g, frames);
    if (outer) parents[g.id] = outer.id;
  }
  markCanvasRepaired(path);
  if (!drop.length && !Object.keys(parents).length) return false;
  await repairSections(path, { drop, parents });
  toast(t('canvas.repaired', { n: drop.length, m: Object.keys(parents).length }), 'ok', 7000);
  return true;
}
