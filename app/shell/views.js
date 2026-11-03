// Views of the workspace: Home, Settings and the placeholder of a module that is still planned.
import { h } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang, setLang } from '../i18n/i18n.js';
import { ACCENTS, MODULES, SHELL, accentOf, setAccent, paintAccent } from './modules.js';
import { isStandalone, platform, pwaState } from '../services/pwa.js';

// Progress of the foundation; bump DONE when a step is delivered.
const STEPS = 5;
const DONE = 3;

const card = (title, ...children) => h('section', { class: 'card' }, title ? h('h2', { text: title }) : null, ...children);
const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

export function renderHome(main) {
  main.append(h('h1', { class: 'view-title', text: t('home.title') }));
  main.append(h('p', { class: 'lead', text: t('app.tagline') }));

  if (!isStandalone()) {
    const how = { ios: 'home.install.ios', mac: 'home.install.mac' }[platform()] || 'home.install.other';
    main.append(card(t('home.install.title'), h('p', { class: 'muted', text: t(how) })));
  }

  const steps = h('ol', { class: 'steps' });
  for (let i = 1; i <= STEPS; i++) {
    const state = i <= DONE ? 'done' : i === DONE + 1 ? 'next' : '';
    steps.append(h('li', { class: state },
      h('span', { class: 'dot', html: state === 'done' ? icon('check') : String(i) }),
      h('span', { text: t(`home.step${i}`) })));
  }
  main.append(card(t('home.progress.title'), steps));

  const grid = h('div', { class: 'grid-2' },
    card(t('home.projects.title'), h('p', { class: 'muted', text: t('home.projects.empty') })),
    card(t('home.recent.title'), h('p', { class: 'muted', text: t('home.recent.empty') })));
  main.append(grid);
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

export function renderSettings(main, { onChange, onCheckUpdate }) {
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
}
