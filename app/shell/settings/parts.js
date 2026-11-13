// Settings (0.25.0): small building blocks every settings page uses: a card, an icon, a switch, a secret field.
import { h } from '../../services/ui.js';
import { icon } from '../../services/icons.js';
import { t } from '../../i18n/i18n.js';
import { loadPref, savePref } from '../../services/prefs.js';

export const card = (title, ...children) => h('section', { class: 'card' }, title ? h('h2', { text: title }) : null, ...children);

export const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

// ------------------------------------------------------------------ writing (0.17.0)
export const check = (id, key, label, hint, fallback = true, onSet = null) => {
  const box = h('input', { type: 'checkbox', id, checked: loadPref(key, fallback) !== false ? true : null });
  box.addEventListener('change', () => { savePref(key, box.checked); onSet?.(box.checked); });
  return h('label', { class: 'set-check', for: id }, box, h('span', {}, h('b', { text: label }), hint ? h('span', { class: 'field-hint', text: hint }) : null));
};

// A password field with a button to show it.
export function secretField(row) {
  const input = row.querySelector('input');
  const show = h('button', { type: 'button', class: 'btn small', text: t('settings.sync.show') });
  show.addEventListener('click', () => { const hidden = input.type === 'password'; input.type = hidden ? 'text' : 'password'; show.textContent = t(hidden ? 'settings.sync.hide' : 'settings.sync.show'); });
  const r = h('div', { class: 'row-input' });
  input.before(r);
  r.append(input, show);
  return row;
}
