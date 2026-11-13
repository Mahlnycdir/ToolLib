// The network (0.26.0): how your knowledge hangs together, as a picture you can move through.
//
//   #/m/net             the last picture (a node in the middle, or the whole knowledge)
//   #/m/net/<slug>      this node in the middle, with what lies up to "depth" steps around it
//
// What is shown comes from services/relations.js (the same relations as beside every node), so a link made here,
// beside a node, in a project or brought by a sync shows at once. The picture itself is drawn by net-canvas.js.
//
// Settings of the picture (kept on this device, prefs "net.*"): middle or everything, depth, the maximum depth,
// the most dots at once, which kinds of relation, types, areas and which project, colour by type or by area.
// Maximum depth and most dots travel in the settings file (settings-file.js).
//
// For Python readers: state is a dict; scene() is a pure function from the knowledge and the state to the dots
// and lines; render() builds the page once and paint() fills it again whenever something changed.
import { h, toast, openSheet, actionSheet } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { loadPref, savePref } from '../services/prefs.js';
import { nodeBySlug } from '../services/search.js';
import { connect, disconnect, graph, neighbourhood, onRelationsChange, KINDS } from '../services/relations.js';
import { nodeHref, nodeTitle, typeLabel, typeTile } from './node-view.js';
import { areaColour, colourVar, typeColour } from './colors.js';
import { createNetCanvas } from './net-canvas.js';
import { linkFrom, pickNode, relationsPanel } from './link-ui.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

// ------------------------------------------------------------------ settings of the picture
export const LIMITS = { depth: [1, 8], nodes: [50, 1500] };
const DEFAULT = { mode: 'all', focus: '', depth: 2, kinds: KINDS, hideTypes: ['research'], hideAreas: [], project: '', colourBy: 'type', lonely: false, planes: 'auto' };
// planes in depth (ENTE, 13.11.): auto = by steps around a node, by area for everything; or by type, or none
export const PLANES = ['auto', 'steps', 'area', 'type', 'none'];
function loadState() {
  const s = { ...DEFAULT, ...loadPref('net.view', {}) };
  s.kinds = Array.isArray(s.kinds) ? s.kinds.filter((k) => KINDS.includes(k)) : KINDS;
  if (!PLANES.includes(s.planes)) s.planes = 'auto';
  return s;
}
export const maxDepth = () => clampInt(loadPref('net.maxDepth', 4), ...LIMITS.depth);
export const maxNodes = () => clampInt(loadPref('net.maxNodes', 400), ...LIMITS.nodes);
function clampInt(v, lo, hi) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; }

// The area of a node, for colours and filters: its own `area:`, or one from its kind.
export function areaOf(d) {
  if (d.area?.length) return String(d.area[0]).toLowerCase();
  if (d.type === 'snippet' || d.type === 'recipe') return 'programming';
  return '';
}

