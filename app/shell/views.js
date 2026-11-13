// Views of the workspace that are not tools: the placeholder of a planned module, and two small helpers the start
// page and the settings share (formatTime, syncButton). Since 0.25.0 the settings live in app/shell/settings/, one
// file per page, opened from the control centre in settings/index.js.
import { h } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { phaseText, syncState } from '../services/sync.js';

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
