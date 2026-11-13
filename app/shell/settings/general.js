// Settings › General: language, what the search learned, version and update, and the build plan.
import { h, confirmDialog } from '../../services/ui.js';
import { icon } from '../../services/icons.js';
import { t, getLang, setLang } from '../../i18n/i18n.js';
import { pwaState } from '../../services/pwa.js';
import { loadPref } from '../../services/prefs.js';
import { forgetPicks } from '../../services/search.js';
import { card, iconEl } from './parts.js';

// Progress of the current stage: the formulary (stage 3). The foundation and stage 2 are done.
// Mark a point as done when it is delivered; ENTE decides the order of the open ones.
export const STAGE = [
  { key: 'stage3.typeset', done: true },
  { key: 'stage3.module', done: true },
  { key: 'stage3.wave1', done: true },
  { key: 'stage3.choices', done: true },
  { key: 'stage3.wave2', done: true },
  { key: 'stage3.wave3', done: false },
  { key: 'stage3.wave4', done: false },
  { key: 'stage3.mathlib', done: false },
];

export function languageCard() {
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
export function searchCard() {
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

export function aboutCard(onCheckUpdate) {
  const { version } = pwaState();
  return card(t('settings.about'),
    h('p', {}, h('span', { class: 'muted', text: `${t('settings.version')}: ` }), h('span', { text: version || '–' })),
    h('button', { type: 'button', class: 'btn', onclick: onCheckUpdate }, iconEl('refresh'), h('span', { text: t('cmd.update') })));
}

// The build plan of the current stage: what is done and what comes
export function planCard() {
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
