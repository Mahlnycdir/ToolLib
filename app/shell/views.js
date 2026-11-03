// Views of the workspace: Home, Settings and the placeholder of a module that is still planned.
import { h, toast, confirmDialog, formatBytes } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang, setLang } from '../i18n/i18n.js';
import { ACCENTS, MODULES, SHELL, accentOf, setAccent, paintAccent } from './modules.js';
import { isStandalone, platform, pwaState } from '../services/pwa.js';
import { storageInfo } from '../services/storage.js';
import { loadPref } from '../services/prefs.js';
import { recentList } from './node-view.js';
import {
  explainSyncError, isConfigured, kobraSettings, knowledgeStats, pendingChanges, phaseText, removeLocalCopy,
  saveSyncSetting, syncSettings, syncState, testConnection,
} from '../services/sync.js';

// Progress of the current stage: the Python cheatsheet as a full module. The foundation (5 steps) is done.
// Mark a point as done when it is delivered; ENTE decides the order of the open ones.
const STAGE = [
  { key: 'stage2.verify', done: true },
  { key: 'stage2.sources', done: true },
  { key: 'stage2.groups', done: false },
  { key: 'stage2.run', done: false },
  { key: 'stage2.kobra', done: false },
  { key: 'stage2.own', done: false },
];

const card = (title, ...children) => h('section', { class: 'card' }, title ? h('h2', { text: title }) : null, ...children);
const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

