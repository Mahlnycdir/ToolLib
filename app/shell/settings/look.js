// Settings › Look: night or mist (Waldnacht, Morgennebel; 0.32.0), whether the light breathes, and one colour per tool
// (the kinds of nodes follow their tool's colour).
import { h } from '../../services/ui.js';
import { t } from '../../i18n/i18n.js';
import { ACCENTS, READY, SHELL, accentOf, setAccent, paintAccent } from '../modules.js';
import { APPEARANCES, appearance, calm, setAppearance, setMotion } from '../../services/theme.js';
import { card, iconEl } from './parts.js';

// 0.18.0: light, dark, or as the device is set; since 0.32.0 three small pictures of the sets, and "Light breathes"
const SET_CLASS = { dark: 'night', light: 'mist', system: 'system' };
export function appearanceCard() {
  const sets = h('div', { class: 'look-sets', role: 'group', 'aria-label': t('settings.appearance') });
  const draw = () => {
    const now = appearance();
    sets.replaceChildren(...['dark', 'light', 'system'].filter((a) => APPEARANCES.includes(a)).map((a) => h('button', {
      type: 'button', class: `look-set ${SET_CLASS[a]}${now === a ? ' on' : ''}`, 'aria-pressed': String(now === a), dataset: { appearance: a }, text: t(`settings.appearance.${a}`),
      onclick: () => { setAppearance(a); draw(); },
    })));
  };
  draw();
  const motion = h('input', { type: 'checkbox', id: 'look-motion', checked: calm() ? null : true });
  motion.addEventListener('change', () => setMotion(motion.checked));
  return card(t('settings.appearance'), sets, h('p', { class: 'muted small', text: t('settings.appearance.hint') }),
    h('label', { class: 'set-check', for: 'look-motion' }, motion, h('span', {}, h('b', { text: t('settings.look.motion') }), h('span', { class: 'field-hint', text: t('settings.look.motion.hint') }))));
}

export function accentsCard(onChange) {
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