// ------------------------------------------------------------------ what to draw
// A pure function: from the relations and the state to { list, links, focus, total }.
export function scene(state) {
  const g = graph();
  const kinds = new Set(state.kinds);
  const hideTypes = new Set(state.hideTypes);
  const hideAreas = new Set(state.hideAreas);
  let ids;
  let dist = new Map();
  const focus = state.mode === 'focus' && g.nodes.has(state.focus) ? state.focus : '';
  if (focus) {
    const hub = (id) => { const ty = g.nodes.get(id)?.type; return ty === 'convention' || ty === 'project'; };
    const nb = neighbourhood(focus, { depth: Math.min(state.depth, maxDepth()), kinds: [...kinds], max: maxNodes() * 3, through: (id) => !hub(id) });
    dist = nb.nodes;
    ids = [...nb.nodes.keys()];
  } else {
    ids = [...g.nodes.keys()];
  }
  // the project: only what belongs to it (and the project itself)
  if (state.project && g.nodes.has(state.project)) {
    const own = new Set([state.project, ...(g.out.get(state.project) || []).map((e) => e.to)]);
    ids = ids.filter((id) => own.has(id) || id === focus);
  }
  ids = ids.filter((id) => {
    if (id === focus) return true;
    const d = g.nodes.get(id);
    return !hideTypes.has(d.type) && !hideAreas.has(areaOf(d) || '-');
  });
  const keep = new Set(ids);
  const links = [];
  const degree = new Map(ids.map((id) => [id, 0]));
  for (const id of ids) {
    for (const e of g.out.get(id) || []) {
      if (!kinds.has(e.kind) || !keep.has(e.to)) continue;
      links.push({ a: e.from, b: e.to, kind: e.kind });
      degree.set(e.from, degree.get(e.from) + 1);
      degree.set(e.to, degree.get(e.to) + 1);
    }
  }
  if (!state.lonely && !focus) ids = ids.filter((id) => degree.get(id) > 0);
  const total = ids.length;
  // too many: the nearest first (around a node), else the best connected
  if (ids.length > maxNodes()) {
    ids.sort((a, b) => (dist.get(a) ?? 0) - (dist.get(b) ?? 0) || degree.get(b) - degree.get(a) || a.localeCompare(b));
    ids = ids.slice(0, maxNodes());
    if (focus && !ids.includes(focus)) ids.push(focus);
  }
  const shown = new Set(ids);
  // tension of every line, and the hidden springs that gather each topic into its cloud
  const nb = new Map(ids.map((id) => [id, new Set()]));
  for (const e of links) if (shown.has(e.a) && shown.has(e.b)) { nb.get(e.a).add(e.b); nb.get(e.b).add(e.a); }
  for (const e of links) e.strength = tension(g.nodes.get(e.a), g.nodes.get(e.b), e.kind, nb.get(e.a), nb.get(e.b));
  const clouds = new Map();
  for (const id of ids) { const c = cloudOf(g.nodes.get(id)); if (c) { if (!clouds.has(c)) clouds.set(c, []); clouds.get(c).push(id); } }
  const hidden = [];
  for (const members of clouds.values()) {
    if (members.length < 3) continue;
    const core = members.reduce((best, id) => (degree.get(id) > degree.get(best) ? id : best), members[0]);
    for (const id of members) if (id !== core && !nb.get(id).has(core)) hidden.push({ a: id, b: core, kind: 'cloud', strength: 0.9, hidden: true });
  }
  const lang = getLang();
  // which plane each dot lives on
  const how = planesFor(state, focus);
  const keyOf = (id) => (how === 'steps' ? dist.get(id) ?? 0 : how === 'area' ? areaOf(g.nodes.get(id)) || '-' : how === 'type' ? typeGroup(g.nodes.get(id).type) : null);
  const planes = [];
  const layerOfKey = new Map();
  if (how !== 'none') {
    const count = new Map();
    for (const id of ids) count.set(keyOf(id), (count.get(keyOf(id)) || 0) + 1);
    const keys = [...count.keys()].sort(how === 'steps' ? (a, b) => a - b : how === 'type' ? (a, b) => TYPE_GROUPS.indexOf(a) - TYPE_GROUPS.indexOf(b) : (a, b) => count.get(b) - count.get(a) || String(a).localeCompare(String(b)));
    keys.forEach((k, i) => {
      layerOfKey.set(k, i);
      planes.push({ layer: i, key: k, colour: planeColour(how, k), label: planeLabel(how, k, count.get(k)) });
    });
  }
  const list = ids.map((id) => {
    const d = g.nodes.get(id);
    const deg = degree.get(id) || 0;
    return {
      id, type: d.type, area: areaOf(d), title: nodeTitle(d, lang), ring: dist.get(id) ?? null, cloud: cloudOf(d), layer: how === 'none' ? null : layerOfKey.get(keyOf(id)),
      colour: state.colourBy === 'area' ? (areaOf(d) ? areaColour(areaOf(d)) : 'slate') : typeColour(d.type),
      r: Math.min(14, 3.5 + Math.sqrt(deg) * 1.6 + (d.type === 'project' || d.type === 'topic' ? 3 : 0)),
      important: d.type === 'project' || d.type === 'topic' || d.type === 'library' || deg >= 8,
    };
  });
  return { list, links: [...links.filter((e) => shown.has(e.a) && shown.has(e.b)), ...hidden], focus, total, planes, how };
}

