// Settings › This device: its name, storage, and the app on the home screen.
import { h, toast, confirmDialog, formatBytes } from '../../services/ui.js';
import { t } from '../../i18n/i18n.js';
import { storageInfo } from '../../services/storage.js';
import { explainSyncError, knowledgeStats, pendingChanges, removeLocalCopy } from '../../services/sync.js';
import { card, iconEl } from './parts.js';

export function deviceCard({ onChange }) {
  const box = card(t('settings.device'));
  box.id = 'settings-device';
  (async () => {
    const [info, stats] = await Promise.all([storageInfo(), knowledgeStats().catch(() => null)]);
    box.append(h('p', { class: 'muted', text: stats ? t('settings.device.has', { count: stats.total }) : t('settings.device.none') }));
    if (info.quota) box.append(h('p', { class: 'muted small', text: t('settings.device.storage', { used: formatBytes(info.usage), quota: formatBytes(info.quota) }) }));
    box.append(h('p', { class: 'muted small', text: t(info.persisted ? 'settings.device.persisted' : 'settings.device.notPersisted') }));
    if (!stats) return;
    const remove = h('button', { type: 'button', class: 'btn' }, iconEl('trash'), h('span', { text: t('settings.device.remove') }));
    remove.addEventListener('click', async () => {
      const pending = await pendingChanges().catch(() => 0);
      const message = pending ? t('settings.device.remove.pending', { count: pending }) : t('settings.device.remove.confirm');
      if (!(await confirmDialog(t('settings.device.remove'), message, { okLabel: t('action.remove'), danger: true }))) return;
      try {
        await removeLocalCopy();
        toast(t('settings.device.removed'), 'ok');
        onChange();
      } catch (e) {
        toast(explainSyncError(e), 'error', 5000);
      }
    });
    box.append(h('div', { class: 'btn-row' }, remove));
  })();
  return box;
}
