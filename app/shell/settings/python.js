// Settings › Python: Python in the browser (Pyodide), kept on this device so it runs offline.
import { h, toast, confirmDialog, formatBytes } from '../../services/ui.js';
import { t } from '../../i18n/i18n.js';
import { pythonBundle, pythonStorage, removePython, storePython } from '../../services/python.js';
import { card, iconEl } from './parts.js';

// Python for running snippets: what Toollib ships and whether it is stored on this device for offline use.
export function pythonCard() {
  const box = card(t('settings.python'));
  box.id = 'settings-python';
  const body = h('div', { class: 'python-card' });
  box.append(body);
  const draw = async () => {
    let info;
    let stored;
    try {
      info = await pythonBundle();
      stored = await pythonStorage();
    } catch (e) {
      console.warn('Python bundle', e);
      body.replaceChildren(h('p', { class: 'muted', text: t('settings.python.unavailable') }));
      return;
    }
    const size = (n) => formatBytes(n);
    const statusText = () => (stored.complete ? t('settings.python.stored', { size: size(info.total) })
      : stored.stored ? t('settings.python.partly', { stored: size(stored.stored), total: size(info.total) })
        : t('settings.python.none', { total: size(info.total) }));
    const status = h('p', { class: 'small python-status', text: statusText() });
    if (stored.complete) status.prepend(iconEl('check'), ' ');
    const bar = h('span', { style: { width: `${Math.round((stored.stored / info.total) * 100)}%` } });
    const meter = h('span', { class: 'meter', role: 'progressbar', 'aria-label': t('settings.python'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round((stored.stored / info.total) * 100)) }, bar);
    const store = h('button', { type: 'button', class: 'btn primary' }, iconEl('download'), h('span', { text: t('settings.python.store') }));
    const remove = h('button', { type: 'button', class: 'btn' }, iconEl('trash'), h('span', { text: t('settings.python.remove') }));
    store.addEventListener('click', async () => {
      if (!navigator.serviceWorker?.controller) { toast(t('settings.python.noWorker'), 'error', 5000); return; }
      store.disabled = true;
      remove.disabled = true;
      try {
        await storePython((done, total) => {
          const pct = Math.round((done / total) * 100);
          bar.style.width = `${pct}%`;
          meter.setAttribute('aria-valuenow', String(pct));
          status.textContent = t('settings.python.storing', { done: size(done), total: size(total) });
        });
        toast(t('settings.python.storedToast'), 'ok');
      } catch (e) {
        toast(t('settings.python.storeFailed', { error: e.message || String(e) }), 'error', 6000);
      }
      draw();
    });
    remove.addEventListener('click', async () => {
      if (!(await confirmDialog(t('settings.python.remove'), t('settings.python.remove.confirm', { size: size(stored.stored) }), { okLabel: t('action.remove'), danger: true }))) return;
      await removePython().catch((e) => console.warn(e));
      toast(t('settings.python.removed'), 'ok');
      draw();
    });
    const versions = ['numpy', 'scipy', 'matplotlib', 'sympy'].map((n) => `${n} ${info.versions?.[n] || ''}`.trim()).join(' · ');
    body.replaceChildren(
      h('p', { class: 'muted', text: t('settings.python.hint', { python: info.python, pyodide: info.pyodide }) }),
      h('p', { class: 'muted small', text: versions }),
      h('div', { class: 'python-store' }, meter, status),
      h('div', { class: 'btn-row' }, stored.complete ? null : store, stored.stored ? remove : null));
  };
  draw();
  return box;
}
