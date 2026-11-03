// The shell: command bar, module bar, workspace and status bar.
// Routes live in the URL hash: #/home, #/settings, #/m/<module id>.
import { h, toast, modal, closeTopModal } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, setLang, onLangChange } from '../i18n/i18n.js';
import { ACCENTS, MODULES, moduleById, paintAccent, setAccent } from './modules.js';
import { renderHome, renderModule, renderSettings } from './views.js';
import { applyUpdate, checkForUpdate, onPwaChange, pwaState } from '../services/pwa.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
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
  paintAccent(document.documentElement, 'shell');

  // ---------------------------------------------------------------- routing
  function currentRoute() {
    const [, kind, id] = location.hash.split('/');
    if (kind === 'settings') return { kind: 'settings' };
    if (kind === 'm' && moduleById(id)) return { kind: 'module', mod: moduleById(id) };
    return { kind: 'home' };
  }

  function go(hash) {
    setDrawer(false);
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function render() {
    const route = currentRoute();
    main.replaceChildren();
    paintAccent(main, route.kind === 'module' ? route.mod.id : 'shell');
    if (route.kind === 'settings') renderSettings(main, { onChange: refresh, onCheckUpdate: runUpdateCheck });
    else if (route.kind === 'module') renderModule(main, route.mod);
    else renderHome(main);
    renderRail(route);
    main.scrollTop = 0;
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
    const b = h('button', { type: 'button', class: `rail-btn${active ? ' active' : ''}`, 'aria-label': label, title: label, 'aria-current': active ? 'page' : null, dataset: { id }, onclick },
      tile, h('span', { class: 'rail-label', text: label }));
    return b;
  }

  function renderRail(route = currentRoute()) {
    rail.replaceChildren();
    rail.append(h('button', { type: 'button', class: 'brand', 'aria-label': t('nav.home'), title: t('nav.home'), onclick: () => go('#/home') },
      h('img', { src: 'icons/favicon-64.png', alt: '', width: 32, height: 32 }), h('span', { class: 'brand-name', text: t('app.name') })));
    rail.append(railButton({ id: 'home', iconName: 'home', label: t('nav.home'), active: route.kind === 'home', accentId: 'shell', onclick: () => go('#/home') }));
    const list = h('div', { class: 'rail-modules' });
    for (const m of MODULES) {
      list.append(railButton({ id: m.id, iconName: m.icon, label: t(`module.${m.id}.name`), active: route.kind === 'module' && route.mod.id === m.id, accentId: m.id, onclick: () => go(`#/m/${m.id}`) }));
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
  const kbd = h('kbd', { class: 'cmd-kbd', text: isMac ? '⌘K' : 'Ctrl K' });
  let selected = 0;
  let shown = [];

  function renderCmd() {
    menuBtn.innerHTML = icon('menu');
    menuBtn.setAttribute('aria-label', t('nav.menu'));
    input.placeholder = t('commandbar.placeholder');
    input.setAttribute('aria-label', t('commandbar.placeholder'));
    if (!cmd.firstChild) {
      cmd.append(menuBtn, h('div', { class: 'cmd-field' }, iconEl('search', 'cmd-icon'), input, kbd), results);
    }
    if (app.classList.contains('cmd-open')) showResults();
  }

  function commands() {
    const list = [
      { label: t('cmd.home'), keys: 'home übersicht start', icon: 'home', run: () => go('#/home') },
      { label: t('cmd.settings'), keys: 'settings einstellungen preferences', icon: 'settings', run: () => go('#/settings') },
      { label: t('cmd.lang.en'), keys: 'language sprache english englisch en', icon: 'translate', run: () => setLang('en') },
      { label: t('cmd.lang.de'), keys: 'language sprache german deutsch de', icon: 'translate', run: () => setLang('de') },
    ];
    for (const m of MODULES) {
      const name = t(`module.${m.id}.name`);
      list.push({ label: t('cmd.open', { module: name }), keys: `${m.id} module modul ${t(`module.${m.id}.desc`)}`, icon: m.icon, accent: m.id, run: () => go(`#/m/${m.id}`) });
    }
    for (const a of ACCENTS) {
      list.push({ label: t('cmd.accent', { color: t(`accent.${a.id}`) }), keys: `accent akzent colour color farbe ${a.id}`, icon: 'palette', swatch: a.color, run: () => { setAccent('shell', a.id); refresh(); } });
    }
    list.push({ label: t('cmd.update'), keys: 'update aktualisieren version', icon: 'refresh', run: runUpdateCheck });
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

  function showResults() {
    shown = match(input.value);
    selected = Math.min(selected, Math.max(shown.length - 1, 0));
    results.replaceChildren();
    shown.forEach((c, i) => {
      const lead = c.swatch ? h('span', { class: 'swatch small', style: { background: c.swatch } }) : iconEl(c.icon, 'tile small');
      if (c.accent) paintAccent(lead, c.accent);
      const row = h('div', { class: `cmd-row${i === selected ? ' sel' : ''}`, role: 'option', id: `cmd-opt-${i}`, 'aria-selected': String(i === selected) },
        lead, h('span', { text: c.label }));
      row.addEventListener('pointerdown', (e) => e.preventDefault());
      row.addEventListener('click', () => runAt(i));
      results.append(row);
    });
    if (!shown.length) results.append(h('div', { class: 'cmd-empty', text: t('commandbar.empty') }));
    results.append(h('div', { class: 'cmd-foot', text: t('commandbar.knowledgeSoon') }));
    input.setAttribute('aria-activedescendant', shown.length ? `cmd-opt-${selected}` : '');
    app.classList.add('cmd-open');
    input.setAttribute('aria-expanded', 'true');
  }

  function hideResults() {
    app.classList.remove('cmd-open');
    input.setAttribute('aria-expanded', 'false');
  }

  function runAt(i) {
    const c = shown[i];
    if (!c) return;
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
    else if (e.key === 'Enter') { e.preventDefault(); runAt(selected); }
    else if (e.key === 'Escape') { e.preventDefault(); input.value = ''; hideResults(); input.blur(); }
  });

  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); input.focus(); }
    else if (e.key === 'Escape' && !typing) { if (!closeTopModal()) setDrawer(false); }
  });

  function showHelp() {
    const rows = [
      [isMac ? '⌘K  /' : 'Ctrl K  /', t('help.focus')],
      ['↑ ↓', t('help.choose')],
      ['Enter', t('help.run')],
      ['Esc', t('help.close')],
    ];
    modal({
      title: t('help.title'),
      body: h('dl', { class: 'keys' }, rows.flatMap(([k, v]) => [h('dt', {}, h('kbd', { text: k })), h('dd', { text: v })])),
      actions: [{ label: t('action.close'), value: true, kind: 'primary' }],
    });
  }

  async function runUpdateCheck() {
    toast(t('update.checking'));
    const result = await checkForUpdate();
    if (result === 'none') toast(t('update.none'), 'ok');
    else if (result === 'unavailable') toast(t('update.unavailable'), 'info', 4000);
  }

  // ---------------------------------------------------------------- status bar
  function statusItems() {
    const { ready, version, supported } = pwaState();
    const online = navigator.onLine;
    return [
      h('span', { class: `st ${ready ? 'ok' : ''}` }, iconEl(ready ? 'check' : 'refresh'), h('span', { text: t(ready ? 'status.offlineReady' : 'status.offlinePreparing') })),
      h('span', { class: `st ${online ? '' : 'warn'}` }, iconEl(online ? 'dot' : 'cloudOff'), h('span', { text: t(online ? 'status.online' : 'status.offline') })),
      h('span', { class: 'st dim' }, iconEl('refresh'), h('span', { text: t('status.sync') })),
      h('span', { class: 'st dim' }, iconEl('server'), h('span', { text: t('status.hub') })),
      h('span', { class: 'st version', text: supported && version ? `v${version}` : '' }),
    ];
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

  window.addEventListener('online', renderStatus);
  window.addEventListener('offline', renderStatus);
  window.addEventListener('hashchange', render);
  onLangChange(refresh);

  renderCmd();
  renderStatus();
  render();
}
