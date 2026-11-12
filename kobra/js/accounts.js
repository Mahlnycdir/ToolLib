// Kobras GitHub-Konten (0.20.0): mehrere Konten, jedes Repository committet und lädt als sein eigenes hoch.
// Das erste Konto steht in den Schlüsseln, die Kobra schon immer hatte (kobra.git.name, .email, .token, dazu neu
// .label und .login); weitere Konten in kobra.git.accounts. Welches Konto ein Repository nimmt: die Liste deiner
// Repositorys (kobra.git.repos, auf jedem Gerät gleich über die verschlüsselte Einstellungsdatei), sonst das Konto,
// dem das Repository auf GitHub gehört, sonst das erste. Ein Token geht nur an den Rechner seines Kontos
// (github.com, wenn nichts anderes eingetragen ist) und nie an eine andere Adresse.
import { loadPref, savePref } from './ui.js';

export const MAIN = 'main';
const ID = /^[a-z0-9-]{1,40}$/;
const HOST = /^[a-z0-9.-]{1,100}(:\d{1,5})?$/;
const MAX_ACCOUNTS = 20;
const MAX_REPOS = 200;

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function tidy(a) {
  return {
    id: a.id,
    label: str(a.label, 60),
    login: str(a.login, 60),
    name: str(a.name),
    email: str(a.email),
    token: str(a.token, 4000),
    host: HOST.test(str(a.host).toLowerCase()) ? str(a.host).toLowerCase() : 'github.com',
  };
}

function mainAccount() {
  return tidy({
    id: MAIN, label: loadPref('git.label', ''), login: loadPref('git.login', ''), name: loadPref('git.name', ''),
    email: loadPref('git.email', ''), token: loadPref('git.token', ''), host: loadPref('git.host', ''),
  });
}

function extraAccounts() {
  const list = loadPref('git.accounts', []);
  if (!Array.isArray(list)) return [];
  return list.filter((a) => a && typeof a === 'object' && ID.test(a.id) && a.id !== MAIN).slice(0, MAX_ACCOUNTS).map(tidy);
}

// All accounts, the first one first.
export function accounts() { return [mainAccount(), ...extraAccounts()]; }
export function account(id) { return accounts().find((a) => a.id === id) || null; }

// What an account is called on a button: its label, else its GitHub name, else its name for commits.
export function accountLabel(a) {
  if (!a) return '';
  return a.label || (a.login ? `@${a.login}` : '') || a.name || (a.id === MAIN ? 'Erstes Konto' : 'Konto');
}

export function saveAccount(a) {
  const acc = tidy(a);
  if (acc.id === MAIN) {
    for (const k of ['label', 'login', 'name', 'email', 'token']) savePref(`git.${k}`, acc[k]);
    savePref('git.host', acc.host === 'github.com' ? '' : acc.host);
    return acc;
  }
  if (!ID.test(acc.id)) throw new Error('Ungültiges Konto');
  const list = extraAccounts();
  const i = list.findIndex((x) => x.id === acc.id);
  if (i >= 0) list[i] = acc;
  else if (list.length >= MAX_ACCOUNTS) throw new Error(`Höchstens ${MAX_ACCOUNTS + 1} Konten`);
  else list.push(acc);
  savePref('git.accounts', list);
  return acc;
}

export function removeAccount(id) {
  if (id === MAIN) return;
  savePref('git.accounts', extraAccounts().filter((a) => a.id !== id));
  // Repositorys, die dieses Konto nahmen, nehmen wieder das passende oder das erste
  savePref('git.repos', repos().map((r) => (r.account === id ? { ...r, account: '' } : r)));
}

export function newAccountId() {
  const taken = new Set(accounts().map((a) => a.id));
  for (;;) {
    const id = `k${Math.random().toString(36).slice(2, 8)}`;
    if (!taken.has(id)) return id;
  }
}