// "12:41" today, otherwise date and time, in the language of the interface.
export function formatTime(ms) {
  const d = new Date(ms);
  const locale = getLang() === 'de' ? 'de-DE' : 'en-GB';
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

// The Sync button shows the current step while a sync runs; the shell updates every [data-sync-btn].
export function syncButton(onSync, { primary = true } = {}) {
  const s = syncState();
  const label = h('span', { text: s.busy ? (phaseText(s) || t('status.sync.busy')) : t('action.sync') });
  return h('button', { type: 'button', class: `btn${primary ? ' primary' : ''}${s.busy ? ' busy' : ''}`, 'data-sync-btn': '', disabled: s.busy || null, onclick: onSync },
    iconEl('refresh'), label);
}

const originalOf = (copy) => copy.replace(/\.conflict-[a-z0-9-]+(\.[^./]+)?$/, '$1');

export function renderHome(main, { onSync, onSetup }) {
  main.append(h('h1', { class: 'view-title', text: t('home.title') }));
  main.append(h('p', { class: 'lead', text: t('app.tagline') }));

  if (!isStandalone()) {
    const how = { ios: 'home.install.ios', mac: 'home.install.mac' }[platform()] || 'home.install.other';
    main.append(card(t('home.install.title'), h('p', { class: 'muted', text: t(how) })));
  }

  // Knowledge on this device: filled once the file system has answered.
  const know = card(t('home.knowledge.title'));
  main.append(know);
  fillKnowledgeCard(know, { onSync, onSetup });

  const steps = h('ol', { class: 'steps' });
  STAGE.forEach((p, i) => {
    steps.append(h('li', { class: p.done ? 'done' : '' },
      h('span', { class: 'dot', html: p.done ? icon('check') : String(i + 1) }),
      h('span', { text: t(`home.${p.key}`) })));
  });
  main.append(card(t('home.progress.title'), steps, h('p', { class: 'muted small', text: t('home.progress.foundation') })));

  const grid = h('div', { class: 'grid-2' },
    card(t('home.projects.title'), h('p', { class: 'muted', text: t('home.projects.empty') })),
    card(t('home.recent.title'), recentList() || h('p', { class: 'muted', text: t('home.recent.empty') })));
  main.append(grid);
}

async function fillKnowledgeCard(box, { onSync, onSetup }) {
  if (!isConfigured()) {
    box.append(h('p', { class: 'muted', text: t('home.knowledge.setup') }),
      h('button', { type: 'button', class: 'btn primary', onclick: onSetup }, iconEl('settings'), h('span', { text: t('action.setup') })));
    return;
  }
  let stats = null;
  try { stats = await knowledgeStats(); } catch (e) { console.warn(e); }
  const s = syncState();
  if (!stats) {
    box.append(h('p', { class: 'muted', text: t('home.knowledge.first') }));
    if (s.error) box.append(h('p', { class: 'error-text', text: s.error }));
    box.append(syncButton(onSync));
    return;
  }
  box.append(h('div', { class: 'know-head' },
    h('span', { class: 'know-count', text: t('home.knowledge.count', { count: stats.total }) }),
    syncButton(onSync)));
  if (s.last?.time) {
    box.append(h('p', { class: 'muted small', text: t('home.knowledge.last', { time: formatTime(s.last.time), head: (stats.head || '').slice(0, 7) }) }));
  }
  if (s.error) box.append(h('p', { class: 'error-text', text: s.error }));
  const chips = h('div', { class: 'chips' });
  for (const [group, n] of stats.groups) chips.append(h('span', { class: 'chip' }, h('span', { text: group }), h('b', { text: String(n) })));
  box.append(chips);
  if (stats.conflicts.length) {
    const list = h('ul', { class: 'conflicts' });
    for (const copy of stats.conflicts) {
      list.append(h('li', {}, h('code', { text: copy }), h('span', { class: 'muted small', text: t('home.knowledge.conflictOf', { path: originalOf(copy) }) })));
    }
    box.append(h('div', { class: 'note warn' }, iconEl('warn'), h('div', {},
      h('p', { text: t('home.knowledge.conflicts', { count: stats.conflicts.length }) }), list)));
  }
  box.append(h('p', { class: 'muted small', text: t('home.knowledge.readSoon') }));
}

export function renderModule(main, mod) {
  const head = h('div', { class: 'module-head' },
    iconEl(mod.icon, 'tile big'),
    h('div', {},
      h('h1', { class: 'view-title', text: t(`module.${mod.id}.name`) }),
      h('p', { class: 'lead', text: t(`module.${mod.id}.desc`) })));
  main.append(head);
  main.append(card(null,
    h('span', { class: 'badge', text: t('module.planned') }),
    h('p', { class: 'muted', text: mod.step ? t('module.arrives', { step: mod.step }) : t('module.later') })));
}

export function renderSettings(main, { onChange, onCheckUpdate, onSync, section }) {
  main.append(h('h1', { class: 'view-title', text: t('settings.title') }));

  // Language
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': t('settings.language') });
  for (const lang of ['en', 'de']) {
    seg.append(h('button', {
      type: 'button',
      class: getLang() === lang ? 'on' : '',
      'aria-pressed': String(getLang() === lang),
      text: t(`settings.language.${lang}`),
      onclick: () => { setLang(lang); },
    }));
  }
  main.append(card(t('settings.language'), seg));

  main.append(syncCard({ onSync }));
  main.append(deviceCard({ onChange }));

  // Accents: one row per module
  const rows = h('div', { class: 'accent-rows' });
  for (const mod of [SHELL, ...MODULES]) {
    const current = accentOf(mod.id).id;
    const swatches = h('div', { class: 'swatches' });
    for (const a of ACCENTS) {
      swatches.append(h('button', {
        type: 'button',
        class: `swatch${a.id === current ? ' on' : ''}`,
        style: { background: a.color },
        title: t(`accent.${a.id}`),
        'aria-label': `${t(`module.${mod.id}.name`)}: ${t(`accent.${a.id}`)}`,
        'aria-pressed': String(a.id === current),
        onclick: () => { setAccent(mod.id, a.id); onChange(); },
      }));
    }
    const tile = iconEl(mod.icon, 'tile');
    paintAccent(tile, mod.id);
    rows.append(h('div', { class: 'accent-row' }, tile, h('span', { class: 'accent-name', text: t(`module.${mod.id}.name`) }), swatches));
  }
  main.append(card(t('settings.accents'), h('p', { class: 'muted', text: t('settings.accents.hint') }), rows));

  // About
  const { version } = pwaState();
  main.append(card(t('settings.about'),
    h('p', {}, h('span', { class: 'muted', text: `${t('settings.version')}: ` }), h('span', { text: version || '–' })),
    h('button', { type: 'button', class: 'btn', onclick: onCheckUpdate }, iconEl('refresh'), h('span', { text: t('cmd.update') }))));

  if (section) requestAnimationFrame(() => main.querySelector(`#settings-${section}`)?.scrollIntoView({ block: 'start' }));
}

// Repository, token, proxy and who writes the commits. Every field is saved when it loses the focus.
function syncCard({ onSync }) {
  const s = syncSettings();
  const fields = [];
  const field = (key, label, attrs, hint) => {
    const input = h('input', { class: 'field', id: `sync-${key}`, value: s[key] || '', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', ...attrs });
    input.addEventListener('change', () => saveSyncSetting(key, input.value));
    fields.push({ key, input });
    return { input, row: h('label', { class: 'set-field', for: `sync-${key}` }, h('span', { class: 'field-label', text: label }), input, hint ? h('span', { class: 'field-hint', text: hint }) : null) };
  };
  const saveAll = () => { for (const f of fields) saveSyncSetting(f.key, f.input.value); };

  const repo = field('repo', t('settings.sync.repo'), { type: 'text', placeholder: 'yourname/knowledge', inputmode: 'url' }, t('settings.sync.repo.hint'));
  const branch = field('branch', t('settings.sync.branch'), { type: 'text', placeholder: 'main' }, t('settings.sync.branch.hint'));
  const token = field('token', t('settings.sync.token'), { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' }, t('settings.sync.token.hint'));
  const show = h('button', { type: 'button', class: 'btn small', text: t('settings.sync.show') });
  show.addEventListener('click', () => {
    const hidden = token.input.type === 'password';
    token.input.type = hidden ? 'text' : 'password';
    show.textContent = t(hidden ? 'settings.sync.hide' : 'settings.sync.show');
  });
  const tokenRow = h('div', { class: 'row-input' });
  token.input.before(tokenRow);
  tokenRow.append(token.input, show);
  const proxy = field('proxy', t('settings.sync.proxy'), { type: 'url', placeholder: 'https://git-proxy.yourname.workers.dev', inputmode: 'url' }, t('settings.sync.proxy.hint'));
  const name = field('name', t('settings.sync.name'), { type: 'text', autocomplete: 'name' });
  const email = field('email', t('settings.sync.email'), { type: 'email', autocomplete: 'email' });
  const device = field('device', t('settings.sync.device'), { type: 'text', placeholder: s.device }, t('settings.sync.device.hint'));
  device.input.value = loadPref('sync.device', ''); // the placeholder shows the automatic name

  const result = h('ul', { class: 'checks', role: 'status' });
  const test = h('button', { type: 'button', class: 'btn' }, iconEl('link'), h('span', { text: t('settings.sync.test') }));
  const line = (status, text) => h('li', { class: `check ${status}` },
    iconEl({ ok: 'check', warn: 'warn', fail: 'close', info: 'info', busy: 'refresh' }[status] || 'info', status === 'busy' ? 'spin' : ''),
    h('span', { text }));
  test.addEventListener('click', async () => {
    saveAll();
    result.replaceChildren(line('busy', t('settings.sync.testing')));
    test.disabled = true;
    try {
      const lines = await testConnection();
      result.replaceChildren(...lines.map((l) => line(l.status, l.text)));
    } catch (e) {
      result.replaceChildren(line('fail', explainSyncError(e)));
    } finally {
      test.disabled = false;
    }
  });
  const syncNow = syncButton(() => { saveAll(); onSync(); });

  const box = h('section', { class: 'card', id: 'settings-sync' },
    h('h2', { text: t('settings.sync') }),
    h('p', { class: 'muted', text: t('settings.sync.hint') }),
    repo.row, branch.row, token.row, proxy.row, name.row, email.row, device.row);

  const kobra = kobraSettings();
  if ((kobra.proxy || kobra.name || kobra.email) && !(s.proxy && s.name && s.email)) {
    const take = h('button', { type: 'button', class: 'btn small' }, iconEl('download'), h('span', { text: t('settings.sync.fromKobra') }));
    take.addEventListener('click', () => {
      if (kobra.proxy && !proxy.input.value) proxy.input.value = kobra.proxy;
      if (kobra.name && !name.input.value) name.input.value = kobra.name;
      if (kobra.email && !email.input.value) email.input.value = kobra.email;
      saveAll();
      take.remove();
      toast(t('settings.sync.fromKobra.done'), 'ok');
    });
    box.insertBefore(h('div', { class: 'btn-row' }, take), repo.row);
  }
  box.append(h('div', { class: 'btn-row' }, test, syncNow), result);
  return box;
}

function deviceCard({ onChange }) {
  const box = card(t('settings.device'));
  box.id = 'settings-device';
  (async () => {
    const [info, stats] = await Promise.all([storageInfo(), knowledgeStats().catch(() => null)]);
    box.append(h('p', { class: 'muted', text: stats ? t('settings.device.has', { count: stats.total }) : t('settings.device.none') }));
    if (info.quota) box.append(h('p', { class: 'muted small', text: t('settings.device.storage', { used: formatBytes(info.usage), quota: formatBytes(info.quota) }) }));
    box.append(h('p', { class: 'muted small', text: t(info.persisted ? 'settings.device.persisted' : 'settings.device.notPersisted') }));
    if (!stats) return;
    const remove = h('button', { type: 'button', class: 'btn' }, iconEl('trash'), h('span', { text: t('settings.device.remove') }));
    remove.addEventListener('click', async () => {
      const pending = await pendingChanges().catch(() => 0);
      const message = pending ? t('settings.device.remove.pending', { count: pending }) : t('settings.device.remove.confirm');
      if (!(await confirmDialog(t('settings.device.remove'), message, { okLabel: t('action.remove'), danger: true }))) return;
      try {
        await removeLocalCopy();
        toast(t('settings.device.removed'), 'ok');
        onChange();
      } catch (e) {
        toast(explainSyncError(e), 'error', 5000);
      }
    });
    box.append(h('div', { class: 'btn-row' }, remove));
  })();
  return box;
}
