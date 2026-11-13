// Settings › Back up & load: all settings as one encrypted file (password, keychain), loaded on another device.
import { h, toast, modal } from '../../services/ui.js';
import { t, getLang } from '../../i18n/i18n.js';
import { syncSettings } from '../../services/sync.js';
import { MIN_PASSWORD, SettingsFileError, applySettings, collectSettings, diffSettings, exportSettings, fileName, readSettingsFile, undoImport, undoInfo } from '../../services/settings-file.js';
import { card, iconEl } from './parts.js';

// Your settings as an encrypted file (0.14.4.1): save them with a password, load them on another device.
export function backupCard() {
  const box = card(t('backup.title'));
  box.id = 'settings-backup';
  box.append(h('p', { class: 'muted', text: t('backup.hint') }));
  const file = h('input', { type: 'file', accept: '.json,application/json', id: 'backup-file', hidden: true });
  const exp = h('button', { type: 'button', class: 'btn', id: 'backup-export' }, iconEl('download'), h('span', { text: t('backup.export') }));
  const imp = h('button', { type: 'button', class: 'btn', id: 'backup-import' }, iconEl('upload'), h('span', { text: t('backup.import') }));
  exp.addEventListener('click', () => exportDialog());
  imp.addEventListener('click', () => { file.value = ''; file.click(); });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { toast(t('backup.err.too-large'), 'error', 5000); return; }
    const opened = await openDialog(await f.text(), f.name);
    if (!opened) return;
    const rows = await previewDialog(opened);
    if (!rows) return;
    const n = applySettings(rows);
    if (!n) { toast(t('backup.nothing'), 'info'); return; }
    location.reload();   // every part of the app reads the new settings
  });
  box.append(h('div', { class: 'btn-row' }, exp, imp), file);
  const undo = undoInfo();
  if (undo) {
    const back = h('button', { type: 'button', class: 'btn small', id: 'backup-undo' }, iconEl('undo'), h('span', { text: t('backup.undo') }));
    back.addEventListener('click', () => { undoImport(); location.reload(); });
    box.append(h('p', { class: 'small backup-done', role: 'status' }, iconEl('check'), h('span', { text: t('backup.loaded', { n: undo.n }) })), h('div', { class: 'btn-row' }, back));
  }
  return box;
}

export const backupError = (e) => t(`backup.err.${e instanceof SettingsFileError ? e.code : 'failed'}`, { n: MIN_PASSWORD });

export const formField = (label, input, hint) => h('label', { class: 'set-field', for: input.id }, h('span', { class: 'field-label', text: label }), input, hint ? h('span', { class: 'field-hint', text: hint }) : null);

// a name next to the password, so Safari and Chrome keep the password in your keychain and fill it in on the iPhone
export const keychainName = () => h('input', { class: 'field', id: 'backup-user', type: 'text', name: 'username', autocomplete: 'username', value: 'Toollib-Einstellungen', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });

