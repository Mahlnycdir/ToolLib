// Settings › Kobra: the Git account Kobra commits with; more accounts and the repositories live in Kobra itself.
import { h } from '../../services/ui.js';
import { t } from '../../i18n/i18n.js';
import { card, secretField } from './parts.js';

// ------------------------------------------------------------------ Kobra's access to GitHub (until Kobra gets accounts)
export function kobraCard() {
  const box = card(t('settings.kobra'));
  box.id = 'settings-kobra';
  const read = (k) => { try { const v = localStorage.getItem(`kobra.git.${k}`); return v ? String(JSON.parse(v)) : ''; } catch { return ''; } };
  const field = (k, label, attrs) => {
    const input = h('input', { class: 'field', id: `kobra-${k}`, value: read(k), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', ...attrs });
    input.addEventListener('change', () => { try { localStorage.setItem(`kobra.git.${k}`, JSON.stringify(input.value.trim())); } catch { /* storage full */ } });
    return h('label', { class: 'set-field', for: `kobra-${k}` }, h('span', { class: 'field-label', text: label }), input);
  };
  box.append(h('p', { class: 'muted small', text: t('settings.kobra.hint') }),
    field('proxy', t('settings.sync.proxy'), { type: 'url', inputmode: 'url', placeholder: 'https://git-proxy.yourname.workers.dev' }),
    secretField(field('token', t('settings.sync.token'), { type: 'password', autocomplete: 'off', placeholder: 'github_pat_…' })),
    field('name', t('settings.sync.name'), { type: 'text', autocomplete: 'name' }),
    field('email', t('settings.sync.email'), { type: 'email', autocomplete: 'email' }));
  // 0.20.0: more accounts and your repositories live in Kobra; here only how many
  const count = (k) => { try { const v = JSON.parse(localStorage.getItem(`kobra.git.${k}`) || '[]'); return Array.isArray(v) ? v.length : 0; } catch { return 0; } };
  box.append(h('p', { class: 'muted small', id: 'kobra-more', text: t('settings.kobra.more', { accounts: count('accounts') + 1, repos: count('repos') }) }),
    h('a', { class: 'btn small', href: '#/m/kobra', text: t('settings.kobra.open'), onclick: () => { try { localStorage.setItem('kobra.open', JSON.stringify('settings')); } catch { /* ohne Speicher */ } } }));
  return box;
}
