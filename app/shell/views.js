// Views of the workspace: Settings and the placeholder of a module that is still planned (Start is in start.js).
import { h, toast, confirmDialog, formatBytes, modal } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang, setLang } from '../i18n/i18n.js';
import { ACCENTS, READY, SHELL, accentOf, setAccent, paintAccent } from './modules.js';
import { pwaState } from '../services/pwa.js';
import { storageInfo } from '../services/storage.js';
import { loadPref, savePref } from '../services/prefs.js';
import { pythonBundle, pythonStorage, removePython, storePython } from '../services/python.js';
import {
  explainSyncError, kobraSettings, knowledgeStats, pendingChanges, phaseText, removeLocalCopy,
  saveSyncSetting, syncSettings, syncState, testConnection,
} from '../services/sync.js';
import { researchSettings, saveResearchSetting, setSourceOn, sourceOn, testResearch } from '../services/research.js';
import { SOURCES } from '../services/research-sources.js';
import { errorText } from './research-view.js';
import { crawlDefaults } from '../services/crawl.js';
import { MIN_PASSWORD, SettingsFileError, applySettings, collectSettings, diffSettings, exportSettings, fileName, readSettingsFile, undoImport, undoInfo } from '../services/settings-file.js';
import { normalize, forgetPicks } from '../services/search.js';
import { LEARN_SOURCES, learnOn, setLearnOn } from '../services/learn.js';
import { ACTIONS, AREAS, keysOf, formatCombo, setKeys, resetKeys, isDefault, conflictOf, comboOf, hasKeyboard, onKeysChange } from '../services/keys.js';
import { SHORTHAND } from './tex-catalog.js';
import { openTexPalette } from './tex-palette.js';
import { APPEARANCES, appearance, setAppearance } from '../services/theme.js';

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

// Settings (0.17.0): sections in one column with a bar to jump (on the left on a wide screen, as chips on the phone)
// and a search over every setting. Keys and addresses stand together under "Access". What needs a keyboard (Keys)
// shows only where there is one. Everything here travels in the settings file (Backup), except what belongs to this
// device (its name, the keyboard switch, the cache of Python).
const SECTIONS = [
  { id: 'general', icon: 'settings' },
  { id: 'write', icon: 'pen' },
  { id: 'keys', icon: 'keyboard', keyboard: true },
  { id: 'access', icon: 'key' },
  { id: 'knowledge', icon: 'git' },
  { id: 'research', icon: 'search' },
  { id: 'look', icon: 'palette' },
  { id: 'python', icon: 'py' },
  { id: 'device', icon: 'device' },
  { id: 'backup', icon: 'shield' },
  { id: 'plan', icon: 'list' },
];