export function exportDialog() {
  const user = keychainName();
  const pass = h('input', { class: 'field', id: 'backup-pass', type: 'password', name: 'password', autocomplete: 'new-password', minlength: String(MIN_PASSWORD), passwordrules: 'minlength: 20; required: lower; required: upper; required: digit; allowed: ascii-printable;' });
  const pass2 = h('input', { class: 'field', id: 'backup-pass2', type: 'password', name: 'password-repeat', autocomplete: 'new-password', minlength: String(MIN_PASSWORD) });
  const err = h('p', { class: 'field-error backup-error', role: 'alert' });
  const go = h('button', { type: 'submit', class: 'btn primary', id: 'backup-go' }, iconEl('download'), h('span', { text: t('backup.export.go') }));
  const cancel = h('button', { type: 'button', class: 'btn', text: t('action.cancel') });
  const n = Object.keys(collectSettings()).length;
  const form = h('form', { class: 'form backup-form', method: 'post', action: '#', autocomplete: 'on', novalidate: true },
    h('p', { class: 'muted small', text: t('backup.export.what', { n }) }),
    formField(t('backup.user'), user, t('backup.user.hint')),
    formField(t('backup.password'), pass, t('backup.password.hint', { n: MIN_PASSWORD })),
    formField(t('backup.password2'), pass2),
    err, h('div', { class: 'btn-row backup-actions' }, cancel, go));
  return modal({
    title: t('backup.export'), body: form, actions: [], dismissValue: null,
    onOpen: (content, close) => {
      cancel.addEventListener('click', () => close(null));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.textContent = '';
        if (pass.value.length < MIN_PASSWORD) { err.textContent = backupError(new SettingsFileError('short')); return; }
        if (pass.value !== pass2.value) { err.textContent = backupError(new SettingsFileError('mismatch')); return; }
        go.disabled = true;
        err.textContent = t('backup.working');
        try {
          const text = await exportSettings(pass.value, { confirm: pass2.value, device: syncSettings().device });
          const out = new File([text], fileName(), { type: 'application/json' });
          const coarse = window.matchMedia?.('(pointer: coarse)').matches;
          if (coarse && navigator.canShare?.({ files: [out] })) {
            // iPhone: sharing needs a fresh tap, so the file waits for one (AirDrop, Files, …)
            err.textContent = '';
            form.replaceChildren(h('p', { class: 'small backup-done', role: 'status' }, iconEl('check'), h('span', { text: t('backup.ready', { name: out.name }) })),
              h('div', { class: 'btn-row backup-actions' },
                h('button', { type: 'button', class: 'btn', onclick: () => { saveFile(out); close(true); } }, iconEl('download'), h('span', { text: t('backup.save') })),
                h('button', { type: 'button', class: 'btn primary', onclick: async () => { try { await navigator.share({ files: [out], title: out.name }); close(true); } catch (x) { if (x?.name !== 'AbortError') { saveFile(out); close(true); } } } }, iconEl('upload'), h('span', { text: t('backup.share') }))));
            return;
          }
          saveFile(out);
          toast(t('backup.saved', { name: out.name }), 'ok', 5000);
          close(true);
        } catch (x) {
          err.textContent = backupError(x);
          go.disabled = false;
        } finally {
          setTimeout(() => { pass.value = ''; pass2.value = ''; }, 500);   // after the keychain took it
        }
      });
      setTimeout(() => pass.focus(), 60);
    },
  });
}

