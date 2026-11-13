// The shell: command bar, module bar, workspace and status bar.
// Routes live in the URL hash: #/home (Start), #/settings (or #/settings/<section>), #/m/<module id>, #/n/<path of a node>,
// #/new (a new snippet of yours), #/edit/<path> (change one of yours) and #/src/<path> (any node as it is written).
// Since 0.15.0 the shell is built around one way of working: Start says where to begin, a project in focus takes in
// whatever you create, "+" creates anything from anywhere, and every node shows what it belongs to.
import { h, toast, modal, closeTopModal } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang, setLang, onLangChange } from '../i18n/i18n.js';
import { ACCENTS, READY, moduleById, paintAccent, setAccent } from './modules.js';
import { renderKladde } from './kladde-view.js';
import { renderKobra } from './kobra-view.js';
import { formatTime, renderModule, renderSettings } from './views.js';
import { applyUpdate, checkForUpdate, onPwaChange, pwaState } from '../services/pwa.js';
import { isConfigured, onSyncChange, phaseText, refreshPending, syncKnowledge, syncState } from '../services/sync.js';
import { bind, matches, keyTitle, withKeys, formatKeys, helpRows, onKeysChange, hasKeyboard } from '../services/keys.js';
import { bestProblem, buildIndex, indexState, nodeByPath, onIndexChange, refreshNode, searchDetailed, rememberPick } from '../services/search.js';
import { searchNote } from './search-note.js';
import { renderFormulary } from './formulary.js';
import { copyWithToast, nodeHref, nodeLead, nodeTitle, recentPaths, renderCheatsheet, renderNode, typeAccent, typeIcon, typeLabel } from './node-view.js';
import { renderSnippetForm } from './snippet-form.js';
import { queueSearch, renderResearch } from './research-view.js';
import { parseQuery } from '../services/research-merge.js';
import { onAnnounce } from '../services/channel.js';
import { startAutoSync } from '../services/autosync.js';
import { parseStart, resumeInterrupted } from '../services/crawl.js';
import { watchInbox } from '../services/pdf-inbox.js';
import { startBackground } from '../services/background.js';
import { savePref } from '../services/prefs.js';
import { getNode } from '../services/nodes.js';
import { renderStart } from './start.js';
import { renderSource } from './source-editor.js';
import { renderWrite } from './library-home.js';
import { paintProject, renderNote, renderProject, renderProjects } from './projects-view.js';
import { openProjectDrawer } from './project-board.js';
import { CREATORS, createMenu } from './create.js';
import { focusProject, onFocusChange, projects, startAutoLink } from '../services/projects.js';
import { capture } from '../services/notes.js';
import { mark } from '../services/trail.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
// The view of every tool that has one. A new tool: one line here and one in MODULES (modules.js).
const VIEWS = {
  projects: (main, mod, ctx) => renderProjects(main, mod, ctx),
  cheatsheet: (main, mod, ctx) => renderCheatsheet(main, mod, ctx),
  formulary: (main, mod) => renderFormulary(main, mod),
  scraper: (main, mod) => renderResearch(main, mod),
  kladde: (main, mod, ctx) => renderKladde(main, mod, ctx),
  kobra: (main) => renderKobra(main),
};
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export function startShell(root) {
  const app = h('div', { class: 'app' });
  const rail = h('nav', { class: 'rail', 'aria-label': t('nav.modules') });
  const cmd = h('div', { class: 'cmd' });
  const main = h('main', { class: 'main', tabindex: '-1' });
  const status = h('footer', { class: 'status' });
  const scrim = h('div', { class: 'scrim', onclick: () => setDrawer(false) });
  app.append(rail, cmd, main, status, scrim);
  root.replaceChildren(app);
  // The research window on its own (index.html?solo=1): only the workspace, no module bar.
  const solo = new URLSearchParams(location.search).has('solo');
  if (solo) {
    app.classList.add('solo');
    if (!location.hash || location.hash === '#/' || location.hash === '#/home') history.replaceState(history.state, '', '#/m/scraper');
  }
  paintAccent(document.documentElement, 'shell');

  // ---------------------------------------------------------------- routing
  function currentRoute() {
    if (location.hash.startsWith('#/n/')) {
      try { return { kind: 'node', path: location.hash.slice(4).split('/').map(decodeURIComponent).join('/') }; } catch { /* broken address */ }
    }
    if (location.hash.startsWith('#/edit/')) {
      try { return { kind: 'form', mode: 'edit', path: location.hash.slice(7).split('/').map(decodeURIComponent).join('/') }; } catch { /* broken address */ }
    }
    if (location.hash.startsWith('#/src/')) {
      try { return { kind: 'source', path: location.hash.slice(6).split('/').map(decodeURIComponent).join('/') }; } catch { /* broken address */ }
    }
    if (location.hash === '#/new') return { kind: 'form', mode: 'new' };
    const [, kind, id] = location.hash.split('/');
    if (kind === 'settings') return { kind: 'settings', section: id };
    // writing (0.16.0): the pages of a project; libraries are no tool of their own any more
    if (kind === 'm' && id === 'library') return { kind: 'write' };
    if (kind === 'm' && moduleById(id)) return { kind: 'module', mod: moduleById(id) };
    return { kind: 'home' };
  }

  function go(hash) {
    setDrawer(false);
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  // Every history entry remembers how far its view was scrolled, so Back returns to the same place (e.g. in the
  // cheatsheet). The entry gets an id in history.state the first time it is shown. The places are kept on the device
  // too (0.14.1.2): the iPhone drops the app while you are in another app and opens it again on the same page; Back
  // still returns to where you were.
  //
  // Since 0.22.0 a place is the row at the top of the view (a link into the knowledge, or an element with data-anchor)
  // and how far below the top it stood, not just a distance. The iPhone does not hold the place on its own when parts
  // above it come later or a view is drawn again, so the shell puts that row back:
  //  · on Back, and also on a new visit of the same view (Start, a tool, a project, a node), so you stay where you were;
  //  · when a view draws itself again in place (a project after you tick or pick something);
  // each time for a few seconds while the content still changes, until you touch, scroll or type yourself, or the view
  // moves somewhere on purpose (a section you asked for).
  const POS_KEY = 'toollib.scroll';
  const HASH_KEY = 'toollib.scroll.views';
  const readList = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || localStorage.getItem(k) || '[]'); } catch { return []; } };
  const positions = new Map(readList(POS_KEY));
  const byHash = new Map(readList(HASH_KEY));
  const keepPositions = () => {
    for (const [k, map, n] of [[POS_KEY, positions, 40], [HASH_KEY, byHash, 60]]) {
      try { const v = JSON.stringify([...map.entries()].slice(-n)); sessionStorage.setItem(k, v); localStorage.setItem(k, v); } catch { /* keeps working without */ }
    }
  };
  let shownEntry = null;
  let shownHash = '';
  let entrySeq = Date.now();
  function entryId() {
    let id = history.state?.toollibEntry;
    if (!id) {
      id = ++entrySeq;
      try { history.replaceState({ ...(history.state || {}), toollibEntry: id }, ''); } catch { /* keeps working without */ }
    }
    return id;
  }

  const ANCHORS = 'a[href^="#/"], [data-anchor]';
  const keyOf = (el) => el.getAttribute('data-anchor') || el.getAttribute('href');
  // a row in a part that stays put while you scroll (a sticky side panel or menu) does not mark the place
  const stays = (el) => { for (let x = el; x && x !== main; x = x.parentElement) { if (/sticky|fixed/.test(getComputedStyle(x).position)) return true; } return false; };
  const sameKey = (key) => [...main.querySelectorAll(ANCHORS)].filter((el) => keyOf(el) === key);
  // The place now: a row found by looking at a few points near the top of the view.
  function placeNow() {
    const y = main.scrollTop;
    if (y <= 0) return { y: 0 };
    const box = main.getBoundingClientRect();
    for (const dy of [12, 48, 96, 160, 240, 340]) {
      if (dy > box.height - 8) break;
      for (const fx of [0.5, 0.25, 0.75]) {
        const hit = document.elementFromPoint(box.left + box.width * fx, box.top + dy);
        const el = hit && main.contains(hit) ? hit.closest(ANCHORS) : null;
        if (!el || !main.contains(el) || stays(el)) continue;
        const key = keyOf(el);
        const n = sameKey(key).indexOf(el);
        return { y, key, n: Math.max(n, 0), dy: Math.round(el.getBoundingClientRect().top - box.top) };
      }
    }
    return { y };
  }
  // Puts the row back where it stood; without it (gone, or an old entry) the plain distance from the top.
  let lastSet = -1;
  function putBack(want) {
    // the same link can stand twice (a pinned card above, the card in its section): take the one nearest to where the
    // row stood, so a copy that appeared above does not pull the view up
    let el = null;
    if (want.key) {
      const top = main.getBoundingClientRect().top - main.scrollTop;
      const at = want.y + want.dy;
      let best = Infinity;
      sameKey(want.key).forEach((x, i) => {
        const d = Math.abs(x.getBoundingClientRect().top - top - at) + (i === want.n ? 0 : 0.5);
        if (d < best) { best = d; el = x; }
      });
    }
    if (el) {
      const shift = el.getBoundingClientRect().top - main.getBoundingClientRect().top - want.dy;
      if (Math.abs(shift) >= 1) main.scrollTop += shift;
    } else main.scrollTop = want.y;
    lastSet = main.scrollTop;
  }

  // the place you are at, kept up to date while you scroll (for a view that draws itself again)
  let lastPlace = { y: 0 };
  let placeFrame = 0;
  let keeping = null;
  main.addEventListener('scroll', () => {
    if (keeping) {
      // the view moved somewhere on purpose (not us, and not because the content got shorter): let it
      const max = main.scrollHeight - main.clientHeight;
      if (Math.abs(main.scrollTop - lastSet) > 2 && main.scrollTop < max - 1) keeping.stop('view');
      return;
    }
    if (!placeFrame) placeFrame = requestAnimationFrame(() => { placeFrame = 0; if (!keeping) lastPlace = placeNow(); });
  }, { passive: true });

  function keepPlace(want, token, ms = 5000) {
    keeping?.stop('again');
    if (token !== renderToken) return null;
    if (!want || (!want.y && !want.key)) { main.scrollTop = 0; lastPlace = { y: 0 }; return null; }
    const until = Date.now() + ms;
    let timer = 0;
    let frame = 0;
    const k = { why: '', stop: null, want };
    const watch = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; again(); }); });
    const user = () => k.stop('user');
    k.stop = (why) => {
      if (keeping !== k) return;
      keeping = null;
      k.why = why;
      clearTimeout(timer); cancelAnimationFrame(frame); watch.disconnect();
      for (const e of ['touchstart', 'wheel', 'keydown', 'pointerdown']) main.removeEventListener(e, user);
      lastPlace = placeNow();
    };
    keeping = k;
    for (const e of ['touchstart', 'wheel', 'keydown', 'pointerdown']) main.addEventListener(e, user, { passive: true });
    watch.observe(main, { childList: true, subtree: true });
    function again() {
      if (keeping !== k) return;
      if (token !== renderToken || Date.now() > until) { k.stop('done'); return; }
      putBack(want);
    }
    const tick = () => { again(); if (keeping === k) timer = setTimeout(tick, 150); };
    putBack(want);
    timer = setTimeout(tick, 150);
    return k;
  }

  function savePosition() {
    if (shownEntry === null) return;
    // still putting a place back (the content is coming): that place, not the half-drawn view
    const place = keeping ? keeping.want : placeNow();
    positions.delete(shownEntry);   // newest last, so the oldest go first
    positions.set(shownEntry, place);
    if (shownHash) { byHash.delete(shownHash); byHash.set(shownHash, place); }
    keepPositions();
  }
  const leaving = () => { if (document.visibilityState === 'hidden') savePosition(); };
  document.addEventListener('visibilitychange', leaving);
  window.addEventListener('pagehide', savePosition);

  // where an entry starts: its own place (Back), else the last place in the same view (a new visit)
  const startPlace = (entry, hash) => {
    const own = positions.get(entry);
    const saved = own !== undefined ? own : byHash.get(hash);
    return typeof saved === 'number' ? { y: saved } : saved || { y: 0 };
  };
  let restoring = null;
  const restoreScroll = (entry, token, { again = false } = {}) => {
    // a second try once a node is drawn, unless you or the view already took over
    if (again && (!restoring || restoring.token !== token || (restoring.k && restoring.k.why && restoring.k.why !== 'done'))) return;
    const k = keepPlace(startPlace(entry, shownHash), token);
    restoring = { token, k };
  };
  // a view that draws itself again in place (main emptied outside a route change): keep the row you were at
  let rendering = false;
  new MutationObserver((recs) => {
    if (rendering || keeping || !recs.some((r) => r.removedNodes.length)) return;
    if (lastPlace.y > 0) keepPlace(lastPlace, renderToken, 3000);
  }).observe(main, { childList: true });

  let renderToken = 0;
  function render() {
    const route = currentRoute();
    const token = ++renderToken;
    setDrawer(false); // also when the route changes from outside, e.g. the back button
    savePosition();
    const entry = entryId();
    shownEntry = entry;
    // only these views come back to their last place on a new visit; settings, writing and forms start fresh
    shownHash = ['home', 'module', 'node'].includes(route.kind) ? location.hash || '#/home' : '';
    rendering = true;
    // a view that holds unsaved work (the library) hands it over before it goes (0.15.1)
    if (main.cleanup) { const done = main.cleanup; main.cleanup = null; try { done(); } catch (e) { console.warn(e); } }
    main.replaceChildren();
    delete main.dataset.view;
    const nodeType = route.kind === 'node' ? nodeByPath(route.path)?.type : null;
    paintAccent(main, route.kind === 'module' ? route.mod.id : route.kind === 'node' ? typeAccent(nodeType) : route.kind === 'form' ? 'cheatsheet' : route.kind === 'write' ? 'projects' : 'shell');
    if (route.kind === 'settings') renderSettings(main, { onChange: refresh, onCheckUpdate: runUpdateCheck, onSync: runSync, section: route.section });
    else if (route.kind === 'module' && VIEWS[route.mod.id]) VIEWS[route.mod.id](main, route.mod, { go });
    else if (route.kind === 'module') renderModule(main, route.mod);
    else if (route.kind === 'write') renderWrite(main, { go });
    else if (route.kind === 'source') renderSource(main, route.path, { go, isCurrent: () => token === renderToken });
    else if (route.kind === 'form') renderSnippetForm(main, { mode: route.mode, path: route.path, go, isCurrent: () => token === renderToken });
    else if (route.kind === 'node') {
      renderAnyNode(route.path, { isCurrent: () => token === renderToken, go, onSync: runSync }).then(() => restoreScroll(entry, token, { again: true }));
    } else renderStart(main, { go, onSync: runSync, onSetup: () => go('#/settings/sync'), focusCommand: () => input.focus() });
    app.dataset.route = route.kind;
    renderRail(route);
    restoreScroll(entry, token);
    // the observer reports after this task; the content drawn so far is part of the route change, not a redraw
    queueMicrotask(() => { rendering = false; });
  }

  // A project and a note have views of their own; every other node shows in the node view. What you open is
  // remembered, so Start can offer to go on with it.
  async function renderAnyNode(path, ctx) {
    const node = await getNode(path);
    if (!ctx.isCurrent()) return;
    const type = node && !node.conflict && !node.error ? node.meta.type : '';
    if (node) mark('node', { path, title: String(node.meta.title || node.slug) });
    if (type === 'project' || type === 'note') { paintAccent(main, 'projects'); renderRail(); }
    if (type === 'project') return renderProject(main, path, ctx);
    if (type === 'note') return renderNote(main, path, ctx);
    return renderNode(main, path, ctx);
  }

  function refresh() {
    paintAccent(document.documentElement, 'shell');
    renderCmd();
    renderStatus();
    render();
  }

  // ---------------------------------------------------------------- module bar
  function railButton({ id, iconName, label, active, onclick, accentId }) {
    const tile = iconEl(iconName, 'tile');
    paintAccent(tile, accentId);
    // on a wide screen the short name stands under the icon (0.15.0), in the drawer of the phone the full one beside it
    const short = t(`rail.${id}`) === `rail.${id}` ? label : t(`rail.${id}`);
    const b = h('button', { type: 'button', class: `rail-btn${active ? ' active' : ''}`, 'aria-label': label, title: label, 'aria-current': active ? 'page' : null, dataset: { id }, onclick },
      tile, h('span', { class: 'rail-label', text: label }), h('span', { class: 'rail-short', 'aria-hidden': 'true', text: short }));
    const action = { home: 'go.home', projects: 'go.projects', scraper: 'go.research', settings: 'go.settings' }[id];
    if (action) keyTitle(b, label, action);
    return b;
  }

  function renderRail(route = currentRoute()) {
    rail.replaceChildren();
    rail.append(h('button', { type: 'button', class: 'brand', 'aria-label': t('nav.home'), title: t('nav.home'), onclick: () => go('#/home') },
      h('img', { src: 'icons/favicon-64.png', alt: '', width: 32, height: 32 }), h('span', { class: 'brand-name', text: t('app.name') })));
    rail.append(railButton({ id: 'home', iconName: 'home', label: t('nav.home'), active: route.kind === 'home', accentId: 'shell', onclick: () => go('#/home') }));
    const list = h('div', { class: 'rail-modules' });
    const nodeModule = route.kind === 'node' ? (route.path.startsWith('projects/') || route.path.startsWith('notes/') ? 'projects' : typeAccent(nodeByPath(route.path)?.type)) : '';
    for (const m of READY) {
      const active = (route.kind === 'module' && route.mod.id === m.id) || nodeModule === m.id || (route.kind === 'form' && m.id === 'cheatsheet') || (route.kind === 'write' && m.id === 'projects');
      list.append(railButton({ id: m.id, iconName: m.icon, label: t(`module.${m.id}.name`), active, accentId: m.id, onclick: () => (m.href ? location.assign(m.href) : go(`#/m/${m.id}`)) }));
    }
    rail.append(list);
    rail.append(h('div', { class: 'rail-spacer' }));
    rail.append(railButton({ id: 'settings', iconName: 'settings', label: t('nav.settings'), active: route.kind === 'settings', accentId: 'shell', onclick: () => go('#/settings') }));
    rail.append(h('div', { class: 'rail-status' }, statusItems()));
  }

  function setDrawer(open) {
    app.classList.toggle('drawer-open', open);
  }

  // Swipe from the left edge opens the module bar on the phone, a swipe to the left closes it.
  let touchX = null;
  app.addEventListener('touchstart', (e) => {
    const x = e.touches[0].clientX;
    touchX = (x < 24 || app.classList.contains('drawer-open')) ? x : null;
  }, { passive: true });
  app.addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (dx > 60) setDrawer(true);
    if (dx < -60) setDrawer(false);
    touchX = null;
  }, { passive: true });

  // ---------------------------------------------------------------- command bar
  const input = h('input', {
    class: 'cmd-input', type: 'search', enterkeyhint: 'go', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'cmd-results', 'aria-autocomplete': 'list',
  });
  const results = h('div', { class: 'cmd-results', id: 'cmd-results', role: 'listbox' });
  const menuBtn = h('button', { type: 'button', class: 'icon-btn menu-btn', onclick: () => setDrawer(!app.classList.contains('drawer-open')) });
  const kbd = h('kbd', { class: 'cmd-kbd', text: formatKeys('cmd.focus')[0] || '' });
  onKeysChange(() => { kbd.textContent = formatKeys('cmd.focus')[0] || ''; });
  if (!hasKeyboard()) kbd.hidden = true;
  // "+" creates anything from anywhere; the pill names the project in focus and leads to it
  const plusBtn = h('button', { type: 'button', class: 'icon-btn plus-btn', onclick: () => openCreate() });
  const pill = h('button', { type: 'button', class: 'focus-pill', hidden: true });
  const openCreate = () => { hideResults(); input.blur(); createMenu({ go, paint: paintAccent }); };
  function renderPill() {
    const f = focusProject();
    pill.hidden = !f;
    if (!f) return;
    paintProject(pill, f.slug);
    pill.replaceChildren(iconEl('target'), h('span', { class: 'focus-pill-title', text: f.title }));
    pill.title = t('focus.pill', { title: f.title });
    pill.setAttribute('aria-label', pill.title);
    // the drawer (0.18.0): the project in focus from anywhere; the node on screen goes into a section with one tap
    pill.onclick = () => { const r = currentRoute(); openProjectDrawer({ go, current: r.kind === 'node' ? r.path : '' }); };
    pill.title = withKeys(t('focus.pill', { title: f.title }), 'project.drawer');
  }
  let selected = 0;
  let shown = [];

  function renderCmd() {
    menuBtn.innerHTML = icon('menu');
    menuBtn.setAttribute('aria-label', t('nav.menu'));
    input.placeholder = t('commandbar.placeholder');
    input.setAttribute('aria-label', t('commandbar.placeholder'));
    plusBtn.innerHTML = icon('plus');
    keyTitle(plusBtn, t('create.title'), 'create');
    plusBtn.setAttribute('aria-label', t('create.title'));
    if (!cmd.firstChild) {
      cmd.append(menuBtn, h('div', { class: 'cmd-field' }, iconEl('search', 'cmd-icon'), input, kbd), plusBtn, pill, results);
    }
    renderPill();
    if (app.classList.contains('cmd-open')) showResults();
  }

  function commands() {
    const list = [
      { label: t('cmd.home'), keys: 'home übersicht start', icon: 'home', run: () => go('#/home') },
      { label: t('cmd.settings'), keys: 'settings einstellungen preferences', icon: 'settings', run: () => go('#/settings') },
      { label: t('cmd.lang.en'), keys: 'language sprache english englisch en', icon: 'translate', run: () => setLang('en') },
      { label: t('cmd.lang.de'), keys: 'language sprache german deutsch de', icon: 'translate', run: () => setLang('de') },
    ];
    for (const m of READY) {
      const name = t(`module.${m.id}.name`);
      list.push({ label: t('cmd.open', { module: name }), keys: `${m.id} module modul ${t(`module.${m.id}.desc`)}`, icon: m.icon, accent: m.id, run: () => (m.href ? location.assign(m.href) : go(`#/m/${m.id}`)) });
    }
    for (const a of ACCENTS) {
      list.push({ label: t('cmd.accent', { color: t(`accent.${a.id}`) }), keys: `accent akzent colour color farbe ${a.id}`, icon: 'palette', swatch: a.color, run: () => { setAccent('shell', a.id); refresh(); } });
    }
    list.splice(2, 0, isConfigured()
      ? { label: t('cmd.sync'), keys: 'sync abgleichen abgleich git github pull push holen hochladen knowledge wissen', icon: 'refresh', run: runSync }
      : { label: t('cmd.syncSetup'), keys: 'sync abgleichen abgleich einrichten setup git github token knowledge wissen', icon: 'refresh', run: () => go('#/settings/sync') });
    for (const c of CREATORS) {
      list.push({ label: t(`create.${c.id}.cmd`), keys: `new neu neue neues neuer anlegen erstellen create ${c.keys}`, icon: c.icon, accent: c.accent, run: () => c.run({ go }) });
    }
    list.push({ label: t('cmd.update'), keys: 'update aktualisieren version', icon: 'cloudDown', run: runUpdateCheck });
    list.push({ label: t('cmd.help'), keys: 'help hilfe shortcuts tastenkürzel keyboard', icon: 'info', run: showHelp });
    return list;
  }

  // Every word of the query has to appear in the label or the keywords; hits at the start of a word rank higher.
  function match(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const all = commands();
    if (!words.length) return all.slice(0, 8);
    const scored = [];
    for (const c of all) {
      const hay = `${c.label} ${c.keys}`.toLowerCase();
      let score = 0;
      let ok = true;
      for (const w of words) {
        const i = hay.indexOf(w);
        if (i < 0) { ok = false; break; }
        score += i === 0 || /\s/.test(hay[i - 1]) ? 2 : 1;
      }
      if (ok) scored.push({ c, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 8).map((s) => s.c);
  }

  // Hits from the knowledge come first; a command with a word that starts with the query moves to the top.
  // Where a jump leads (0.15.1): Start and every tool, in the order of the module bar. Alt+1 … Alt+9 go there too.
  const jumps = () => [{ id: 'home', icon: 'home', accent: 'shell', label: t('nav.home'), run: () => go('#/home') },
    ...READY.map((m) => ({ id: m.id, icon: m.icon, accent: m.id, label: t(`rail.${m.id}`) === `rail.${m.id}` ? t(`module.${m.id}.name`) : t(`rail.${m.id}`), run: () => { if (m.href) location.href = m.href; else go(`#/m/${m.id}`); } }))];

  let lastNote = null;
  function entries(query) {
    const q = query.trim();
    const cmds = match(query);
    const lang = getLang();
    // Nothing typed: the bar is a springboard. Tools as tiles, your projects, what you opened last.
    if (!q) {
      const focus = focusProject();
      const mine = projects().filter((p) => p.state === 'active').sort((a, b) => (b.path === focus?.path) - (a.path === focus?.path)).slice(0, 4);
      return [
        ...jumps().map((j, i) => ({ ...j, jump: true, hint: i < 9 ? String(i + 1) : '' })),
        ...mine.map((p) => ({ project: p, label: p.title, detail: p.steps?.next ? `${t('project.next')} ${p.steps.next}` : p.goal, icon: 'target', accent: 'projects', run: () => go(nodeHref(p.path)) })),
        ...recentPaths().map(nodeByPath).filter((d) => d && d.type !== 'project').slice(0, 5).map((d) => ({ node: d, label: nodeTitle(d, lang), detail: typeLabel(d.type), icon: typeIcon(d.type), accent: typeAccent(d.type), run: () => go(nodeHref(d.path)) })),
      ];
    }
    // A hit found through one of its problems shows that problem instead of the first sentence.
    const found = q ? searchDetailed(q, { limit: 8 }) : null;
    lastNote = found?.note || null;
    const nodes = (found ? found.hits : recentPaths().map(nodeByPath).filter(Boolean).slice(0, 4)).map((d) => {
      const problem = q ? bestProblem(d, q, lang) : '';
      return {
        node: d, label: nodeTitle(d, lang), problem,
        detail: [typeLabel(d.type), problem ? t('commandbar.solves', { problem }) : nodeLead(d, lang)].filter(Boolean).join(' · '),
        icon: typeIcon(d.type), accent: typeAccent(d.type), run: () => go(nodeHref(d.path)),
      };
    });
    const ql = q.toLowerCase();
    const strong = q && cmds.length && cmds[0].label.toLowerCase().split(/\s+/).some((w) => w.startsWith(ql));
    const list = strong ? [...cmds.slice(0, 3), ...nodes] : [...nodes, ...cmds.slice(0, nodes.length ? 3 : 8)];
    // Catch what you typed as a note (0.15.0): into the project in focus, otherwise into the inbox. "+ text" puts it first.
    const plus = /^\+\s*\S/.test(q);
    const noteText = plus ? q.replace(/^\+\s*/, '') : q;
    if (noteText.length >= 2 && indexState().hasKnowledge) {
      const f = focusProject();
      const note = { label: f ? t('cmd.noteIn', { text: noteText, title: f.title }) : t('cmd.note', { text: noteText }), keys: '', icon: 'edit', accent: 'projects', capture: noteText,
        run: async () => { try { await capture(noteText); toast(f ? t('note.keptIn', { title: f.title }) : t('note.keptInbox'), 'ok'); if (currentRoute().kind === 'home') render(); } catch { toast(t('create.failed'), 'error', 5000); } } };
      if (plus) return [note];
      list.push(note);
    }
    // Search the literature for what you typed (0.14.0); a DOI or an arXiv id comes first.
    if (q.length >= 3) {
      const research = { label: t('cmd.research', { query: q }), keys: '', icon: 'globe', accent: 'scraper', run: () => { queueSearch(q); go('#/m/scraper'); } };
      if (parseQuery(q).kind !== 'text') list.unshift(research); else list.push(research);
      // an address or "crawl <address>" (0.14.3): go through the website
      const address = parseQuery(q).kind === 'text' ? parseStart(q) : null;
      if (address) {
        const crawl = { label: t('cmd.crawl', { address: address.replace(/^https?:\/\//, '') }), keys: '', icon: 'globe', accent: 'scraper', run: () => { savePref('crawl.open', address); go('#/m/scraper'); } };
        list.unshift(crawl);
      }
    }
    return list;
  }

  function footText() {
    const s = indexState();
    if (!s.ready || s.building) return t('commandbar.indexing');
    if (!s.hasKnowledge) return t('commandbar.noKnowledge');
    return t('commandbar.indexed', { count: s.count });
  }

  function showResults() {
    shown = entries(input.value);
    selected = Math.min(selected, Math.max(shown.length - 1, 0));
    results.replaceChildren();
    let section = null;
    let tiles = null;
    shown.forEach((c, i) => {
      const kind = c.jump ? 'jump' : c.project ? 'projects' : c.node ? (input.value.trim() ? 'hits' : 'recent') : 'commands';
      if (kind !== section) {
        section = kind;
        results.append(h('div', { class: 'cmd-sec', text: t(`commandbar.${kind}`) }));
        // how the hits were found (0.19.0): a corrected word, other names, what you opened before
        if (kind === 'hits' && lastNote) { const n = searchNote(lastNote, 'cmd-note'); if (n) results.append(n); }
        if (kind === 'jump') { tiles = h('div', { class: 'cmd-jumps' }); results.append(tiles); }
      }
      if (c.jump) {
        const tile = iconEl(c.icon, 'tile');
        paintAccent(tile, c.accent);
        const b = h('div', { class: `cmd-row cmd-jump${i === selected ? ' sel' : ''}`, role: 'option', id: `cmd-opt-${i}`, 'aria-selected': String(i === selected), dataset: { id: c.id } }, tile, h('span', { class: 'cmd-label', text: c.label }), c.hint ? h('kbd', { text: c.hint }) : null);
        b.addEventListener('pointerdown', (e) => e.preventDefault());
        b.addEventListener('click', () => runAt(i));
        tiles.append(b);
        return;
      }
      const lead = c.swatch ? h('span', { class: 'swatch small', style: { background: c.swatch } }) : iconEl(c.icon, 'tile small');
      if (c.accent) paintAccent(lead, c.accent);
      const text = c.detail ? h('span', { class: 'cmd-text' }, h('span', { class: 'cmd-label', text: c.label }), h('span', { class: 'cmd-detail', text: c.detail })) : h('span', { class: 'cmd-label', text: c.label });
      const row = h('div', { class: `cmd-row${i === selected ? ' sel' : ''}`, role: 'option', id: `cmd-opt-${i}`, 'aria-selected': String(i === selected) }, lead, text);
      if (c.node?.code) {
        const copy = h('button', { type: 'button', class: 'icon-btn cmd-copy', title: t('node.copyCode'), 'aria-label': `${t('node.copyCode')}: ${c.label}`, html: icon('copy') });
        copy.addEventListener('pointerdown', (e) => e.preventDefault());
        copy.addEventListener('click', (e) => { e.stopPropagation(); copyWithToast(c.node.code); });
        row.append(copy);
      }
      row.addEventListener('pointerdown', (e) => e.preventDefault());
      row.addEventListener('click', () => runAt(i));
      results.append(row);
    });
    if (!shown.length) results.append(h('div', { class: 'cmd-empty', text: t('commandbar.empty') }));
    results.append(h('div', { class: 'cmd-foot', text: footText() }));
    input.setAttribute('aria-activedescendant', shown.length ? `cmd-opt-${selected}` : '');
    app.classList.add('cmd-open');
    input.setAttribute('aria-expanded', 'true');
    keepInList(results.querySelector('.cmd-row.sel'));
  }

  // Scrolls only the list so the chosen row is seen. scrollIntoView also moved the page on the iPhone (0.22.0).
  function keepInList(row) {
    if (!row) return;
    const r = row.getBoundingClientRect();
    const box = results.getBoundingClientRect();
    if (r.top < box.top + 6) results.scrollTop -= box.top + 6 - r.top;
    else if (r.bottom > box.bottom - 6) results.scrollTop += r.bottom - (box.bottom - 6);
  }

  function hideResults() {
    app.classList.remove('cmd-open');
    input.setAttribute('aria-expanded', 'false');
  }

  function runAt(i) {
    const c = shown[i];
    if (!c) return;
    // a node opened after a search: the words lead to it next time (0.19.0)
    if (c.node && input.value.trim()) rememberPick(input.value.trim(), c.node.slug);
    input.value = '';
    selected = 0;
    hideResults();
    input.blur();
    c.run();
  }

  input.addEventListener('focus', () => { selected = 0; showResults(); });
  input.addEventListener('input', () => { selected = 0; showResults(); });
  input.addEventListener('blur', () => setTimeout(hideResults, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(selected + 1, shown.length - 1); showResults(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(selected - 1, 0); showResults(); }
    else if (matches(e, 'cmd.copy') && shown[selected]?.node?.code) { e.preventDefault(); copyWithToast(shown[selected].node.code); }
    else if (matches(e, 'cmd.note')) { e.preventDefault(); const i = shown.findIndex((c) => c.capture); if (i >= 0) runAt(i); }
    else if (e.key === 'Enter') { e.preventDefault(); runAt(selected); }
    else if (e.key === 'Escape') { e.preventDefault(); input.value = ''; hideResults(); input.blur(); }
  });

  // the keys of Settings › Keys (0.17.0); Alt+1 … 9 and Escape stay as they are
  bind({
    'cmd.focus': () => { input.focus(); },
    create: () => { if (document.querySelector('.modal-backdrop, .sheet-backdrop')) return false; openCreate(); },
    help: () => { if (document.querySelector('.modal-backdrop, .sheet-backdrop')) return false; showHelp(); },
    'go.home': () => go('#/home'),
    'go.projects': () => go('#/m/projects'),
    'go.write': () => go('#/m/library'),
    'go.research': () => go('#/m/scraper'),
    'go.settings': () => go('#/settings'),
    sync: () => { runSync(); },
    'project.drawer': () => { if (document.querySelector('.modal-backdrop, .sheet-backdrop')) return false; const r = currentRoute(); openProjectDrawer({ go, current: r.kind === 'node' ? r.path : '' }); },
  });
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (e.altKey && !e.metaKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code)) {
      // On a Mac, Option+digit types signs ([ ] | \ { } on a German keyboard). While you type, the sign wins over the jump.
      if (typing && !/^[1-9]$/.test(e.key)) return;
      const j = jumps()[Number(e.code.slice(5)) - 1];
      if (j) { e.preventDefault(); hideResults(); input.blur(); j.run(); }
    }
    else if (e.key === 'Escape' && !typing) { if (!closeTopModal()) setDrawer(false); }
  });

  function showHelp() {
    const rows = [
      ...helpRows().filter((r) => r.keys.length).map((r) => [r.keys.join('  '), t(`keys.${r.id}`)]),
      ['↑ ↓', t('help.choose')],
      ['Enter', t('help.run')],
      ['Esc', t('help.close')],
    ];
    const more = h('button', { type: 'button', class: 'btn small', onclick: () => { closeTopModal(); go('#/settings/keys'); } }, h('span', { text: t('help.change') }));
    modal({
      title: t('help.title'),
      body: h('div', {}, h('dl', { class: 'keys' }, rows.flatMap(([k, v]) => [h('dt', {}, h('kbd', { text: k })), h('dd', { text: v })])), hasKeyboard() ? h('div', { class: 'btn-row' }, more) : null),
      actions: [{ label: t('action.close'), value: true, kind: 'primary' }],
    });
  }

  async function runUpdateCheck() {
    toast(t('update.checking'));
    const result = await checkForUpdate();
    if (result === 'none') toast(t('update.none'), 'ok');
    else if (result === 'unavailable') toast(t('update.unavailable'), 'info', 4000);
  }

  // ---------------------------------------------------------------- sync
  async function runSync() {
    if (!isConfigured()) {
      toast(t('sync.err.notConfigured'), 'info', 4000);
      go('#/settings/sync');
      return;
    }
    try {
      const r = await syncKnowledge();
      if (r.conflicts.length) toast(t('sync.done.conflicts', { count: r.conflicts.length }), 'error', 6000);
      else if (r.kind === 'cloned') toast(t('sync.done.cloned', { count: r.nodes }), 'ok', 3500);
      else if (r.kind === 'pushed') toast(t('sync.done.pushed', { count: r.uploaded }), 'ok');
      else toast(t(`sync.done.${r.kind}`), 'ok');
    } catch {
      toast(syncState().error, 'error', 6000);
    }
  }

  // While a sync runs only the status bar and the Sync buttons change; afterwards Home shows the new numbers.
  let wasBusy = false;
  const syncKey = (l) => (l ? `${l.head}|${l.nodes}|${l.kind === 'cloned'}` : '');
  let lastKey = syncKey(syncState().last);
  onSyncChange((s) => {
    const key = syncKey(s.last);
    if (key !== lastKey && !s.busy) buildIndex(); // after a sync or after removing the local copy
    lastKey = key;
    renderStatus();
    for (const b of document.querySelectorAll('[data-sync-btn]')) {
      b.disabled = s.busy;
      b.classList.toggle('busy', s.busy);
      b.lastChild.textContent = s.busy ? (phaseText(s) || t('status.sync.busy')) : t('action.sync');
    }
    if (wasBusy && !s.busy && currentRoute().kind === 'home' && !typingInMain()) render();
    wasBusy = s.busy;
  });

  // a view is not drawn again under your fingers while you type in it
  const typingInMain = () => main.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.value;

  // ---------------------------------------------------------------- status bar
  function statusItems() {
    const { ready, version, supported } = pwaState();
    const online = navigator.onLine;
    return [
      h('span', { class: `st ${ready ? 'ok' : ''}` }, iconEl(ready ? 'check' : 'refresh'), h('span', { text: t(ready ? 'status.offlineReady' : 'status.offlinePreparing') })),
      h('span', { class: `st ${online ? '' : 'warn'}` }, iconEl(online ? 'dot' : 'cloudOff'), h('span', { text: t(online ? 'status.online' : 'status.offline') })),
      syncStatusItem(),
      h('span', { class: 'st dim' }, iconEl('server'), h('span', { text: t('status.hub') })),
      h('span', { class: 'st version', text: supported && version ? `v${version}` : '' }),
    ];
  }

  function syncStatusItem() {
    const s = syncState();
    let cls = 'st st-btn';
    let text;
    if (!s.configured) { cls += ' dim'; text = t('status.sync'); }
    else if (s.busy) { cls += ' busy'; text = phaseText(s) || t('status.sync.busy'); }
    else if (s.error) { cls += ' warn'; text = t('status.sync.error'); }
    else if (s.pending) { cls += ' pending'; text = t('status.sync.pending', { count: s.pending }); }
    else if (s.last?.time) { cls += ' ok'; text = t('status.sync.last', { time: formatTime(s.last.time) }); }
    else text = t('status.sync.ready');
    return h('button', { type: 'button', class: cls, title: s.error || t('cmd.sync'), onclick: runSync },
      iconEl(s.error ? 'warn' : s.pending && !s.busy ? 'cloudUp' : 'refresh', s.busy ? 'spin' : ''), h('span', { text }));
  }

  function renderStatus() {
    status.replaceChildren(...statusItems());
    const drawerStatus = rail.querySelector('.rail-status');
    if (drawerStatus) drawerStatus.replaceChildren(...statusItems());
  }

  // ---------------------------------------------------------------- updates
  let updateBar = null;
  onPwaChange((s) => {
    renderStatus();
    if (s.waiting && !updateBar) {
      updateBar = h('div', { class: 'update-bar', role: 'status' },
        iconEl('sparkle'), h('span', { text: t('update.ready') }),
        h('button', { type: 'button', class: 'btn primary', text: t('action.reload'), onclick: applyUpdate }));
      app.append(updateBar);
    }
  });

  // ---------------------------------------------------------------- viewport
  // On the iPhone the keyboard shrinks the visible area; the shell follows the visual viewport.
  const vv = window.visualViewport;
  function fitViewport() {
    const height = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-h', `${Math.round(height)}px`);
    const keyboard = vv ? window.innerHeight - vv.height > 140 : false;
    app.classList.toggle('kb-open', keyboard);
    if (window.scrollY && !keyboard) window.scrollTo(0, 0);
  }
  vv?.addEventListener('resize', fitViewport);
  window.addEventListener('resize', fitViewport);
  fitViewport();
  // the height of the command bar, so its list fits above it on the phone (0.22.0)
  const cmdHeight = () => document.documentElement.style.setProperty('--cmd-h', `${Math.round(cmd.offsetHeight)}px`);
  if (window.ResizeObserver) new ResizeObserver(cmdHeight).observe(cmd);
  cmdHeight();

  // Another window (the research window) changed nodes: take them into the index here too.
  onAnnounce(async (msg) => {
    if (msg.kind !== 'nodes' || !Array.isArray(msg.paths)) return;
    for (const p of msg.paths) await refreshNode(p);
    refreshPending();
    window.dispatchEvent(new CustomEvent('toollib:nodes', { detail: msg.paths }));
    const route = currentRoute();
    if (route.kind === 'node' && msg.paths.includes(route.path)) render();
  });

  // Sync by itself (0.14.1.1): quiet, only a clash is reported
  startAutoSync({ onDone: (r) => { if (r.conflicts.length) toast(t('sync.done.conflicts', { count: r.conflicts.length }), 'error', 6000); } });

  window.addEventListener('online', renderStatus);
  window.addEventListener('offline', renderStatus);
  window.addEventListener('hashchange', render);
  onLangChange(refresh);

  // The index is built in the background; views that show knowledge are drawn again once it is ready.
  onIndexChange((s) => {
    if (s.building) return;
    if (app.classList.contains('cmd-open')) showResults();
    renderPill();
    const route = currentRoute();
    if (typingInMain()) return;
    if (route.kind === 'home' || route.kind === 'node' || (route.kind === 'module' && route.mod.id === 'projects')) render();
  });

  // What is new joins the project in focus (0.15.0); a change of the focus shows in the pill and on Start.
  startAutoLink();
  onFocusChange(() => {
    renderPill();
    const route = currentRoute();
    if (route.kind === 'home' || (route.kind === 'module' && route.mod.id === 'projects')) render();
  });
  // the project in focus took a node in: the node you look at shows it
  window.addEventListener('toollib:linked', (e) => {
    const route = currentRoute();
    if (route.kind === 'node' && (e.detail || []).includes(route.path) && !typingInMain() && !document.querySelector('.modal-backdrop, .sheet-backdrop')) render();
  });

  renderCmd();
  renderStatus();
  render();
  buildIndex();
  refreshPending(); // changes from an earlier visit that are not uploaded yet
  // a run through a website the app was closed in (0.14.3) goes on
  resumeInterrupted().then((title) => { if (title) toast(t('crawl.resumed', { title }), 'info', 4000); }).catch((e) => console.warn('Crawl not resumed', e));
  // the Toollib in the Mac helper (0.14.4 part 2): runs that devices hand to the Mac
  startBackground();
  // PDFs you put into the inbox on your Mac (0.14.4) come in by themselves while Toollib is open and the helper answers
  watchInbox({ title: () => t('inbox.folder'), onDone: (r) => toast(r.added ? t('inbox.done', { n: r.added }) : t('inbox.result', r), r.failed ? 'warn' : 'ok', 5000) })
    .catch((e) => console.warn('PDF inbox', e));
}