// The planes: what "auto" means, the groups of types, colours and names
export const planesFor = (state, focus) => (state.planes === 'auto' ? (focus ? 'steps' : 'area') : state.planes === 'steps' && !focus ? 'area' : state.planes);
const TYPE_GROUPS = ['own', 'cards', 'code', 'sources', 'other'];
function typeGroup(type) {
  if (['project', 'note', 'page', 'library'].includes(type)) return 'own';
  if (['formula', 'theorem', 'definition', 'term', 'convention', 'topic'].includes(type)) return 'cards';
  if (type === 'snippet' || type === 'recipe') return 'code';
  if (type === 'clip' || type === 'research') return 'sources';
  return 'other';
}
const STEP_COLOURS = ['teal', 'sky', 'blue', 'indigo', 'violet', 'rose', 'orange', 'yellow', 'lime'];
function planeColour(how, key) {
  if (how === 'steps') return STEP_COLOURS[Math.min(key, STEP_COLOURS.length - 1)];
  if (how === 'area') return key === '-' ? 'slate' : areaColour(key);
  return { own: 'violet', cards: 'rose', code: 'sky', sources: 'slate', other: 'lime' }[key] || 'slate';
}
function planeLabel(how, key, n) {
  if (how === 'steps') return key === 0 ? t('net.plane.middle') : t(key === 1 ? 'net.plane.step1' : 'net.plane.steps', { n: key });
  if (how === 'area') return `${areaLabel(key)} · ${n}`;
  return `${t(`net.group.${key}`)} · ${n}`;
}

// ------------------------------------------------------------------ tension: how closely two nodes belong together
// ENTE, 13.11.: "Mehr Tension heißt, die Themen korrelieren im Fachlichen mehr. So entstehen übersichtliche
// Netzwerk-Clouds." The strength of a line (about 0.15 to 3) sets how stiff and short its spring is (graph-layout.js):
//   kind      "follows from" binds most, a plain link well, a source or a library page less, a convention and a
//             project hardly (they reach across everything and would pull all into one lump)
//   substance the same topic, the same snippet group, the same area, shared tags
//   structure how many neighbours the two share (Jaccard overlap): two cards about the same thing link the same cards
const KIND_PULL = { derived: 1.6, link: 1, page: 0.8, cite: 0.5, member: 0.15, convention: 0.1 };
const overlap = (a, b) => { if (!a?.length || !b?.length) return 0; const B = new Set(b); return a.filter((x) => B.has(x)).length; };
export function tension(da, db, kind, nbA, nbB) {
  let sim = 0;
  if (overlap(da.topics, db.topics)) sim += 1;
  if (da.group && da.group === db.group) sim += 0.8;
  if (overlap(da.area, db.area)) sim += 0.3;
  sim += Math.min(0.6, overlap(da.tags, db.tags) * 0.2);
  if (nbA && nbB) {
    let both = 0;
    for (const x of nbA) if (nbB.has(x)) both++;
    const union = nbA.size + nbB.size - both;
    if (union) sim += 1.2 * (both / union);
  }
  return Math.min(3, (KIND_PULL[kind] ?? 1) * (1 + sim));
}
// The cloud a node belongs to: its first topic, or its snippet group; nodes of one cloud pull together a little even
// where no line joins them (hidden springs toward the best connected member of the cloud).
const cloudOf = (d) => (d.topics?.[0] ? `t:${d.topics[0]}` : d.group ? `g:${d.group}` : '');

