// Settings › Look: light or dark, and one colour per tool (the kinds of nodes follow their tool's colour).
import { h } from '../../services/ui.js';
import { t } from '../../i18n/i18n.js';
import { ACCENTS, READY, SHELL, accentOf, setAccent, paintAccent } from '../modules.js';
import { APPEARANCES, appearance, setAppearance } from '../../services/theme.js';
import { card, iconEl } from './parts.js';

// 0.18.0: light, dark, or as the device is set
export function appearanceCard() {
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
