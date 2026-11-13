// Settings › Keys: every keyboard shortcut, changeable; and the switch for a keyboard on this device.
import { h, confirmDialog } from '../../services/ui.js';
import { icon } from '../../services/icons.js';
import { t } from '../../i18n/i18n.js';
import { ACTIONS, AREAS, keysOf, formatCombo, setKeys, resetKeys, isDefault, conflictOf, comboOf, onKeysChange } from '../../services/keys.js';
import { card, iconEl, check } from './parts.js';

// ------------------------------------------------------------------ keys (0.17.0)
export function keysCard() {
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

export function keyboardCard() {
  const box = card(t('settings.keyboard'));
  box.id = 'settings-keyboard';
  box.append(check('device-keyboard', 'device.keyboard', t('settings.keyboard.use'), t('settings.keyboard.hint'), false, () => location.reload()));
  return box;
}