// Types and areas present in the knowledge, for the filter (with how many of each).
function present() {
  const types = new Map(); const areas = new Map(); const projects = [];
  for (const d of graph().nodes.values()) {
    types.set(d.type, (types.get(d.type) || 0) + 1);
    const a = areaOf(d) || '-';
    areas.set(a, (areas.get(a) || 0) + 1);
    if (d.type === 'project') projects.push(d);
  }
  return { types: [...types].sort((a, b) => b[1] - a[1]), areas: [...areas].sort((a, b) => b[1] - a[1]), projects };
}

// ------------------------------------------------------------------ the view
export function renderNet(main, { slug = '' } = {}) {
  main.dataset.view = 'net';
  const state = loadState();
  if (slug && nodeBySlug(slug)) { state.mode = 'focus'; state.focus = slug; }
  const save = () => savePref('net.view', state);
  save();

  const box = h('div', { class: 'net-view' });
  const bar = h('div', { class: 'net-bar' });
  const stage = h('div', { class: 'net-stage' });
  const side = h('aside', { class: 'net-side', hidden: true, 'aria-live': 'polite' });
  const info = h('div', { class: 'net-info muted small' });
  const legend = h('div', { class: 'net-legend' });
  const hint = h('div', { class: 'net-hint', hidden: true });
  const empty = h('div', { class: 'net-empty', hidden: true });

  const positions = (() => { try { return loadPref('net.pos', {}) || {}; } catch { return {}; } })();
  const net = createNetCanvas({
    label: t('net.title'),
    insetTop: matchMedia('(max-width: 899px)').matches ? 56 : 64,
    onSelect: (id) => showSide(id),
    onOpen: (id) => { const d = nodeBySlug(id); if (d) location.hash = nodeHref(d.path); },
    onLink: (a, b) => linkNodes(a, b),
    onSettle: (kept) => {
      if (fitWhenSettled) { fitWhenSettled = false; fitNow(); }
      Object.assign(positions, kept);
      const keys = Object.keys(positions);
      if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete positions[k];
      savePref('net.pos', positions);
    },
  });
  net.layout.restore(positions);
  stage.append(net.el, legend, info, hint, empty);
  box.append(bar, h('div', { class: 'net-body' }, stage, side));
  main.append(box);

  // ---------------------------------------------------------------- the bar
  const centreBtn = h('button', { type: 'button', class: 'btn net-centre' });
  centreBtn.addEventListener('click', chooseCentre);
  const allBtn = h('button', { type: 'button', class: 'btn net-all', 'aria-pressed': 'false' }, iconEl('globe'), h('span', { text: t('net.all') }));
  allBtn.addEventListener('click', () => { state.mode = state.mode === 'all' ? (state.focus ? 'focus' : 'all') : 'all'; if (state.mode === 'all') replaceHash(''); else replaceHash(state.focus); update({ fit: true }); });
  const depthIn = h('input', { type: 'range', class: 'net-depth-in', min: 1, max: maxDepth(), step: 1, value: Math.min(state.depth, maxDepth()), 'aria-label': t('net.depth') });
  const depthVal = h('span', { class: 'net-depth-val' });
  const depth = h('label', { class: 'net-depth' }, h('span', { text: t('net.depth') }), depthIn, depthVal);
  depthIn.addEventListener('input', () => { state.depth = Number(depthIn.value); update({ fit: true }); });
  const filterBtn = h('button', { type: 'button', class: 'btn net-filter' }, iconEl('filter'), h('span', { text: t('net.filter') }), h('span', { class: 'count', hidden: true }));
  filterBtn.addEventListener('click', openFilter);
  const colourBtn = h('button', { type: 'button', class: 'btn net-colour' });
  colourBtn.addEventListener('click', () => { state.colourBy = state.colourBy === 'type' ? 'area' : 'type'; update(); });
  const planesBtn = h('button', { type: 'button', class: 'btn net-planes', title: t('net.planes.hint') });
  planesBtn.addEventListener('click', async () => {
    const pick = await actionSheet(t('net.planes'), PLANES.map((p) => ({ label: t(`net.planes.${p}`), value: p, icon: state.planes === p ? 'check' : 'dot' })));
    if (pick) { state.planes = pick; update({ fit: true }); }
  });
  const linkBtn = h('button', { type: 'button', class: 'btn net-link', 'aria-pressed': 'false', title: t('net.linkMode.hint') }, iconEl('link'), h('span', { text: t('net.linkMode') }));
  linkBtn.addEventListener('click', () => { net.setLinkMode(!net.linkMode); paintBar(); });
  // turning by itself: a calm view to look at; kept on this device
  const spinBtn = h('button', { type: 'button', class: 'icon-btn net-spin', 'aria-pressed': 'false' });
  const paintSpin = () => { const on = net.spin; spinBtn.innerHTML = icon(on ? 'pause' : 'play'); spinBtn.title = t(on ? 'net.spin.off' : 'net.spin.on'); spinBtn.setAttribute('aria-label', spinBtn.title); spinBtn.setAttribute('aria-pressed', String(on)); spinBtn.classList.toggle('on', on); };
  spinBtn.addEventListener('click', () => { net.setSpin(!net.spin); savePref('net.spin', net.spin); paintSpin(); });
  net.setSpin(loadPref('net.spin', false));
  paintSpin();
  const zoom = h('div', { class: 'net-zoom' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('net.zoomOut'), title: t('net.zoomOut'), html: icon('minus'), onclick: () => net.zoomBy(0.8) }),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('net.fit'), title: t('net.fit'), html: icon('maximize'), onclick: () => net.fit() }),
    h('button', { type: 'button', class: 'icon-btn net-front', 'aria-label': t('net.front'), title: t('net.front'), html: icon('refresh'), onclick: () => net.resetView() }),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('net.zoomIn'), title: t('net.zoomIn'), html: icon('plus'), onclick: () => net.zoomBy(1.25) }),
    spinBtn);
  const moreBtn = h('button', { type: 'button', class: 'icon-btn net-more', 'aria-label': t('net.more'), title: t('net.more'), html: icon('more') });
  moreBtn.addEventListener('click', openMore);
  bar.append(h('h1', { class: 'net-title', text: t('net.title') }), centreBtn, allBtn, depth, planesBtn, filterBtn, colourBtn, linkBtn, h('span', { class: 'net-gap' }), moreBtn);
  stage.append(zoom);   // zoom, show all, from the front: floating at the edge of the picture

  function paintBar() {
    const d = state.focus ? nodeBySlug(state.focus) : null;
    const focusMode = state.mode === 'focus' && d;
    centreBtn.replaceChildren(iconEl('target'), h('span', { class: 'net-centre-t', text: d ? nodeTitle(d) : t('net.pick') }));
    centreBtn.classList.toggle('on', !!focusMode);
    centreBtn.title = t('net.pick.hint');
    allBtn.setAttribute('aria-pressed', String(state.mode === 'all'));
    allBtn.classList.toggle('on', state.mode === 'all');
    depth.hidden = !focusMode;
    depthIn.max = String(maxDepth());
    depthIn.value = String(Math.min(state.depth, maxDepth()));
    depthVal.textContent = `${depthIn.value} / ${maxDepth()}`;
    const active = (KINDS.length - state.kinds.length) + state.hideTypes.filter((x) => x !== 'research').length + state.hideAreas.length + (state.project ? 1 : 0) + (state.lonely ? 1 : 0);
    const c = filterBtn.querySelector('.count');
    c.hidden = !active; c.textContent = String(active);
    planesBtn.replaceChildren(iconEl('blocks'), h('span', { text: t(`net.planes.short.${state.planes}`) }));
    colourBtn.replaceChildren(iconEl('palette'), h('span', { text: t(state.colourBy === 'type' ? 'net.byType.short' : 'net.byArea.short') }));
    colourBtn.title = `${t(state.colourBy === 'type' ? 'net.byType' : 'net.byArea')} · ${t('net.colour.hint')}`;
    planesBtn.title = `${t(`net.planes.${state.planes}`)} · ${t('net.planes.hint')}`;
    linkBtn.setAttribute('aria-pressed', String(net.linkMode));
    linkBtn.classList.toggle('on', net.linkMode);
    hint.hidden = !net.linkMode;
    hint.textContent = t('net.linkMode.on');
  }

  // ---------------------------------------------------------------- draw
  let shownScene = null;   // what is drawn right now
  function update({ fit = false, warm } = {}) {
    save();
    paintBar();
    const s = scene(state);
    shownScene = s;
    net.setData(s.list, s.links, { warm, planes: s.planes });
    net.setFocus(s.focus || null, { center: false });
    info.textContent = t('net.count', { n: s.list.length, m: s.links.filter((e) => !e.hidden).length }) + (s.total > s.list.length ? ` · ${t('net.capped', { n: s.total })}` : '');
    empty.hidden = s.list.length > 0;
    empty.textContent = t(state.mode === 'focus' ? 'net.empty.focus' : 'net.empty');
    paintLegend(s);
    // show everything once the dots stand still (and a first time soon, so the picture does not start empty)
    if (fit) { fitWhenSettled = true; setTimeout(fitNow, 260); }
  }
  let fitWhenSettled = false;
  // with planes the whole stack is framed; free in 3D the middle node stays in the middle
  const fitNow = () => { const f = state.mode === 'focus' && state.focus; if (f && planesFor(state, f) === 'none') net.fitAround(f); else net.fit(); };
  function paintLegend(s) {
    const seen = new Map();
    for (const nd of s.list) {
      const key = state.colourBy === 'type' ? nd.type : nd.area || '-';
      if (!seen.has(key)) seen.set(key, nd.colour);
    }
    const items = [...seen].slice(0, 9).map(([key, colour]) => {
      const dot = h('span', { class: 'net-dot' });
      dot.style.setProperty('--c', colourVar(colour));
      return h('span', { class: 'net-legend-item' }, dot, h('span', { text: state.colourBy === 'type' ? typeLabel(key) : areaLabel(key) }));
    });
    legend.replaceChildren(...items);
  }

  // ---------------------------------------------------------------- the chosen node
  let current = null;   // the node the side shows
  function showSide(id) {
    const d = id ? nodeBySlug(id) : null;
    current = d ? d.slug : null;
    side.hidden = !d;
    box.classList.toggle('side-open', !!d);
    if (!d) { side.replaceChildren(); return; }
    net.select(id);
    const open = h('a', { class: 'btn primary small', href: nodeHref(d.path) }, iconEl('arrowRight'), h('span', { text: t('net.open') }));
    const mid = h('button', { type: 'button', class: 'btn small net-mid' }, iconEl('target'), h('span', { text: t('net.middle') }));
    mid.addEventListener('click', () => setCentre(d.slug));
    const link = h('button', { type: 'button', class: 'btn small' }, iconEl('link'), h('span', { text: t('rel.link') }));
    link.addEventListener('click', () => linkFrom(nodeBySlug(d.slug) || d));
    const close = h('button', { type: 'button', class: 'icon-btn net-side-x', 'aria-label': t('action.close'), html: icon('close') });
    close.addEventListener('click', () => { net.select(null); showSide(null); });
    const area = areaOf(d);
    side.replaceChildren(
      h('div', { class: 'net-side-head' }, typeTile(d.type), h('div', { class: 'net-side-t' }, h('a', { class: 'net-side-title', href: nodeHref(d.path), text: nodeTitle(d) }),
        h('span', { class: 'muted small', text: [typeLabel(d.type), area && areaLabel(area)].filter(Boolean).join(' · ') })), close),
      h('div', { class: 'btn-row net-side-actions' }, open, mid, link),
      relationsPanel(d));
  }

  // ---------------------------------------------------------------- choosing the middle
  function replaceHash(slugNow) {
    const want = slugNow ? `#/m/net/${encodeURIComponent(slugNow)}` : '#/m/net';
    if (location.hash !== want) history.replaceState(history.state, '', want);
  }
  function setCentre(slugNow) {
    state.mode = 'focus';
    state.focus = slugNow;
    replaceHash(slugNow);
    update({ fit: true });
  }
  async function chooseCentre() {
    const d = await pickNode({ title: t('net.pick.title'), query: '' });
    if (d) setCentre(d.slug);
  }

  // ---------------------------------------------------------------- linking in the picture
  async function linkNodes(a, b) {
    const da = nodeBySlug(a); const db = nodeBySlug(b);
    if (!da || !db) return;
    const ok = await connect(a, b);
    if (ok) toast(t('net.linked', { a: nodeTitle(da), b: nodeTitle(db) }), 'ok', 5000, { label: t('delete.undo'), run: () => disconnect(a, b) });
    else toast(t('net.already'), 'info');
  }

  // ---------------------------------------------------------------- filter
  function openFilter() {
    const p = present();
    const group = (title, rows) => h('fieldset', { class: 'net-fs' }, h('legend', { text: title }), h('div', { class: 'net-checks' }, ...rows));
    const check = (label, on, change, colour) => {
      const input = h('input', { type: 'checkbox', checked: on });
      input.addEventListener('change', () => { change(input.checked); update(); });
      const dot = colour ? h('span', { class: 'net-dot' }) : null;
      if (dot) dot.style.setProperty('--c', colourVar(colour));
      return h('label', { class: 'net-check' }, input, dot, h('span', { text: label }));
    };
    const toggleIn = (list, value, on) => { const s = new Set(list); if (on) s.delete(value); else s.add(value); return [...s]; };
    const kinds = KINDS.map((k) => check(t(`net.kind.${k}`), state.kinds.includes(k), (on) => { state.kinds = on ? [...new Set([...state.kinds, k])] : state.kinds.filter((x) => x !== k); }));
    const types = p.types.map(([ty, n]) => check(`${typeLabel(ty)} (${n})`, !state.hideTypes.includes(ty), (on) => { state.hideTypes = toggleIn(state.hideTypes, ty, on); }, typeColour(ty)));
    const areas = p.areas.map(([a, n]) => check(`${areaLabel(a)} (${n})`, !state.hideAreas.includes(a), (on) => { state.hideAreas = toggleIn(state.hideAreas, a, on); }, a === '-' ? 'slate' : areaColour(a)));
    const proj = h('select', { class: 'field net-project' }, h('option', { value: '', text: t('net.project.any') }),
      ...p.projects.map((d) => h('option', { value: d.slug, text: nodeTitle(d), selected: d.slug === state.project })));
    proj.addEventListener('change', () => { state.project = proj.value; update({ fit: true }); });
    const lonely = check(t('net.lonely'), state.lonely, (on) => { state.lonely = on; });
    const reset = h('button', { type: 'button', class: 'btn small', text: t('net.filter.reset') });
    reset.addEventListener('click', () => { Object.assign(state, { kinds: KINDS, hideTypes: DEFAULT.hideTypes, hideAreas: [], project: '', lonely: false }); update({ fit: true }); closeSheet(); openFilter(); });
    const body = h('div', { class: 'net-filter-body' },
      h('label', { class: 'set-field' }, h('span', { class: 'field-label', text: t('net.project') }), proj),
      group(t('net.kinds'), kinds), group(t('net.types'), types), group(t('net.areas'), areas), lonely, h('div', { class: 'btn-row' }, reset));
    const closeSheet = openSheet(t('net.filter'), body);
  }

  // ---------------------------------------------------------------- more: limits, layout
  function openMore() {
    const num = (key, label, hint, value, [lo, hi], onSet) => {
      const input = h('input', { class: 'field', type: 'number', id: `net-${key}`, min: lo, max: hi, step: 1, value, inputmode: 'numeric' });
      input.addEventListener('change', () => { const v = clampInt(input.value, lo, hi); input.value = String(v); onSet(v); update({ fit: true }); });
      return h('label', { class: 'set-field', for: `net-${key}` }, h('span', { class: 'field-label', text: label }), input, h('span', { class: 'field-hint', text: hint }));
    };
    const relayout = h('button', { type: 'button', class: 'btn' }, iconEl('refresh'), h('span', { text: t('net.relayout') }));
    relayout.addEventListener('click', () => {
      for (const k of Object.keys(positions)) delete positions[k];
      savePref('net.pos', {});
      net.layout.restore({});
      net.setData([], []);
      update({ fit: true, warm: 1 });
      closeSheet();
    });
    const body = h('div', { class: 'net-more-body' },
      num('maxDepth', t('net.maxDepth'), t('net.maxDepth.hint'), maxDepth(), LIMITS.depth, (v) => { savePref('net.maxDepth', v); state.depth = Math.min(state.depth, v); }),
      num('maxNodes', t('net.maxNodes'), t('net.maxNodes.hint'), maxNodes(), LIMITS.nodes, (v) => savePref('net.maxNodes', v)),
      h('p', { class: 'muted small', text: t('net.relayout.hint') }), h('div', { class: 'btn-row' }, relayout));
    const closeSheet = openSheet(t('net.more'), body);
  }

  // ---------------------------------------------------------------- live
  // a relation changed (here, beside a node, in another window, by a sync): draw again, the dots stay in place
  const stopRel = onRelationsChange(() => {
    if (!box.isConnected) return;
    const keep = current;
    update({ warm: 0.12 });
    if (keep && nodeBySlug(keep)) net.select(keep); else if (keep) showSide(null);
  });
  // handles for the browser console and the tests: what is drawn right now
  const hooks = {
    __netAlpha: () => net.layout.alpha, __netCamera: () => net.camera, __netScreen: (id) => net.screenOf(id),
    __netIds: () => shownScene?.list.map((x) => x.id) || [], __netEdges: () => shownScene?.links.filter((e) => !e.hidden) || [],
    __netPlanes: () => shownScene?.planes || [],
  };
  Object.assign(window, hooks);
  main.cleanup = () => { stopRel(); net.destroy(); for (const k of Object.keys(hooks)) delete window[k]; };

  update({ fit: true });
  requestAnimationFrame(() => net.el.focus({ preventScroll: true }));
}