export function renderSettings(main, { onChange, onCheckUpdate, onSync, section }) {
  const wrap = h('div', { class: 'settings' });
  const nav = h('nav', { class: 'set-nav', 'aria-label': t('settings.title') });
  const body = h('div', { class: 'set-body' });
  const search = h('input', { class: 'field set-search', type: 'search', id: 'settings-search', placeholder: t('settings.search'), 'aria-label': t('settings.search'), autocomplete: 'off' });
  const none = h('p', { class: 'muted set-none', hidden: true, text: t('settings.search.none') });
  wrap.append(nav, body);
  main.append(h('h1', { class: 'view-title', text: t('settings.title') }), wrap);

  const keyboard = hasKeyboard();
  const content = {
    general: () => [languageCard(), searchCard(), aboutCard(onCheckUpdate)],
    write: () => [editorCard(), commandsCard(), macrosCard()],
    keys: () => [keysCard()],
    access: () => [syncCard({ onSync }), researchCard(), kobraCard()],
    knowledge: () => [syncBehaviourCard({ onSync })],
    research: () => [researchSourcesCard(), learnCard()],
    look: () => [appearanceCard(), accentsCard(onChange)],
    python: () => [pythonCard()],
    device: () => [deviceCard({ onChange }), keyboardCard()],
    backup: () => [backupCard()],
    plan: () => [planCard()],
  };
  const links = [];
  for (const sec of SECTIONS) {
    if (sec.keyboard && !keyboard) continue;
    const box = h('section', { class: 'set-sec', id: `set-${sec.id}`, dataset: { sec: sec.id } },
      h('header', { class: 'set-sec-head' }, h('span', { class: 'icon set-sec-icon', html: icon(sec.icon) }),
        h('div', {}, h('h2', { class: 'set-sec-title', text: t(`settings.sec.${sec.id}`) }), h('p', { class: 'muted small', text: t(`settings.sec.${sec.id}.hint`) }))),
      ...content[sec.id]());
    body.append(box);
    const link = h('a', { href: `#/settings/${sec.id}`, class: 'set-link', dataset: { sec: sec.id } }, h('span', { class: 'icon', html: icon(sec.icon) }), h('span', { text: t(`settings.sec.${sec.id}`) }));
    link.addEventListener('click', (e) => { e.preventDefault(); search.value = ''; filter(); jump(sec.id); history.replaceState(history.state, '', `#/settings/${sec.id}`); });
    links.push(link);
  }
  body.append(none);
  nav.append(search, h('div', { class: 'set-links' }, ...links));

  // search: every card that holds all the words, its section above it
  function filter() {
    const words = normalize(search.value.trim()).split(/\s+/).filter(Boolean);
    let any = false;
    for (const sec of body.querySelectorAll('.set-sec')) {
      let hits = 0;
      for (const c of sec.querySelectorAll(':scope > .card')) {
        const hay = normalize(`${c.textContent} ${[...c.querySelectorAll('input')].map((i) => `${i.placeholder || ''} ${i.getAttribute('aria-label') || ''}`).join(' ')}`);
        const ok = !words.length || words.every((w) => hay.includes(w));
        c.hidden = !ok;
        if (ok) hits++;
      }
      sec.hidden = !hits;
      if (hits) any = true;
    }
    none.hidden = any;
    wrap.classList.toggle('searching', words.length > 0);
  }
  search.addEventListener('input', filter);

  function jump(id) {
    const el = main.querySelector(`#settings-${id}`) || main.querySelector(`#set-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    mark(el.closest('.set-sec')?.dataset.sec);
  }
  // the section you are in is marked in the bar
  function mark(id) { for (const l of links) l.classList.toggle('on', l.dataset.sec === id); }
  const spy = () => {
    const top = main.getBoundingClientRect().top + 90;
    let cur = SECTIONS[0].id;
    for (const sec of body.querySelectorAll('.set-sec:not([hidden])')) if (sec.getBoundingClientRect().top <= top) cur = sec.dataset.sec;
    mark(cur);
  };
  main.addEventListener('scroll', spy, { passive: true });
  mark(SECTIONS[0].id);
  if (section) requestAnimationFrame(() => jump(section));
}

function languageCard() {
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': t('settings.language') });
  for (const lang of ['en', 'de']) {
    seg.append(h('button', {
      type: 'button', class: getLang() === lang ? 'on' : '', 'aria-pressed': String(getLang() === lang), text: t(`settings.language.${lang}`),
      onclick: () => { setLang(lang); },
    }));
  }
  return card(t('settings.language'), seg);
}

// 0.19.0: the search learns what you open after a search; here you see how much and can forget it
function searchCard() {
  const count = () => Object.keys(loadPref('search.learned', {}) || {}).length;
  const line = h('p', { class: 'muted small' });
  const forget = h('button', { type: 'button', class: 'btn small', text: t('settings.finding.forget') });
  const draw = () => { const n = count(); line.textContent = n ? t('settings.finding.count', { n }) : t('settings.finding.none'); forget.hidden = !n; };
  forget.addEventListener('click', async () => {
    if (!(await confirmDialog(t('settings.finding.forget'), t('settings.finding.forget.confirm'), { okLabel: t('settings.finding.forget'), danger: true }))) return;
    forgetPicks();
    draw();
  });
  draw();
  return card(t('settings.finding'), h('p', { class: 'muted small', text: t('settings.finding.hint') }), line, h('div', { class: 'btn-row' }, forget));
}

function aboutCard(onCheckUpdate) {
  const { version } = pwaState();
  return card(t('settings.about'),
    h('p', {}, h('span', { class: 'muted', text: `${t('settings.version')}: ` }), h('span', { text: version || '–' })),
    h('button', { type: 'button', class: 'btn', onclick: onCheckUpdate }, iconEl('refresh'), h('span', { text: t('cmd.update') })));
}

// 0.18.0: light, dark, or as the device is set
function appearanceCard() {
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': t('settings.appearance') });
  const draw = () => {
    const now = appearance();
    seg.replaceChildren(...APPEARANCES.map((a) => h('button', {
      type: 'button', class: now === a ? 'on' : '', 'aria-pressed': String(now === a), dataset: { appearance: a }, text: t(`settings.appearance.${a}`),
      onclick: () => { setAppearance(a); draw(); },
    })));
  };
  draw();
  return card(t('settings.appearance'), seg, h('p', { class: 'muted small', text: t('settings.appearance.hint') }));
}

function accentsCard(onChange) {
  const rows = h('div', { class: 'accent-rows' });
  for (const mod of [SHELL, ...READY]) {
    const current = accentOf(mod.id).id;
    const swatches = h('div', { class: 'swatches' });
    for (const a of ACCENTS) {
      swatches.append(h('button', {
        type: 'button', class: `swatch${a.id === current ? ' on' : ''}`, style: { background: a.color }, title: t(`accent.${a.id}`),
        'aria-label': `${t(`module.${mod.id}.name`)}: ${t(`accent.${a.id}`)}`, 'aria-pressed': String(a.id === current),
        onclick: () => { setAccent(mod.id, a.id); onChange(); },
      }));
    }
    const tile = iconEl(mod.icon, 'tile');
    paintAccent(tile, mod.id);
    rows.append(h('div', { class: 'accent-row' }, tile, h('span', { class: 'accent-name', text: t(`module.${mod.id}.name`) }), swatches));
  }
  return card(t('settings.accents'), h('p', { class: 'muted', text: t('settings.accents.hint') }), rows);
}

// The build plan of the current stage: what is done and what comes
function planCard() {
  const steps = h('ol', { class: 'steps' });
  STAGE.forEach((p, i) => {
    steps.append(h('li', { class: p.done ? 'done' : '' },
      h('span', { class: 'dot', html: p.done ? icon('check') : String(i + 1) }),
      h('span', { text: t(`home.${p.key}`) })));
  });
  const plan = card(t('home.progress.title'), steps, h('p', { class: 'muted small', text: t('home.progress.foundation') }));
  plan.id = 'settings-plan';
  return plan;
}

// ------------------------------------------------------------------ writing (0.17.0)
const check = (id, key, label, hint, fallback = true, onSet = null) => {
  const box = h('input', { type: 'checkbox', id, checked: loadPref(key, fallback) !== false ? true : null });
  box.addEventListener('change', () => { savePref(key, box.checked); onSet?.(box.checked); });
  return h('label', { class: 'set-check', for: id }, box, h('span', {}, h('b', { text: label }), hint ? h('span', { class: 'field-hint', text: hint }) : null));
};

function editorCard() {
  const size = Number(loadPref('editor.fontSize', 16)) || 16;
  const sizes = h('div', { class: 'segmented', role: 'group', 'aria-label': t('settings.write.size') });
  for (const n of [14, 15, 16, 18, 20]) {
    sizes.append(h('button', { type: 'button', class: n === size ? 'on' : '', 'aria-pressed': String(n === size), text: String(n), onclick: (e) => { savePref('editor.fontSize', n); for (const b of sizes.children) b.classList.toggle('on', b === e.currentTarget); } }));
  }
  const mode = loadPref('editor.mode', 'split');
  const modes = h('div', { class: 'segmented', role: 'group', 'aria-label': t('settings.write.mode') });
  for (const m of ['split', 'write', 'preview']) {
    modes.append(h('button', { type: 'button', class: m === mode ? 'on' : '', text: t(`editor.mode.${m}`), onclick: (e) => { savePref('editor.mode', m); for (const b of modes.children) b.classList.toggle('on', b === e.currentTarget); } }));
  }
  const palette = h('button', { type: 'button', class: 'btn small', onclick: () => openTexPalette(() => {}, { inMath: true }) }, h('span', { text: t('settings.write.palette') }));
  const box = card(t('settings.write.editor'),
    h('p', { class: 'muted small', text: t('settings.write.hint') }),
    h('div', { class: 'set-field' }, h('span', { class: 'field-label', text: t('settings.write.size') }), sizes),
    h('div', { class: 'set-field' }, h('span', { class: 'field-label', text: t('settings.write.mode') }), modes),
    check('editor-shorthand', 'editor.shorthand', t('settings.write.shorthand'), t('settings.write.shorthand.hint')),
    shorthandList(),
    check('editor-lists', 'editor.lists', t('settings.write.lists'), t('settings.write.lists.hint')),
    check('editor-brackets', 'editor.brackets', t('settings.write.brackets'), t('settings.write.brackets.hint')),
    check('editor-spell', 'editor.spellcheck', t('settings.write.spell'), ''),
    h('div', { class: 'btn-row' }, palette));
  box.id = 'settings-editor';
  return box;
}

function shorthandList() {
  const rows = SHORTHAND.map((c) => h('tr', {}, h('td', {}, h('code', { text: c.trigger })), h('td', {}, h('code', { text: c.text.replace(/#0/g, '').replace(/#(\d)/g, '□').replace(/\n/g, '↵') })), h('td', { class: 'muted small', text: t(`settings.write.where.${c.where}`) })));
  return h('details', { class: 'set-details' }, h('summary', { class: 'small', text: t('settings.write.shorthand.list', { n: SHORTHAND.length }) }),
    h('div', { class: 'table-wrap' }, h('table', { class: 'set-table' }, h('tbody', {}, ...rows))));
}

// Your own commands: what you type, what it becomes (#1 … for the places to fill, #0 the cursor at the end), where it
// works, and whether it expands by itself or is offered in the completion.
function commandsCard() {
  const box = card(t('settings.write.commands'));
  box.id = 'settings-commands';
  const list = h('div', { class: 'cmd-list' });
  const read = () => (loadPref('editor.commands', []) || []).filter((c) => c && typeof c === 'object');
  const save = (items) => savePref('editor.commands', items.filter((c) => c.trigger.trim() && c.text));
  function draw() {
    const items = read();
    list.replaceChildren(...(items.length ? items.map((c, i) => row(c, i, items)) : [h('p', { class: 'muted small', text: t('settings.write.commands.empty') })]));
  }
  function row(c, i, items) {
    const trig = h('input', { class: 'field cmd-trigger', value: c.trigger, placeholder: t('settings.write.commands.trigger'), 'aria-label': t('settings.write.commands.trigger'), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
    const text = h('input', { class: 'field cmd-text', value: c.text, placeholder: '\\mathcal{L}_{#1}#0', 'aria-label': t('settings.write.commands.text'), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
    const where = h('select', { class: 'field cmd-where', 'aria-label': t('settings.write.commands.where') }, ...['math', 'text', 'any'].map((w) => h('option', { value: w, selected: (c.where || 'any') === w ? true : null, text: t(`settings.write.where.${w}`) })));
    const auto = h('label', { class: 'cmd-auto small' }, h('input', { type: 'checkbox', checked: c.auto ? true : null }), h('span', { text: t('settings.write.commands.auto') }));
    const del = h('button', { type: 'button', class: 'icon-btn', title: t('action.remove'), 'aria-label': t('action.remove'), html: icon('trash') });
    const commit = () => { items[i] = { trigger: trig.value.trim(), text: text.value.replace(/\\n/g, '\n'), where: where.value, auto: auto.firstChild.checked }; save(items); };
    for (const el of [trig, text, where]) el.addEventListener('change', commit);
    auto.firstChild.addEventListener('change', commit);
    del.addEventListener('click', () => { items.splice(i, 1); save(items); draw(); });
    return h('div', { class: 'cmd-row' }, trig, text, where, auto, del);
  }
  const add = h('button', { type: 'button', class: 'btn small', id: 'settings-command-add' }, iconEl('plus'), h('span', { text: t('settings.write.commands.add') }));
  add.addEventListener('click', () => { const items = read(); items.push({ trigger: '', text: '', where: 'math', auto: false }); savePref('editor.commands', items); draw(); list.querySelector('.cmd-row:last-child .cmd-trigger')?.focus(); });
  box.append(h('p', { class: 'muted small', text: t('settings.write.commands.hint') }), list, h('div', { class: 'btn-row' }, add));
  draw();
  return box;
}

// Your own LaTeX macros, used wherever a formula is set (pages, cards, the preview) and offered after "\\".
function macrosCard() {
  const box = card(t('settings.write.macros'));
  box.id = 'settings-macros';
  const area = h('textarea', { class: 'field code-edit', id: 'settings-macros-text', rows: '5', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', placeholder: '\\newcommand{\\vev}[1]{\\langle #1 \\rangle}\n\\newcommand{\\Lag}{\\mathcal{L}}' });
  const own = loadPref('editor.macros', {}) || {};
  area.value = Object.entries(own).map(([k, v]) => { const n = Math.max(0, ...[...String(v).matchAll(/#(\d)/g)].map((m) => +m[1])); return `\\newcommand{${k}}${n ? `[${n}]` : ''}{${v}}`; }).join('\n');
  const status = h('p', { class: 'small muted', role: 'status' });
  area.addEventListener('change', () => {
    const { macros, bad } = parseMacros(area.value);
    savePref('editor.macros', macros);
    status.textContent = bad.length ? t('settings.write.macros.bad', { lines: bad.join(', ') }) : t('settings.write.macros.saved', { n: Object.keys(macros).length });
  });
  box.append(h('p', { class: 'muted small', text: t('settings.write.macros.hint') }), area, status);
  return box;
}
// \newcommand{\name}[n]{expansion} or \name = expansion, one per line → { "\\name": "expansion" }; bad: line numbers.
export function parseMacros(text) {
  const macros = {};
  const bad = [];
  String(text).split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('%')) return;
    const m = line.match(/^\\(?:re)?newcommand\*?\s*\{?(\\[a-zA-Z]+)\}?\s*(?:\[(\d)\])?\s*\{([\s\S]*)\}\s*$/) || line.match(/^(\\[a-zA-Z]+)\s*()=\s*(.+)$/);
    if (!m || m[1].length > 41 || m[3].length > 500) { bad.push(i + 1); return; }
    macros[m[1]] = m[3].trim();
  });
  return { macros, bad };
}

// ------------------------------------------------------------------ keys (0.17.0)
function keysCard() {
  const box = card(t('settings.keys.title'));
  box.id = 'settings-keys';
  box.dataset.devices = 'keyboard';
  const body = h('div', { class: 'keys-list' });
  const reset = h('button', { type: 'button', class: 'btn small', id: 'keys-reset' }, iconEl('undo'), h('span', { text: t('settings.keys.resetAll') }));
  reset.addEventListener('click', async () => { if (await confirmDialog(t('settings.keys.resetAll'), t('settings.keys.resetAll.confirm'), { okLabel: t('settings.keys.resetAll') })) resetKeys(); });
  function draw() {
    body.replaceChildren(...AREAS.map((area) => {
      const acts = ACTIONS.filter((a) => a.area === area);
      return h('div', { class: 'keys-area' }, h('h3', { class: 'set-sub', text: t(`keys.area.${area}`) }),
        h('ul', { class: 'keys-rows' }, ...acts.map((a) => keyRow(a))));
    }));
  }
  function keyRow(a) {
    const combos = keysOf(a.id);
    const chips = h('span', { class: 'keys-chips' }, ...(combos.length ? combos.map((c) => h('kbd', { text: formatCombo(c) })) : [h('span', { class: 'muted small', text: t('settings.keys.none') })]));
    const li = h('li', { class: `keys-row${isDefault(a.id) ? '' : ' changed'}`, dataset: { action: a.id } }, h('span', { class: 'keys-label', text: t(`keys.${a.id}`) }), chips);
    if (a.fixed) return li;
    const change = h('button', { type: 'button', class: 'btn small keys-change', text: t('settings.keys.change') });
    change.addEventListener('click', () => record(a, li, chips));
    const back = isDefault(a.id) ? null : h('button', { type: 'button', class: 'icon-btn keys-default', title: t('settings.keys.default'), 'aria-label': t('settings.keys.default'), html: icon('undo'), onclick: () => resetKeys(a.id) });
    li.append(h('span', { class: 'keys-btns' }, change, back));
    return li;
  }
  // the next key combination you press becomes the key of the action; Escape stops, Backspace clears it
  function record(a, li, chips) {
    li.classList.add('recording');
    chips.replaceChildren(h('span', { class: 'small keys-press', text: t('settings.keys.press') }));
    const onKey = async (e) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener('keydown', onKey, true);
      li.classList.remove('recording');
      if (e.key === 'Escape') { draw(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { setKeys(a.id, []); return; }
      const c = comboOf(e);
      if (!c) { draw(); return; }
      const other = conflictOf(a.id, c);
      if (other) {
        const ok = await confirmDialog(t('settings.keys.taken'), t('settings.keys.taken.text', { keys: formatCombo(c), action: t(`keys.${other}`) }), { okLabel: t('settings.keys.take') });
        if (!ok) { draw(); return; }
        setKeys(other, keysOf(other).filter((k) => formatCombo(k) !== formatCombo(c)));
      }
      setKeys(a.id, [c]);
    };
    window.addEventListener('keydown', onKey, true);
  }
  const off = onKeysChange(() => { if (box.isConnected) draw(); else off(); });
  box.append(h('p', { class: 'muted small', text: t('settings.keys.hint') }), body, h('div', { class: 'btn-row' }, reset));
  draw();
  return box;
}

function keyboardCard() {
  const box = card(t('settings.keyboard'));
  box.id = 'settings-keyboard';
  box.append(check('device-keyboard', 'device.keyboard', t('settings.keyboard.use'), t('settings.keyboard.hint'), false, () => location.reload()));
  return box;
}

// ------------------------------------------------------------------ learning sources and the start mode of research
function learnCard() {
  const box = card(t('settings.learn'));
  box.id = 'settings-learn';
  const list = h('ul', { class: 'research-sources' });
  for (const src of LEARN_SOURCES) {
    const id = `learn-src-${src.id}`;
    const cb = h('input', { type: 'checkbox', id, checked: learnOn(src.id) ? true : null });
    cb.addEventListener('change', () => setLearnOn(src.id, cb.checked));
    list.append(h('li', {}, h('label', { class: 'rs-check', for: id }, cb, h('span', {}, h('strong', { text: src.name }), h('span', { class: 'muted small', text: ` · ${src.groups.map((g) => t(`learn.group.${g}`)).join(', ')}${src.helper ? ` · ${t('settings.learn.helper')}` : ''}` })))));
  }
  const mode = loadPref('research.mode', 'learn');
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': t('settings.learn.mode') });
  for (const m of ['learn', 'papers']) seg.append(h('button', { type: 'button', class: m === mode ? 'on' : '', text: t(`research.mode.${m}`), onclick: (e) => { savePref('research.mode', m); for (const b of seg.children) b.classList.toggle('on', b === e.currentTarget); } }));
  box.append(h('p', { class: 'muted small', text: t('settings.learn.hint') }), h('div', { class: 'set-field' }, h('span', { class: 'field-label', text: t('settings.learn.mode') }), seg), list);
  return box;
}

// ------------------------------------------------------------------ Kobra's access to GitHub (until Kobra gets accounts)
function kobraCard() {
  const box = card(t('settings.kobra'));
  box.id = 'settings-kobra';
  const read = (k) => { try { const v = localStorage.getItem(`kobra.git.${k}`); return v ? String(JSON.parse(v)) : ''; } catch { return ''; } };
  const field = (k, label, attrs) => {
    const input = h('input', { class: 'field', id: `kobra-${k}`, value: read(k), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', ...attrs });
    input.addEventListener('change', () => { try { localStorage.setItem(`kobra.git.${k}`, JSON.stringify(input.value.trim())); } catch { /* storage full */ } });
    return h('label', { class: 'set-field', for: `kobra-${k}` }, h('span', { class: 'field-label', text: label }), input);
  };
  box.append(h('p', { class: 'muted small', text: t('settings.kobra.hint') }),
    field('proxy', t('settings.sync.proxy'), { type: 'url', inputmode: 'url', placeholder: 'https://git-proxy.yourname.workers.dev' }),
    secretField(field('token', t('settings.sync.token'), { type: 'password', autocomplete: 'off', placeholder: 'github_pat_…' })),
    field('name', t('settings.sync.name'), { type: 'text', autocomplete: 'name' }),
    field('email', t('settings.sync.email'), { type: 'email', autocomplete: 'email' }));
  // 0.20.0: more accounts and your repositories live in Kobra; here only how many
  const count = (k) => { try { const v = JSON.parse(localStorage.getItem(`kobra.git.${k}`) || '[]'); return Array.isArray(v) ? v.length : 0; } catch { return 0; } };
  box.append(h('p', { class: 'muted small', id: 'kobra-more', text: t('settings.kobra.more', { accounts: count('accounts') + 1, repos: count('repos') }) }),
    h('a', { class: 'btn small', href: '#/m/kobra', text: t('settings.kobra.open'), onclick: () => { try { localStorage.setItem('kobra.open', JSON.stringify('settings')); } catch { /* ohne Speicher */ } } }));
  return box;
}
// A password field with a button to show it.
function secretField(row) {
  const input = row.querySelector('input');
  const show = h('button', { type: 'button', class: 'btn small', text: t('settings.sync.show') });
  show.addEventListener('click', () => { const hidden = input.type === 'password'; input.type = hidden ? 'text' : 'password'; show.textContent = t(hidden ? 'settings.sync.hide' : 'settings.sync.show'); });
  const r = h('div', { class: 'row-input' });
  input.before(r);
  r.append(input, show);
  return row;
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
    repo.row, branch.row, token.row, proxy.row, name.row, email.row);

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

// How syncing behaves on this device (0.17.0 apart from the access): by itself or not, the name of the device.
function syncBehaviourCard({ onSync }) {
  const s = syncSettings();
  const device = h('input', { class: 'field', id: 'sync-device', value: loadPref('sync.device', ''), placeholder: s.device, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  device.addEventListener('change', () => saveSyncSetting('device', device.value));
  const auto = h('label', { class: 'set-check' }, h('input', { type: 'checkbox', id: 'sync-auto', checked: loadPref('sync.auto', true) !== false ? true : null }),
    h('span', {}, h('b', { text: t('settings.sync.auto') }), h('span', { class: 'field-hint', text: t('settings.sync.auto.hint') })));
  auto.firstChild.addEventListener('change', (e) => savePref('sync.auto', e.target.checked));
  const box = card(t('settings.knowledge.title'), auto,
    h('label', { class: 'set-field', for: 'sync-device' }, h('span', { class: 'field-label', text: t('settings.sync.device') }), device, h('span', { class: 'field-hint', text: t('settings.sync.device.hint') })),
    h('div', { class: 'btn-row' }, syncButton(onSync)));
  box.id = 'settings-knowledge';
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
  // the address in a tab of its own (0.19.0): a short answer with "error" means helper and certificate are fine
  const tryTab = h('button', { type: 'button', class: 'btn small', text: t('settings.research.helperTab') });
  tryTab.addEventListener('click', () => {
    const v = helper.input.value.trim().replace(/\/+$/, '');
    if (/^https:\/\/[^\s/]+$/.test(v)) window.open(`${v}/ping`, '_blank', 'noopener');
    else toast(t('settings.research.helperTabBad'), 'error');
  });
  const addrRow = h('div', { class: 'row-input' });
  helper.input.before(addrRow);
  addrRow.append(helper.input, tryTab);
  const oa = field('openalexKey', t('settings.research.openalex'), { type: 'password', autocomplete: 'off' }, t('settings.research.openalex.hint'), { href: 'https://openalex.org/settings/api', text: 'openalex.org/settings/api' });
  const s2 = field('s2Key', t('settings.research.s2'), { type: 'password', autocomplete: 'off' }, t('settings.research.s2.hint'), { href: 'https://www.semanticscholar.org/product/api', text: 'semanticscholar.org/product/api' });

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
  return h('section', { class: 'card', id: 'settings-research' },
    h('h2', { text: t('settings.research') }),
    h('p', { class: 'muted', text: t('settings.research.hint') }),
    worker.row, token.row,
    h('h3', { class: 'set-sub', text: t('settings.research.helperTitle') }),
    h('p', { class: 'muted small', text: t('settings.research.helperIntro') }),
    helper.row, helperToken.row,
    h('h3', { class: 'set-sub', text: t('settings.research.keys') }),
    oa.row, s2.row,
    h('div', { class: 'btn-row' }, test), result);
}

// Which paper sources the search asks, and what a run through a website starts with.
function researchSourcesCard() {
  const s = researchSettings();
  const list = h('ul', { class: 'research-sources' });
  const lang = getLang();
  for (const src of SOURCES) {
    const box = h('input', { type: 'checkbox', checked: sourceOn(src.id, s) ? true : null, id: `research-src-${src.id}` });
    box.addEventListener('change', () => setSourceOn(src.id, box.checked));
    list.append(h('li', {}, h('label', { class: 'rs-check', for: `research-src-${src.id}` }, box,
      h('span', {}, h('strong', { text: src.name }), h('span', { class: 'muted small', text: ` · ${src.what[lang] || src.what.en}${src.cors === 'no' ? ` · ${t('settings.research.viaWorker')}` : ''}` })))));
  }
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
  return h('section', { class: 'card', id: 'settings-research-sources' },
    h('h2', { text: t('settings.research.sources') }), list,
    h('h3', { class: 'set-sub', text: t('settings.crawl') }),
    h('p', { class: 'muted small', text: t('settings.crawl.hint') }),
    h('div', { class: 'cr-row' }, crawlNum('depth', t('crawl.depth'), cd.depth, { min: '0', max: '10', step: '1' }, t('crawl.depth.hint')),
      crawlNum('max', t('crawl.max'), cd.max, { min: '1', max: '5000', step: '1' }, t('crawl.max.hint'))),
    crawlNum('gap', t('settings.crawl.gap'), cd.gap, { min: '0.5', max: '120', step: '0.5' }, t('settings.crawl.gap.hint')),
    pdfs);
}

// Your settings as an encrypted file (0.14.4.1): save them with a password, load them on another device.
function backupCard() {
  const box = card(t('backup.title'));
  box.id = 'settings-backup';
  box.append(h('p', { class: 'muted', text: t('backup.hint') }));
  const file = h('input', { type: 'file', accept: '.json,application/json', id: 'backup-file', hidden: true });
  const exp = h('button', { type: 'button', class: 'btn', id: 'backup-export' }, iconEl('download'), h('span', { text: t('backup.export') }));
  const imp = h('button', { type: 'button', class: 'btn', id: 'backup-import' }, iconEl('upload'), h('span', { text: t('backup.import') }));
  exp.addEventListener('click', () => exportDialog());
  imp.addEventListener('click', () => { file.value = ''; file.click(); });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { toast(t('backup.err.too-large'), 'error', 5000); return; }
    const opened = await openDialog(await f.text(), f.name);
    if (!opened) return;
    const rows = await previewDialog(opened);
    if (!rows) return;
    const n = applySettings(rows);
    if (!n) { toast(t('backup.nothing'), 'info'); return; }
    location.reload();   // every part of the app reads the new settings
  });
  box.append(h('div', { class: 'btn-row' }, exp, imp), file);
  const undo = undoInfo();
  if (undo) {
    const back = h('button', { type: 'button', class: 'btn small', id: 'backup-undo' }, iconEl('undo'), h('span', { text: t('backup.undo') }));
    back.addEventListener('click', () => { undoImport(); location.reload(); });
    box.append(h('p', { class: 'small backup-done', role: 'status' }, iconEl('check'), h('span', { text: t('backup.loaded', { n: undo.n }) })), h('div', { class: 'btn-row' }, back));
  }
  return box;
}

const backupError = (e) => t(`backup.err.${e instanceof SettingsFileError ? e.code : 'failed'}`, { n: MIN_PASSWORD });
const formField = (label, input, hint) => h('label', { class: 'set-field', for: input.id }, h('span', { class: 'field-label', text: label }), input, hint ? h('span', { class: 'field-hint', text: hint }) : null);
// a name next to the password, so Safari and Chrome keep the password in your keychain and fill it in on the iPhone
const keychainName = () => h('input', { class: 'field', id: 'backup-user', type: 'text', name: 'username', autocomplete: 'username', value: 'Toollib-Einstellungen', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });

function exportDialog() {
  const user = keychainName();
  const pass = h('input', { class: 'field', id: 'backup-pass', type: 'password', name: 'password', autocomplete: 'new-password', minlength: String(MIN_PASSWORD), passwordrules: 'minlength: 20; required: lower; required: upper; required: digit; allowed: ascii-printable;' });
  const pass2 = h('input', { class: 'field', id: 'backup-pass2', type: 'password', name: 'password-repeat', autocomplete: 'new-password', minlength: String(MIN_PASSWORD) });
  const err = h('p', { class: 'field-error backup-error', role: 'alert' });
  const go = h('button', { type: 'submit', class: 'btn primary', id: 'backup-go' }, iconEl('download'), h('span', { text: t('backup.export.go') }));
  const cancel = h('button', { type: 'button', class: 'btn', text: t('action.cancel') });
  const n = Object.keys(collectSettings()).length;
  const form = h('form', { class: 'form backup-form', method: 'post', action: '#', autocomplete: 'on', novalidate: true },
    h('p', { class: 'muted small', text: t('backup.export.what', { n }) }),
    formField(t('backup.user'), user, t('backup.user.hint')),
    formField(t('backup.password'), pass, t('backup.password.hint', { n: MIN_PASSWORD })),
    formField(t('backup.password2'), pass2),
    err, h('div', { class: 'btn-row backup-actions' }, cancel, go));
  return modal({
    title: t('backup.export'), body: form, actions: [], dismissValue: null,
    onOpen: (content, close) => {
      cancel.addEventListener('click', () => close(null));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.textContent = '';
        if (pass.value.length < MIN_PASSWORD) { err.textContent = backupError(new SettingsFileError('short')); return; }
        if (pass.value !== pass2.value) { err.textContent = backupError(new SettingsFileError('mismatch')); return; }
        go.disabled = true;
        err.textContent = t('backup.working');
        try {
          const text = await exportSettings(pass.value, { confirm: pass2.value, device: syncSettings().device });
          const out = new File([text], fileName(), { type: 'application/json' });
          const coarse = window.matchMedia?.('(pointer: coarse)').matches;
          if (coarse && navigator.canShare?.({ files: [out] })) {
            // iPhone: sharing needs a fresh tap, so the file waits for one (AirDrop, Files, …)
            err.textContent = '';
            form.replaceChildren(h('p', { class: 'small backup-done', role: 'status' }, iconEl('check'), h('span', { text: t('backup.ready', { name: out.name }) })),
              h('div', { class: 'btn-row backup-actions' },
                h('button', { type: 'button', class: 'btn', onclick: () => { saveFile(out); close(true); } }, iconEl('download'), h('span', { text: t('backup.save') })),
                h('button', { type: 'button', class: 'btn primary', onclick: async () => { try { await navigator.share({ files: [out], title: out.name }); close(true); } catch (x) { if (x?.name !== 'AbortError') { saveFile(out); close(true); } } } }, iconEl('upload'), h('span', { text: t('backup.share') }))));
            return;
          }
          saveFile(out);
          toast(t('backup.saved', { name: out.name }), 'ok', 5000);
          close(true);
        } catch (x) {
          err.textContent = backupError(x);
          go.disabled = false;
        } finally {
          setTimeout(() => { pass.value = ''; pass2.value = ''; }, 500);   // after the keychain took it
        }
      });
      setTimeout(() => pass.focus(), 60);
    },
  });
}

function saveFile(out) {
  const url = URL.createObjectURL(out);
  const a = h('a', { href: url, download: out.name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// The password of a file; tries again on a wrong one. Resolves to what readSettingsFile gives, or null.
function openDialog(text, name) {
  const user = keychainName();
  const pass = h('input', { class: 'field', id: 'backup-open-pass', type: 'password', name: 'password', autocomplete: 'current-password' });
  const err = h('p', { class: 'field-error backup-error', role: 'alert' });
  const go = h('button', { type: 'submit', class: 'btn primary', id: 'backup-open' }, iconEl('upload'), h('span', { text: t('backup.open') }));
  const cancel = h('button', { type: 'button', class: 'btn', text: t('action.cancel') });
  const form = h('form', { class: 'form backup-form', method: 'post', action: '#', autocomplete: 'on', novalidate: true },
    h('p', { class: 'muted small backup-file-name', text: name }),
    formField(t('backup.user'), user),
    formField(t('backup.password'), pass),
    err, h('div', { class: 'btn-row backup-actions' }, cancel, go));
  return modal({
    title: t('backup.import'), body: form, actions: [], dismissValue: null,
    onOpen: (content, close) => {
      cancel.addEventListener('click', () => close(null));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        go.disabled = true;
        err.textContent = t('backup.working');
        try {
          const opened = await readSettingsFile(text, pass.value);
          setTimeout(() => { pass.value = ''; }, 500);
          close(opened);
        } catch (x) {
          err.textContent = backupError(x);
          go.disabled = false;
          if (x?.code === 'wrong-password') { pass.select(); } else if (x instanceof SettingsFileError) pass.disabled = true;
        }
      });
      setTimeout(() => pass.focus(), 60);
    },
  });
}

// What the file would change, one box per setting; secrets stay hidden. Resolves to the chosen rows or null.
const SETTING_LABEL = {
  lang: ['', 'settings.language'], 'sync.repo': ['settings.sync', 'settings.sync.repo'], 'sync.branch': ['settings.sync', 'settings.sync.branch'], 'sync.token': ['settings.sync', 'settings.sync.token'],
  'sync.proxy': ['settings.sync', 'settings.sync.proxy'], 'sync.name': ['settings.sync', 'settings.sync.name'], 'sync.email': ['settings.sync', 'settings.sync.email'], 'sync.auto': ['settings.sync', 'settings.sync.auto'],
  'research.worker': ['settings.research', 'settings.research.worker'], 'research.token': ['settings.research', 'settings.research.token'], 'research.helper': ['settings.research', 'settings.research.helper'],
  'research.helperToken': ['settings.research', 'settings.research.helperToken'], 'research.openalexKey': ['settings.research', 'settings.research.openalex'], 'research.s2Key': ['settings.research', 'settings.research.s2'],
  'research.off': ['settings.research', 'backup.sourcesOff'], 'crawl.depth': ['settings.crawl', 'crawl.depth'], 'crawl.max': ['settings.crawl', 'crawl.max'], 'crawl.gap': ['settings.crawl', 'settings.crawl.gap'], 'crawl.pdfs': ['settings.crawl', 'crawl.pdfs'],
  'editor.fontSize': ['settings.sec.write', 'settings.write.size'], 'editor.shorthand': ['settings.sec.write', 'settings.write.shorthand'], 'editor.lists': ['settings.sec.write', 'settings.write.lists'],
  'editor.brackets': ['settings.sec.write', 'settings.write.brackets'], 'editor.spellcheck': ['settings.sec.write', 'settings.write.spell'], 'editor.mode': ['settings.sec.write', 'settings.write.mode'],
  'editor.commands': ['settings.sec.write', 'settings.write.commands'], 'editor.macros': ['settings.sec.write', 'settings.write.macros'], keys: ['', 'settings.sec.keys'],
  'learn.off': ['settings.research', 'backup.learnOff'], 'research.mode': ['settings.research', 'backup.researchMode'],
  appearance: ['settings.sec.look', 'settings.appearance'],
  'search.learned': ['settings.sec.general', 'settings.finding'],
};
function settingLabel(key) {
  const k = key.replace(/^toollib\./, '');
  if (SETTING_LABEL[k]) return SETTING_LABEL[k].filter(Boolean).map((x) => t(x)).join(' › ');
  if (k.startsWith('accent.')) return `${t('settings.accents')} › ${t(`module.${k.slice(7)}.name`)}`;
  const m = key.match(/^kobra\.git\.([a-z]+)$/);
  if (m) return `Kobra › ${t(['accounts', 'repos', 'label', 'login', 'host'].includes(m[1]) ? `settings.kobra.${m[1]}` : `settings.sync.${m[1]}`)}`;
  return k;
}
function settingValue(r, v) {
  if (v === undefined || v === '') return t('backup.empty');
  if (r.secret) return '••••••';
  if (typeof v === 'boolean') return t(v ? 'backup.yes' : 'backup.no');
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.length ? v.join(', ') : t('backup.empty');
  if (v && typeof v === 'object') { const n = Array.isArray(v) ? v.length : Object.keys(v).length; return n ? t('backup.entries', { n }) : t('backup.empty'); }
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}
const isLocal = (v) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(String(v || ''));

function previewDialog(opened) {
  const rows = diffSettings(opened.settings);
  const todo = rows.filter((r) => r.state !== 'same');
  const same = rows.length - todo.length;
  const boxes = new Map();
  const list = h('ul', { class: 'backup-list' });
  for (const r of todo) {
    const helperHere = r.key === 'toollib.research.helper' && isLocal(r.next);
    // the Mac's own address would not reach the helper from another device that already has one
    const box = h('input', { type: 'checkbox', checked: helperHere && r.state === 'changed' ? null : true, dataset: { key: r.key } });
    boxes.set(r, box);
    list.append(h('li', {}, h('label', { class: 'rs-check backup-row' }, box,
      h('span', {}, h('strong', { text: settingLabel(r.key) }), h('span', { class: `rs-tag${r.state === 'new' ? '' : ' muted'}`, text: t(`backup.state.${r.state}`) }),
        h('span', { class: 'muted small backup-values', text: r.state === 'new' ? settingValue(r, r.next) : `${settingValue(r, r.now)} → ${settingValue(r, r.next)}` }),
        helperHere ? h('span', { class: 'field-hint', text: t('backup.localHint') }) : null))));
  }
  const when = opened.created ? new Date(opened.created) : null;
  const from = t('backup.from', { device: opened.device || '?', date: when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString(getLang()) : '?' });
  const body = h('div', { class: 'backup-preview' },
    h('p', { class: 'small', text: from }),
    todo.length ? list : h('p', { class: 'muted', text: t('backup.allSame') }),
    h('p', { class: 'muted small', text: [same ? t('backup.same', { n: same }) : '', opened.ignored ? t('backup.ignored', { n: opened.ignored }) : '', t('backup.others')].filter(Boolean).join(' ') }));
  return modal({
    title: t('backup.preview'), body, wide: true,
    actions: [
      { label: t('action.cancel'), value: null },
      { label: t('backup.apply'), kind: 'primary', value: () => todo.filter((r) => boxes.get(r).checked) },
    ],
  });
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
