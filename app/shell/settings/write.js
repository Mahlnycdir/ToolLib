// Settings › Writing: the editor, shorthand, your own commands and TeX macros.
import { h } from '../../services/ui.js';
import { icon } from '../../services/icons.js';
import { t } from '../../i18n/i18n.js';
import { loadPref, savePref } from '../../services/prefs.js';
import { SHORTHAND } from '../tex-catalog.js';
import { openTexPalette } from '../tex-palette.js';
import { card, iconEl, check } from './parts.js';

export function editorCard() {
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

export function shorthandList() {
  const rows = SHORTHAND.map((c) => h('tr', {}, h('td', {}, h('code', { text: c.trigger })), h('td', {}, h('code', { text: c.text.replace(/#0/g, '').replace(/#(\d)/g, '□').replace(/\n/g, '↵') })), h('td', { class: 'muted small', text: t(`settings.write.where.${c.where}`) })));
  return h('details', { class: 'set-details' }, h('summary', { class: 'small', text: t('settings.write.shorthand.list', { n: SHORTHAND.length }) }),
    h('div', { class: 'table-wrap' }, h('table', { class: 'set-table' }, h('tbody', {}, ...rows))));
}

// Your own commands: what you type, what it becomes (#1 … for the places to fill, #0 the cursor at the end), where it
// works, and whether it expands by itself or is offered in the completion.
export function commandsCard() {
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
export function macrosCard() {
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