// ---------------------------------------------------------------- deine Repositorys
// Gleich auf jedem Gerät: Adresse, Name des Projekts, Konto, Zweig. Keine Tokens, keine Dateien.
export function repoKey(url) {
  try {
    const u = new URL(String(url).trim());
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '').replace(/\.git$/i, '')}`.toLowerCase();
  } catch { return ''; }
}

export function repos() {
  const list = loadPref('git.repos', []);
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const r of list) {
    if (!r || typeof r !== 'object' || !/^https:\/\/\S{3,500}$/.test(r.url || '')) continue;
    const key = repoKey(r.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ url: str(r.url, 500), name: str(r.name, 100), account: ID.test(r.account || '') ? r.account : '', branch: str(r.branch, 200) });
  }
  return out.slice(0, MAX_REPOS);
}

export function repoEntry(url) {
  const key = repoKey(url);
  return key ? repos().find((r) => repoKey(r.url) === key) || null : null;
}

// Merkt ein Repository (oder ändert, was angegeben ist). Leere Angaben lassen das Gemerkte stehen.
export function rememberRepo({ url, name, account: acc, branch }) {
  if (!/^https:\/\/\S{3,500}$/.test(url || '')) return;
  const list = repos();
  const key = repoKey(url);
  const i = list.findIndex((r) => repoKey(r.url) === key);
  const old = i >= 0 ? list[i] : { url, name: '', account: '', branch: '' };
  const next = { url: old.url, name: str(name, 100) || old.name, account: acc === undefined ? old.account : (ID.test(acc || '') ? acc : ''), branch: str(branch, 200) || old.branch };
  if (i >= 0) list[i] = next; else list.unshift(next);
  savePref('git.repos', list.slice(0, MAX_REPOS));
}

export function forgetRepo(url) {
  const key = repoKey(url);
  savePref('git.repos', repos().filter((r) => repoKey(r.url) !== key));
}

// Wem ein Repository auf GitHub gehört: https://github.com/<owner>/<repo>
export function ownerOf(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
  } catch { return ''; }
}

// Das Konto für eine Adresse: gemerkt, sonst nach dem Besitzer, sonst das erste.
export function accountForUrl(url) {
  const all = accounts();
  const entry = repoEntry(url);
  const chosen = entry?.account && all.find((a) => a.id === entry.account);
  if (chosen) return chosen;
  let host = '';
  try { host = new URL(url).host.toLowerCase(); } catch { /* keine Adresse */ }
  const owner = ownerOf(url);
  const byOwner = owner && all.find((a) => a.login && a.login.toLowerCase() === owner && a.host === host);
  return byOwner || all[0];
}

// Ein Token nur für https-Adressen auf dem Rechner des Kontos.
export function tokenFor(acc, url) {
  if (!acc?.token) return '';
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.host.toLowerCase() === acc.host ? acc.token : '';
  } catch { return ''; }
}

export function authorOf(acc) {
  return { name: acc?.name || 'Kobra', email: acc?.email || 'kobra@example.invalid' };
}

// Token prüfen: fragt GitHub, wem es gehört (nur bei github.com; das Token geht an api.github.com und sonst nirgends hin).
export async function checkToken(acc) {
  if (!acc.token) return { ok: false, reason: 'Kein Token eingetragen.' };
  if (acc.host !== 'github.com') return { ok: false, reason: 'Prüfen geht nur bei github.com.' };
  let res;
  try {
    res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${acc.token}`, Accept: 'application/vnd.github+json' },
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    });
  } catch { return { ok: false, reason: 'GitHub ist nicht erreichbar.' }; }
  if (res.status === 401) return { ok: false, reason: 'GitHub kennt dieses Token nicht (abgelaufen oder falsch).' };
  if (!res.ok) return { ok: false, reason: `GitHub antwortet mit ${res.status}.` };
  let u;
  try { u = await res.json(); } catch { return { ok: false, reason: 'Unerwartete Antwort von GitHub.' }; }
  const login = str(u?.login, 60);
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) return { ok: false, reason: 'Unerwartete Antwort von GitHub.' };
  const id = Number.isInteger(u.id) && u.id > 0 ? u.id : null;
  return { ok: true, login, name: str(u.name), email: id ? `${id}+${login}@users.noreply.github.com` : `${login}@users.noreply.github.com` };
}
