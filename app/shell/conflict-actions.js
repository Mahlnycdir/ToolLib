// The two buttons under a conflict copy: keep this version (replaces the original) or delete the copy.
import { h, toast, confirmDialog } from '../services/ui.js';
import { t } from '../i18n/i18n.js';
import { dropCopy, keepCopy } from '../services/conflicts.js';

export function conflictActions(copy, onDone) {
  const run = async (btn, confirmKey, okKey, act) => {
    if (!(await confirmDialog(t(okKey), t(confirmKey, { path: copy }), { okLabel: t(okKey), danger: true }))) return;
    btn.disabled = true;
    try {
      const original = await act(copy);
      toast(t('conflict.done'), 'ok');
      onDone?.(original);
    } catch (e) {
      btn.disabled = false;
      toast(t('snippet.failed', { error: e.message || String(e) }), 'error', 5000);
    }
  };
  const keep = h('button', { type: 'button', class: 'btn small primary conflict-keep', text: t('conflict.keep') });
  const drop = h('button', { type: 'button', class: 'btn small conflict-drop', text: t('conflict.drop') });
  keep.addEventListener('click', () => run(keep, 'conflict.keep.confirm', 'conflict.keep', keepCopy));
  drop.addEventListener('click', () => run(drop, 'conflict.drop.confirm', 'conflict.drop', dropCopy));
  return h('div', { class: 'btn-row conflict-actions' }, keep, drop);
}
