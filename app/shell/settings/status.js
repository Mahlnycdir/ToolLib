// The control centre's network (0.25.0): this device in the middle, around it everything it talks to, each with a
// status light and one line of text, joined by a line in the colour of its state. A tap opens the settings page of
// that connection. Prepared for the hub: it already has its place and gets its light once the hub exists.
//
// States: ok (green), warn (amber), fail (red), busy (checking), off (not set up), planned (not built yet).
// Checks that need the network (the Mac helper) run once when the page opens and again on "Check again".
//
// For Python readers: `async () => { … }` is a coroutine; the tiles show "Checking…" first and are filled in when
// each answer arrives, independently of the others (like asyncio.gather without waiting for all).
import { h } from '../../services/ui.js';
import { icon } from '../../services/icons.js';
import { t } from '../../i18n/i18n.js';
import { defaultDevice, isConfigured, onSyncChange, syncSettings, syncState } from '../../services/sync.js';
import { hasHelper, hasWorker, helperReady, helperState, researchSettings, sourceOn } from '../../services/research.js';
import { SOURCES } from '../../services/research-sources.js';
import { pythonStorage } from '../../services/python.js';
import { isStandalone } from '../../services/pwa.js';
import { formatTime } from '../views.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (name, attrs = {}) => { const el = document.createElementNS(SVG, name); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

// The points around the device: id (= settings page), icon
const POINTS = [
  { id: 'knowledge', icon: 'git' },
  { id: 'helper', icon: 'server' },
  { id: 'research', icon: 'globe' },
  { id: 'kobra', icon: 'code' },
  { id: 'python', icon: 'py' },
  { id: 'hub', icon: 'chip', planned: true },
];

const readKobra = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(`kobra.git.${k}`) || 'null'); return v ?? fallback; } catch { return fallback; } };

// What each point says right now. Quick ones answer at once; the helper and Python answer a moment later.
const NOW = {
  knowledge() {
    if (!isConfigured()) return { state: 'off', text: t('control.off') };
    const s = syncState();
    if (s.busy) return { state: 'busy', text: t('control.k.busy') };
    if (s.error) return { state: 'fail', text: t('control.k.error') };
    if (!s.last?.time) return { state: 'warn', text: t('control.k.never') };
    const when = t('control.k.synced', { time: formatTime(s.last.time) });
    return { state: 'ok', text: s.pending ? `${when} · ${t('control.k.pending', { n: s.pending })}` : when };
  },
  helper() {
    return hasHelper() ? { state: 'busy', text: t('control.checking') } : { state: 'off', text: t('control.off') };
  },
  research() {
    const on = SOURCES.filter((src) => sourceOn(src.id)).length;
    return hasWorker() ? { state: 'ok', text: t('control.r.worker', { n: on }) } : { state: 'warn', text: t('control.r.direct', { n: on }) };
  },
  kobra() {
    if (!readKobra('token', '')) return { state: 'off', text: t('control.off') };
    const accounts = (Array.isArray(readKobra('accounts', [])) ? readKobra('accounts', []).length : 0) + 1;
    const repos = Array.isArray(readKobra('repos', [])) ? readKobra('repos', []).length : 0;
    return { state: 'ok', text: t('control.ko.ok', { accounts, repos }) };
  },
  python() { return { state: 'busy', text: t('control.checking') }; },
  hub() { return { state: 'planned', text: t('control.hub') }; },
};

// The slower ones.
const LATER = {
  async helper() {
    if (!hasHelper()) return null;
    await helperReady(researchSettings(), { fresh: true });
    const st = helperState();
    if (st.ok) return { state: 'ok', text: t('control.h.ok', { version: st.info?.version || '?' }) };
    if (st.info?.network === 'denied' || st.info?.network === 'prompt') return { state: 'warn', text: t('control.h.network') };
    if (st.info?.status === 401) return { state: 'fail', text: t('control.h.token') };
    return { state: 'fail', text: t('control.h.down') };
  },
  async python() {
    try {
      const s = await pythonStorage();
      if (s.complete) return { state: 'ok', text: t('control.p.ok') };
      if (s.stored) return { state: 'warn', text: t('control.p.part', { pct: Math.round((100 * s.stored) / s.total) }) };
      return { state: 'off', text: t('control.p.off') };
    } catch { return { state: 'off', text: t('control.p.off') }; }
  },
};

// Returns { el, stop }; stop() ends the listening (the shell calls it when the view goes).
export function connectionsMap({ onOpen }) {
  const map = h('div', { class: 'set-map' });
  const lines = svg('svg', { class: 'set-map-lines', 'aria-hidden': 'true' });
  const device = syncSettings().device || defaultDevice();
  const centre = h('div', { class: 'set-node centre', dataset: { id: 'device' } }, iconEl('device', 'set-node-icon'),
    h('span', { class: 'set-node-text' }, h('strong', { text: t('control.node.device') }), h('span', { class: 'muted small', text: device }),
      h('span', { class: 'muted small', text: t(isStandalone() ? 'control.d.app' : 'control.d.browser') })));
  map.append(lines, centre);
  const nodes = new Map();
  for (const p of POINTS) {
    const light = h('span', { class: 'set-light', 'aria-hidden': 'true' });
    const line = h('span', { class: 'muted small set-node-line' });
    const node = h(p.planned ? 'div' : 'button', { type: p.planned ? null : 'button', class: `set-node${p.planned ? ' planned' : ''}`, dataset: { id: p.id } },
      iconEl(p.icon, 'set-node-icon'), h('span', { class: 'set-node-text' }, h('strong', {}, h('span', { text: t(`control.node.${p.id}`) }), light), line));
    if (!p.planned) node.addEventListener('click', () => onOpen(p.id));
    nodes.set(p.id, { node, line });
    map.append(node);
  }
  const set = (id, s) => {
    const n = nodes.get(id);
    if (!n || !s) return;
    n.node.dataset.state = s.state;
    n.line.textContent = s.text;
    n.node.title = `${t(`control.node.${id}`)}: ${s.text}`;
    draw();
  };
  const refresh = () => {
    for (const p of POINTS) set(p.id, NOW[p.id]());
    for (const [id, fn] of Object.entries(LATER)) fn().then((s) => set(id, s)).catch(() => {});
  };

  // the lines: from the middle of the device to the middle of each point, whatever the layout (wide or phone)
  function draw() {
    if (!map.isConnected) return;
    const box = map.getBoundingClientRect();
    lines.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    lines.setAttribute('width', box.width);
    lines.setAttribute('height', box.height);
    const mid = (el) => { const r = el.getBoundingClientRect(); return [r.left - box.left + r.width / 2, r.top - box.top + r.height / 2]; };
    const [cx, cy] = mid(centre);
    lines.replaceChildren(...[...nodes.entries()].map(([id, n]) => {
      const [x, y] = mid(n.node);
      return svg('line', { x1: cx, y1: cy, x2: x, y2: y, class: `set-wire s-${n.node.dataset.state || 'off'}`, 'data-id': id });
    }));
  }
  const again = h('button', { type: 'button', class: 'btn small set-recheck' }, iconEl('refresh'), h('span', { text: t('control.recheck') }));
  again.addEventListener('click', refresh);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => draw()) : null;
  ro?.observe(map);
  const unSync = onSyncChange(() => set('knowledge', NOW.knowledge()));
  refresh();
  requestAnimationFrame(draw);
  return {
    el: h('div', { class: 'set-map-wrap' }, map, h('div', { class: 'btn-row' }, again)),
    stop: () => { ro?.disconnect(); unSync(); },
  };
}
