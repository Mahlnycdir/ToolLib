// Settings › Loom (0.32.0): what Loom, the second voice, may do. The conversation itself comes in 0.33; the choices
// are kept already, so they are there when it arrives:
//   loom.suggest   'quiet' | 'more' | 'off'   how many suggestions (each one says why it comes)
//   loom.attach    true | false               finds join the chapter you came from when you surface
//   loom.model     'none'                     where Loom's sentences come from; 'none' = only your knowledge and your
//                                             research, with sources. A model is one more value here later (decided 16.11.:
//                                             first without a language model, easy to add afterwards).
import { h } from '../../services/ui.js';
import { t } from '../../i18n/i18n.js';
import { loadPref, savePref } from '../../services/prefs.js';
import { card, check } from './parts.js';

export const LOOM_SUGGEST = ['quiet', 'more', 'off'];
export const LOOM_MODELS = ['none'];
export const loomSuggest = () => { const v = loadPref('loom.suggest', 'quiet'); return LOOM_SUGGEST.includes(v) ? v : 'quiet'; };
export const loomModel = () => { const v = loadPref('loom.model', 'none'); return LOOM_MODELS.includes(v) ? v : 'none'; };

const row = (label, hint, control) => h('div', { class: 'loom-row' }, h('div', {}, h('b', { text: label }), h('p', { class: 'muted', text: hint })), control);

export function loomTalkCard() {
  const listen = h('span', { class: 'chip muted', text: t('settings.loom.listen.value') });
  const seg = h('div', { class: 'segmented small', role: 'group', 'aria-label': t('settings.loom.suggest') });
  const draw = () => {
    const now = loomSuggest();
    seg.replaceChildren(...LOOM_SUGGEST.map((v) => h('button', {
      type: 'button', class: now === v ? 'on' : '', 'aria-pressed': String(now === v), dataset: { suggest: v }, text: t(`settings.loom.suggest.${v}`),
      onclick: () => { savePref('loom.suggest', v); draw(); },
    })));
  };
  draw();
  return h('section', { class: 'card', id: 'settings-loom' }, h('h2', { text: t('settings.loom.talk') }),
    row(t('settings.loom.listen'), t('settings.loom.listen.hint'), listen),
    row(t('settings.loom.suggest'), t('settings.loom.suggest.hint'), seg),
    check('loom-attach', 'loom.attach', t('settings.loom.attach'), t('settings.loom.attach.hint'), true));
}

export function loomModelCard() {
  const select = h('select', { class: 'field', id: 'loom-model', 'aria-label': t('settings.loom.model') },
    LOOM_MODELS.map((v) => h('option', { value: v, selected: loomModel() === v ? true : null, text: t(`settings.loom.model.${v}`) })));
  select.addEventListener('change', () => savePref('loom.model', select.value));
  return card(t('settings.loom.model'), h('p', { class: 'muted', text: t('settings.loom.model.hint') }), select);
}
