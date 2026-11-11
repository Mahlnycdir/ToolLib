// Views of the workspace: Home, Settings and the placeholder of a module that is still planned.
import { h, toast, confirmDialog, formatBytes } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang, setLang } from '../i18n/i18n.js';
import { ACCENTS, MODULES, SHELL, accentOf, setAccent, paintAccent } from './modules.js';
import { isStandalone, platform, pwaState } from '../services/pwa.js';
import { storageInfo } from '../services/storage.js';
import { loadPref, savePref } from '../services/prefs.js';
import { nodeHref, recentList } from './node-view.js';
import { conflictActions } from './conflict-actions.js';
import { pythonBundle, pythonStorage, removePython, storePython } from '../services/python.js';
import {
  explainSyncError, isConfigured, kobraSettings, knowledgeStats, pendingChanges, phaseText, removeLocalCopy,
  saveSyncSetting, syncSettings, syncState, testConnection,
} from '../services/sync.js';
import { researchSettings, saveResearchSetting, setSourceOn, sourceOn, testResearch } from '../services/research.js';
import { SOURCES } from '../services/research-sources.js';
import { errorText } from './research-view.js';
import { crawlDefaults } from '../services/crawl.js';

// Progress of the current stage: the formulary (stage 3). The foundation and stage 2 are done.
// Mark a point as done when it is delivered; ENTE decides the order of the open ones.
const STAGE = [
  { key: 'stage3.typeset', done: true },
  { key: 'stage3.module', done: true },
  { key: 'stage3.wave1', done: true },
  { key: 'stage3.choices', done: true },
  { key: 'stage3.wave2', done: true },
  { key: 'stage3.wave3', done: false },
  { key: 'stage3.wave4', done: false },
  { key: 'stage3.mathlib', done: false },
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
    const note = h('div', { class: 'note warn' });
    for (const copy of stats.conflicts) {
      const li = h('li', {}, h('a', { href: nodeHref(copy), text: copy }), ' ',
        h('span', { class: 'muted small', text: t('home.knowledge.conflictOf', { path: originalOf(copy) }) }),
        conflictActions(copy, () => { li.remove(); if (!list.children.length) note.remove(); }));
      list.append(li);
    }
    note.append(iconEl('warn'), h('div', {},
      h('p', { text: t('home.knowledge.conflicts', { count: stats.conflicts.length }) }), list));
    box.append(note);
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
  main.append(researchCard());
  main.append(deviceCard({ onChange }));
  main.append(pythonCard());

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
  const auto = h('label', { class: 'set-check' }, h('input', { type: 'checkbox', id: 'sync-auto', checked: loadPref('sync.auto', true) !== false ? true : null }),
    h('span', {}, h('b', { text: t('settings.sync.auto') }), h('span', { class: 'field-hint', text: t('settings.sync.auto.hint') })));
  auto.firstChild.addEventListener('change', (e) => savePref('sync.auto', e.target.checked));
  box.append(auto, h('div', { class: 'btn-row' }, test, syncNow), result);
  return box;
}