export function saveFile(out) {
  const url = URL.createObjectURL(out);
  const a = h('a', { href: url, download: out.name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// The password of a file; tries again on a wrong one. Resolves to what readSettingsFile gives, or null.
export function openDialog(text, name) {
  const user = keychainName();
  const pass = h('input', { class: 'field', id: 'backup-open-pass', type: 'password', name: 'password', autocomplete: 'current-password' });
  const err = h('p', { class: 'field-error backup-error', role: 'alert' });
  const go = h('button', { type: 'submit', class: 'btn primary', id: 'backup-open' }, iconEl('upload'), h('span', { text: t('backup.open') }));
  const cancel = h('button', { type: 'button', class: 'btn', text: t('action.cancel') });
  const form = h('form', { class: 'form backup-form', method: 'post', action: '#', autocomplete: 'on', novalidate: true },
    h('p', { class: 'muted small backup-file-name', text: name }),
    formField(t('backup.user'), user),
    formField(t('backup.password'), pass),
    err, h('div', { class: 'btn-row backup-actions' }, cancel, go));
  return modal({
    title: t('backup.import'), body: form, actions: [], dismissValue: null,
    onOpen: (content, close) => {
      cancel.addEventListener('click', () => close(null));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        go.disabled = true;
        err.textContent = t('backup.working');
        try {
          const opened = await readSettingsFile(text, pass.value);
          setTimeout(() => { pass.value = ''; }, 500);
          close(opened);
        } catch (x) {
          err.textContent = backupError(x);
          go.disabled = false;
          if (x?.code === 'wrong-password') { pass.select(); } else if (x instanceof SettingsFileError) pass.disabled = true;
        }
      });
      setTimeout(() => pass.focus(), 60);
    },
  });
}

// What the file would change, one box per setting; secrets stay hidden. Resolves to the chosen rows or null.
export const SETTING_LABEL = {
  lang: ['', 'settings.language'], 'sync.repo': ['settings.sync', 'settings.sync.repo'], 'sync.branch': ['settings.sync', 'settings.sync.branch'], 'sync.token': ['settings.sync', 'settings.sync.token'],
  'sync.proxy': ['settings.sync', 'settings.sync.proxy'], 'sync.name': ['settings.sync', 'settings.sync.name'], 'sync.email': ['settings.sync', 'settings.sync.email'], 'sync.auto': ['settings.sync', 'settings.sync.auto'],
  'research.worker': ['settings.research', 'settings.research.worker'], 'research.token': ['settings.research', 'settings.research.token'], 'research.helper': ['settings.research', 'settings.research.helper'],
  'research.helperToken': ['settings.research', 'settings.research.helperToken'], 'research.openalexKey': ['settings.research', 'settings.research.openalex'], 'research.s2Key': ['settings.research', 'settings.research.s2'],
  'research.off': ['settings.research', 'backup.sourcesOff'], 'crawl.depth': ['settings.crawl', 'crawl.depth'], 'crawl.max': ['settings.crawl', 'crawl.max'], 'crawl.gap': ['settings.crawl', 'settings.crawl.gap'], 'crawl.pdfs': ['settings.crawl', 'crawl.pdfs'],
  'editor.fontSize': ['settings.sec.write', 'settings.write.size'], 'editor.shorthand': ['settings.sec.write', 'settings.write.shorthand'], 'editor.lists': ['settings.sec.write', 'settings.write.lists'],
  'editor.brackets': ['settings.sec.write', 'settings.write.brackets'], 'editor.spellcheck': ['settings.sec.write', 'settings.write.spell'], 'editor.mode': ['settings.sec.write', 'settings.write.mode'],
  'editor.commands': ['settings.sec.write', 'settings.write.commands'], 'editor.macros': ['settings.sec.write', 'settings.write.macros'], keys: ['', 'settings.sec.keys'],
  'learn.off': ['settings.research', 'backup.learnOff'], 'research.mode': ['settings.research', 'backup.researchMode'],
  appearance: ['settings.sec.look', 'settings.appearance'],
  'search.learned': ['settings.sec.general', 'settings.finding'],
};

export function settingLabel(key) {
  const k = key.replace(/^toollib\./, '');
  if (SETTING_LABEL[k]) return SETTING_LABEL[k].filter(Boolean).map((x) => t(x)).join(' › ');
  if (k.startsWith('accent.')) return `${t('settings.accents')} › ${t(`module.${k.slice(7)}.name`)}`;
  const m = key.match(/^kobra\.git\.([a-z]+)$/);
  if (m) return `Kobra › ${t(['accounts', 'repos', 'label', 'login', 'host'].includes(m[1]) ? `settings.kobra.${m[1]}` : `settings.sync.${m[1]}`)}`;
  return k;
}

export function settingValue(r, v) {
  if (v === undefined || v === '') return t('backup.empty');
  if (r.secret) return '••••••';
  if (typeof v === 'boolean') return t(v ? 'backup.yes' : 'backup.no');
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.length ? v.join(', ') : t('backup.empty');
  if (v && typeof v === 'object') { const n = Array.isArray(v) ? v.length : Object.keys(v).length; return n ? t('backup.entries', { n }) : t('backup.empty'); }
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

export const isLocal = (v) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(String(v || ''));

export function previewDialog(opened) {
  const rows = diffSettings(opened.settings);
  const todo = rows.filter((r) => r.state !== 'same');
  const same = rows.length - todo.length;
  const boxes = new Map();
  const list = h('ul', { class: 'backup-list' });
  for (const r of todo) {
    const helperHere = r.key === 'toollib.research.helper' && isLocal(r.next);
    // the Mac's own address would not reach the helper from another device that already has one
    const box = h('input', { type: 'checkbox', checked: helperHere && r.state === 'changed' ? null : true, dataset: { key: r.key } });
    boxes.set(r, box);
    list.append(h('li', {}, h('label', { class: 'rs-check backup-row' }, box,
      h('span', {}, h('strong', { text: settingLabel(r.key) }), h('span', { class: `rs-tag${r.state === 'new' ? '' : ' muted'}`, text: t(`backup.state.${r.state}`) }),
        h('span', { class: 'muted small backup-values', text: r.state === 'new' ? settingValue(r, r.next) : `${settingValue(r, r.now)} → ${settingValue(r, r.next)}` }),
        helperHere ? h('span', { class: 'field-hint', text: t('backup.localHint') }) : null))));
  }
  const when = opened.created ? new Date(opened.created) : null;
  const from = t('backup.from', { device: opened.device || '?', date: when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString(getLang()) : '?' });
  const body = h('div', { class: 'backup-preview' },
    h('p', { class: 'small', text: from }),
    todo.length ? list : h('p', { class: 'muted', text: t('backup.allSame') }),
    h('p', { class: 'muted small', text: [same ? t('backup.same', { n: same }) : '', opened.ignored ? t('backup.ignored', { n: opened.ignored }) : '', t('backup.others')].filter(Boolean).join(' ') }));
  return modal({
    title: t('backup.preview'), body, wide: true,
    actions: [
      { label: t('action.cancel'), value: null },
      { label: t('backup.apply'), kind: 'primary', value: () => todo.filter((r) => boxes.get(r).checked) },
    ],
  });
}
