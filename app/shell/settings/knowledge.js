// Settings › Knowledge & sync: the private repository with your knowledge, its token, and how this device syncs.
import { h, toast } from '../../services/ui.js';
import { t } from '../../i18n/i18n.js';
import { loadPref, savePref } from '../../services/prefs.js';
import { explainSyncError, kobraSettings, saveSyncSetting, syncSettings, testConnection } from '../../services/sync.js';
import { card, iconEl } from './parts.js';
import { syncButton } from '../views.js';

// Repository, token, proxy and who writes the commits. Every field is saved when it loses the focus.
export function syncCard({ onSync }) {
  const s = syncSettings();
  const fields = [];
  const field = (key, label, attrs, hint) => {
    const input = h('input', { class: 'field', id: `sync-${key}`, value: s[key] || '', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', ...attrs });
    input.addEventListener('change', () => saveSyncSetting(key, input.value));
    fields.push({ key, input });
    return { input, row: h('label', { class: 'set-field', for: `sync-${key}` }, h('span', { class: 'field-label', text: label }), input, hint ? h('span', { class: 'field-hint', text: hint }) : null) };
  };
  const saveAll = () => { for (const f of fields) saveSyncSetting(f.key, f.input.value); };

  const repo = field('repo', t('settings.sync.repo'), { type: 'text', placeholder: 'yourname/knowledge', inputmode: 'url' }, t('settings.sync.repo.hint'));
  const branch = field('branch', t('settings.sync.branch'), { type: 'text', placeholder: 'main' }, t('settings.sync.branch.hint'));
  const token = field('token', t('settings.sync.token'), { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' }, t('settings.sync.token.hint'));
  const show = h('button', { type: 'button', class: 'btn small', text: t('settings.sync.show') });
  show.addEventListener('click', () => {
    const hidden = token.input.type === 'password';
    token.input.type = hidden ? 'text' : 'password';
    show.textContent = t(hidden ? 'settings.sync.hide' : 'settings.sync.show');
  });
  const tokenRow = h('div', { class: 'row-input' });
  token.input.before(tokenRow);
  tokenRow.append(token.input, show);
  const proxy = field('proxy', t('settings.sync.proxy'), { type: 'url', placeholder: 'https://git-proxy.yourname.workers.dev', inputmode: 'url' }, t('settings.sync.proxy.hint'));
  const name = field('name', t('settings.sync.name'), { type: 'text', autocomplete: 'name' });
  const email = field('email', t('settings.sync.email'), { type: 'email', autocomplete: 'email' });

  const result = h('ul', { class: 'checks', role: 'status' });
  const test = h('button', { type: 'button', class: 'btn' }, iconEl('link'), h('span', { text: t('settings.sync.test') }));
  const line = (status, text) => h('li', { class: `check ${status}` },
    iconEl({ ok: 'check', warn: 'warn', fail: 'close', info: 'info', busy: 'refresh' }[status] || 'info', status === 'busy' ? 'spin' : ''),
    h('span', { text }));
  test.addEventListener('click', async () => {
    saveAll();
    result.replaceChildren(line('busy', t('settings.sync.testing')));
    test.disabled = true;
    try {
      const lines = await testConnection();
      result.replaceChildren(...lines.map((l) => line(l.status, l.text)));
    } catch (e) {
      result.replaceChildren(line('fail', explainSyncError(e)));
    } finally {
      test.disabled = false;
    }
  });
  const syncNow = syncButton(() => { saveAll(); onSync(); });

  const box = h('section', { class: 'card', id: 'settings-sync' },
    h('h2', { text: t('settings.sync') }),
    h('p', { class: 'muted', text: t('settings.sync.hint') }),
    repo.row, branch.row, token.row, proxy.row, name.row, email.row);

  const kobra = kobraSettings();
  if ((kobra.proxy || kobra.name || kobra.email) && !(s.proxy && s.name && s.email)) {
    const take = h('button', { type: 'button', class: 'btn small' }, iconEl('download'), h('span', { text: t('settings.sync.fromKobra') }));
    take.addEventListener('click', () => {
      if (kobra.proxy && !proxy.input.value) proxy.input.value = kobra.proxy;
      if (kobra.name && !name.input.value) name.input.value = kobra.name;
      if (kobra.email && !email.input.value) email.input.value = kobra.email;
      saveAll();
      take.remove();
      toast(t('settings.sync.fromKobra.done'), 'ok');
    });
    box.insertBefore(h('div', { class: 'btn-row' }, take), repo.row);
  }
  box.append(h('div', { class: 'btn-row' }, test, syncNow), result);
  return box;
}

// How syncing behaves on this device (0.17.0 apart from the access): by itself or not, the name of the device.
export function syncBehaviourCard({ onSync }) {
  const s = syncSettings();
  const device = h('input', { class: 'field', id: 'sync-device', value: loadPref('sync.device', ''), placeholder: s.device, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  device.addEventListener('change', () => saveSyncSetting('device', device.value));
  const auto = h('label', { class: 'set-check' }, h('input', { type: 'checkbox', id: 'sync-auto', checked: loadPref('sync.auto', true) !== false ? true : null }),
    h('span', {}, h('b', { text: t('settings.sync.auto') }), h('span', { class: 'field-hint', text: t('settings.sync.auto.hint') })));
  auto.firstChild.addEventListener('change', (e) => savePref('sync.auto', e.target.checked));
  const box = card(t('settings.knowledge.title'), auto,
    h('label', { class: 'set-field', for: 'sync-device' }, h('span', { class: 'field-label', text: t('settings.sync.device') }), device, h('span', { class: 'field-hint', text: t('settings.sync.device.hint') })),
    h('div', { class: 'btn-row' }, syncButton(onSync)));
  box.id = 'settings-knowledge';
  return box;
}