function areaLabel(a) {
  if (!a || a === '-') return t('net.area.none');
  const key = `area.${a}`;
  return t(key) === key ? a.charAt(0).toUpperCase() + a.slice(1) : t(key);
}

// ------------------------------------------------------------------ the small network beside every node
// The node and what is one step around it (two, when there is little), drawn once; a tap opens the big network
// with this node in the middle. Redraws itself when a relation changes; nothing when the node has no relations.
export function miniNet(d) {
  const box = h('a', { class: 'net-mini', href: `#/m/net/${encodeURIComponent(d.slug)}`, title: t('net.mini.hint'), 'aria-label': t('net.mini.hint') });
  // flat and laid out afresh each time (the places of the big 3D picture do not fit a flat one); the same picture
  // every time all the same, since start positions come from the names
  const net = createNetCanvas({ interactive: false, flat: true, fitOnResize: true, insetTop: 26, label: t('net.mini.hint') });
  const caption = h('span', { class: 'net-mini-cap' }, iconEl('net'), h('span', { text: t('net.title') }));
  box.append(net.el, caption);
  const draw = () => {
    const one = neighbourhood(d.slug, { depth: 1, max: 40 });
    const depth = one.nodes.size < 5 ? 2 : 1;
    const s = scene({ ...DEFAULT, mode: 'focus', focus: d.slug, depth, hideTypes: [], kinds: KINDS });
    box.hidden = s.list.length < 2;
    if (box.hidden) return;
    const list = s.list.slice(0, 40);
    net.setData(list, s.links, { warm: 1 });
    net.layout.fix(d.slug, false);
    net.layout.run(400);
    net.setFocus(d.slug, { center: false });
    net.fit(null, { animate: false });
    net.redraw();
  };
  draw();
  const stop = onRelationsChange(() => { if (!box.isConnected) { stop(); net.destroy(); return; } draw(); });
  return box;
}