// Research (0.14.0): your fetcher for the sites the browser may not read directly, the free keys, the sources.
function researchCard() {
  const s = researchSettings();
  const field = (key, label, attrs, hint, link) => {
    const input = h('input', { class: 'field', id: `research-${key}`, value: s[key] || '', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', ...attrs });
    input.addEventListener('change', () => saveResearchSetting(key, input.value));
    const hintEl = hint ? h('span', { class: 'field-hint' }, h('span', { text: hint }), link ? ' ' : null,
      link ? h('a', { href: link.href, target: '_blank', rel: 'noopener noreferrer', text: link.text }) : null) : null;
    return { input, row: h('label', { class: 'set-field', for: `research-${key}` }, h('span', { class: 'field-label', text: label }), input, hintEl) };
  };
  const worker = field('worker', t('settings.research.worker'), { type: 'url', placeholder: 'https://toollib-fetch.yourname.workers.dev', inputmode: 'url' }, t('settings.research.worker.hint'));
  const token = field('token', t('settings.research.token'), { type: 'password', autocomplete: 'off' }, t('settings.research.token.hint'));
  const show = h('button', { type: 'button', class: 'btn small', text: t('settings.sync.show') });
  show.addEventListener('click', () => {
    const hidden = token.input.type === 'password';
    token.input.type = hidden ? 'text' : 'password';
    show.textContent = t(hidden ? 'settings.sync.hide' : 'settings.sync.show');
  });
  const tokenRow = h('div', { class: 'row-input' });
  token.input.before(tokenRow);
  tokenRow.append(token.input, show);
  // the Mac helper (0.14.4): your address at home, pages with JavaScript, the PDF folder
  const helper = field('helper', t('settings.research.helper'), { type: 'url', placeholder: 'https://localhost:8413', inputmode: 'url' }, t('settings.research.helper.hint'));
  const helperToken = field('helperToken', t('settings.research.helperToken'), { type: 'password', autocomplete: 'off' }, t('settings.research.helperToken.hint'));
  const showH = h('button', { type: 'button', class: 'btn small', text: t('settings.sync.show') });
  showH.addEventListener('click', () => {
    const hidden = helperToken.input.type === 'password';
    helperToken.input.type = hidden ? 'text' : 'password';
    showH.textContent = t(hidden ? 'settings.sync.hide' : 'settings.sync.show');
  });
  const helperRow = h('div', { class: 'row-input' });
  helperToken.input.before(helperRow);
  helperRow.append(helperToken.input, showH);
  const oa = field('openalexKey', t('settings.research.openalex'), { type: 'password', autocomplete: 'off' }, t('settings.research.openalex.hint'), { href: 'https://openalex.org/settings/api', text: 'openalex.org/settings/api' });
  const s2 = field('s2Key', t('settings.research.s2'), { type: 'password', autocomplete: 'off' }, t('settings.research.s2.hint'), { href: 'https://www.semanticscholar.org/product/api', text: 'semanticscholar.org/product/api' });

  const list = h('ul', { class: 'research-sources' });
  const lang = getLang();
  for (const src of SOURCES) {
    const box = h('input', { type: 'checkbox', checked: sourceOn(src.id, s) ? true : null, id: `research-src-${src.id}` });
    box.addEventListener('change', () => setSourceOn(src.id, box.checked));
    list.append(h('li', {}, h('label', { class: 'rs-check', for: `research-src-${src.id}` }, box,
      h('span', {}, h('strong', { text: src.name }), h('span', { class: 'muted small', text: ` · ${src.what[lang] || src.what.en}${src.cors === 'no' ? ` · ${t('settings.research.viaWorker')}` : ''}` })))));
  }

  const result = h('ul', { class: 'checks', role: 'status' });
  const line = (l) => h('li', { class: `check ${l.status}` },
    iconEl({ ok: 'check', warn: 'warn', fail: 'close', info: 'info', busy: 'refresh' }[l.status] || 'info', l.status === 'busy' ? 'spin' : ''),
    h('span', { text: l.key.startsWith('research.err.') ? `${l.vars.name}: ${errorText(l.vars.id, l.key.slice(13), l.vars.status)}` : t(l.key, l.vars) }));
  const test = h('button', { type: 'button', class: 'btn' }, iconEl('link'), h('span', { text: t('settings.sync.test') }));
  test.addEventListener('click', async () => {
    for (const f of [worker, token, helper, helperToken, oa, s2]) saveResearchSetting(f.input.id.replace('research-', ''), f.input.value);
    test.disabled = true;
    try {
      await testResearch((lines) => result.replaceChildren(...lines.map(line)));
    } finally {
      test.disabled = false;
    }
  });
  // going through a website (0.14.3): what a new run starts with
  const cd = crawlDefaults();
  const crawlNum = (key, label, value, attrs, hint) => {
    const input = h('input', { class: 'field', type: 'number', id: `crawl-set-${key}`, value: String(value), ...attrs });
    input.addEventListener('change', () => { const n = Number(input.value); if (Number.isFinite(n)) savePref(`crawl.${key}`, key === 'gap' ? Math.max(0.5, n) : n); input.value = String(crawlDefaults()[key]); });
    return h('label', { class: 'set-field', for: `crawl-set-${key}` }, h('span', { class: 'field-label', text: label }), input, h('span', { class: 'field-hint', text: hint }));
  };
  const pdfs = h('label', { class: 'set-check' }, h('input', { type: 'checkbox', id: 'crawl-set-pdfs', checked: cd.pdfs ? true : null }),
    h('span', {}, h('b', { text: t('crawl.pdfs') }), h('span', { class: 'field-hint', text: t('crawl.pdfs.hint') })));
  pdfs.firstChild.addEventListener('change', (e) => savePref('crawl.pdfs', e.target.checked));
  return h('section', { class: 'card', id: 'settings-research' },
    h('h2', { text: t('settings.research') }),
    h('p', { class: 'muted', text: t('settings.research.hint') }),
    worker.row, token.row,
    h('h3', { class: 'set-sub', text: t('settings.research.helperTitle') }),
    h('p', { class: 'muted small', text: t('settings.research.helperIntro') }),
    helper.row, helperToken.row,
    h('h3', { class: 'set-sub', text: t('settings.research.keys') }),
    oa.row, s2.row,
    h('h3', { class: 'set-sub', text: t('settings.research.sources') }), list,
    h('div', { class: 'btn-row' }, test), result,
    h('h3', { class: 'set-sub', text: t('settings.crawl') }),
    h('p', { class: 'muted small', text: t('settings.crawl.hint') }),
    h('div', { class: 'cr-row' }, crawlNum('depth', t('crawl.depth'), cd.depth, { min: '0', max: '10', step: '1' }, t('crawl.depth.hint')),
      crawlNum('max', t('crawl.max'), cd.max, { min: '1', max: '5000', step: '1' }, t('crawl.max.hint'))),
    crawlNum('gap', t('settings.crawl.gap'), cd.gap, { min: '0.5', max: '120', step: '0.5' }, t('settings.crawl.gap.hint')),
    pdfs);
}

// Python for running snippets: what Toollib ships and whether it is stored on this device for offline use.
function pythonCard() {
  const box = card(t('settings.python'));
  box.id = 'settings-python';
  const body = h('div', { class: 'python-card' });
  box.append(body);
  const draw = async () => {
    let info;
    let stored;
    try {
      info = await pythonBundle();
      stored = await pythonStorage();
    } catch (e) {
      console.warn('Python bundle', e);
      body.replaceChildren(h('p', { class: 'muted', text: t('settings.python.unavailable') }));
      return;
    }
    const size = (n) => formatBytes(n);
    const statusText = () => (stored.complete ? t('settings.python.stored', { size: size(info.total) })
      : stored.stored ? t('settings.python.partly', { stored: size(stored.stored), total: size(info.total) })
        : t('settings.python.none', { total: size(info.total) }));
    const status = h('p', { class: 'small python-status', text: statusText() });
    if (stored.complete) status.prepend(iconEl('check'), ' ');
    const bar = h('span', { style: { width: `${Math.round((stored.stored / info.total) * 100)}%` } });
    const meter = h('span', { class: 'meter', role: 'progressbar', 'aria-label': t('settings.python'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round((stored.stored / info.total) * 100)) }, bar);
    const store = h('button', { type: 'button', class: 'btn primary' }, iconEl('download'), h('span', { text: t('settings.python.store') }));
    const remove = h('button', { type: 'button', class: 'btn' }, iconEl('trash'), h('span', { text: t('settings.python.remove') }));
    store.addEventListener('click', async () => {
      if (!navigator.serviceWorker?.controller) { toast(t('settings.python.noWorker'), 'error', 5000); return; }
      store.disabled = true;
      remove.disabled = true;
      try {
        await storePython((done, total) => {
          const pct = Math.round((done / total) * 100);
          bar.style.width = `${pct}%`;
          meter.setAttribute('aria-valuenow', String(pct));
          status.textContent = t('settings.python.storing', { done: size(done), total: size(total) });
        });
        toast(t('settings.python.storedToast'), 'ok');
      } catch (e) {
        toast(t('settings.python.storeFailed', { error: e.message || String(e) }), 'error', 6000);
      }
      draw();
    });
    remove.addEventListener('click', async () => {
      if (!(await confirmDialog(t('settings.python.remove'), t('settings.python.remove.confirm', { size: size(stored.stored) }), { okLabel: t('action.remove'), danger: true }))) return;
      await removePython().catch((e) => console.warn(e));
      toast(t('settings.python.removed'), 'ok');
      draw();
    });
    const versions = ['numpy', 'scipy', 'matplotlib', 'sympy'].map((n) => `${n} ${info.versions?.[n] || ''}`.trim()).join(' · ');
    body.replaceChildren(
      h('p', { class: 'muted', text: t('settings.python.hint', { python: info.python, pyodide: info.pyodide }) }),
      h('p', { class: 'muted small', text: versions }),
      h('div', { class: 'python-store' }, meter, status),
      h('div', { class: 'btn-row' }, stored.complete ? null : store, stored.stored ? remove : null));
  };
  draw();
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
