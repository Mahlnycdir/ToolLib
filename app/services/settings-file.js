// Your settings as an encrypted file (0.14.4.1): save them with a password, load them on another device.
// In the file: the settings of the settings page (sync, fetcher, Mac helper, keys, sources, going through, language,
// accents) and Kobra's Git settings. Never what belongs to one device only: its name for commits, changes not yet on
// GitHub, open folders, scroll positions, drafts.
// Everything, the names of the settings included, is encrypted with AES-256-GCM; the key comes from your password
// (PBKDF2-SHA-256, 600 000 rounds, a random salt per file). The header is bound to the ciphertext (additional data):
// a file changed anywhere does not open. Without the password nobody reads it, Toollib included; the password is
// never stored.
//   { "format": "toollib-settings", "v": 1, "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000,
//     "salt": "<base64>" }, "cipher": { "name": "AES-GCM", "iv": "<base64>" }, "data": "<base64>" }
// Loading changes only the settings you tick; the others stay. What was there before can be put back (sessionStorage,
// until the tab closes).

export const FORMAT = 'toollib-settings';
export const ITERATIONS = 600000;
export const MIN_PASSWORD = 12;
const MAX_FILE = 1024 * 1024;
const UNDO = 'toollib-settings-undo';

// The settings that travel: key → kind of value. Secrets never show in the preview.
const KEYS = {
  lang: 'string',
  'sync.repo': 'string', 'sync.branch': 'string', 'sync.token': 'secret', 'sync.proxy': 'string', 'sync.name': 'string', 'sync.email': 'string', 'sync.auto': 'boolean',
  'research.worker': 'string', 'research.token': 'secret', 'research.helper': 'string', 'research.helperToken': 'secret',
  'research.openalexKey': 'secret', 'research.s2Key': 'secret', 'research.off': 'list',
  'crawl.depth': 'number', 'crawl.max': 'number', 'crawl.gap': 'number', 'crawl.pdfs': 'boolean',
  // 0.17.0: how you write (editor, own commands and macros), your keys, the learning sources and the start mode
  'editor.fontSize': 'number', 'editor.shorthand': 'boolean', 'editor.lists': 'boolean', 'editor.brackets': 'boolean',
  'editor.spellcheck': 'boolean', 'editor.mode': 'string', 'editor.commands': 'json', 'editor.macros': 'json',
  keys: 'json', 'learn.off': 'list', 'research.mode': 'string',
  // 0.18.0: light or dark
  appearance: 'string',
  // 0.19.0: the words the search learned from what you opened
  'search.learned': 'json',
};
const ACCENT = /^accent\.[a-z0-9-]{1,40}$/;
// kobra.git.*; 0.20.0: Kobras Konten (mit ihren Tokens, also geheim) und die Liste deiner Repositorys
const KOBRA = { proxy: 'string', token: 'secret', name: 'string', email: 'string', label: 'string', login: 'string', host: 'string', accounts: 'secret-json', repos: 'json' };
const MERGED = { 'kobra.git.accounts': (x) => x?.id, 'kobra.git.repos': (x) => String(x?.url || '').toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '') };

export class SettingsFileError extends Error {
  constructor(code) { super(code); this.code = code; }   // short, mismatch, not-settings, unsupported, wrong-password, too-large, no-crypto
}

// ------------------------------------------------------------------ which settings, as stored (full storage keys)
function kindOf(storageKey) {
  if (storageKey.startsWith('toollib.')) {
    const k = storageKey.slice(8);
    return KEYS[k] || (ACCENT.test(k) ? 'string' : null);
  }
  const m = storageKey.match(/^kobra\.git\.([a-z]+)$/);
  return m ? KOBRA[m[1]] || null : null;
}
export const isSecret = (storageKey) => ['secret', 'secret-json'].includes(kindOf(storageKey));

function valid(kind, v) {
  if (kind === 'string') return typeof v === 'string' && v.length <= 2000;
  if (kind === 'secret') return typeof v === 'string' && v.length <= 4000;
  if (kind === 'boolean') return typeof v === 'boolean';
  if (kind === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (kind === 'list') return Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === 'string' && x.length <= 100);
  if (kind === 'json' || kind === 'secret-json') return plainJson(v, 0) && JSON.stringify(v).length <= 60000;
  return false;
}

// Objects, lists, text, numbers, yes/no and nothing else, at most four levels deep (own commands, macros, keys).
function plainJson(v, depth) {
  if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return true;
  if (typeof v === 'string') return v.length <= 4000;
  if (depth >= 4) return false;
  if (Array.isArray(v)) return v.length <= 500 && v.every((x) => plainJson(x, depth + 1));
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const keys = Object.keys(v);
    return keys.length <= 500 && keys.every((k) => k.length <= 100 && !['__proto__', 'constructor', 'prototype'].includes(k) && plainJson(v[k], depth + 1));
  }
  return false;
}

function read(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// The settings of this device that would go into a file: { storageKey: value }.
export function collectSettings() {
  const keys = [...Object.keys(KEYS).map((k) => `toollib.${k}`), ...Object.keys(KOBRA).map((k) => `kobra.git.${k}`)];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('toollib.accent.') && kindOf(k)) keys.push(k);
    }
  } catch { /* no storage */ }
  const out = {};
  for (const k of keys) {
    const v = read(k);
    if (v === undefined || v === '' || !valid(kindOf(k), v)) continue;
    out[k] = v;
  }
  return out;
}

// ------------------------------------------------------------------ encryption
const enc = new TextEncoder();
function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new SettingsFileError('not-settings');
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
// The header exactly as it is bound to the ciphertext (fixed order of the fields).
const headerText = (h) => JSON.stringify({ format: h.format, v: h.v, kdf: { name: h.kdf.name, hash: h.kdf.hash, iterations: h.kdf.iterations, salt: h.kdf.salt }, cipher: { name: h.cipher.name, iv: h.cipher.iv } });

function subtle() {
  if (!globalThis.crypto?.subtle) throw new SettingsFileError('no-crypto');   // only on https or localhost
  return crypto.subtle;
}
async function keyFrom(password, salt, iterations) {
  const base = await subtle().importKey('raw', enc.encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// The text of a new file with the settings of this device. device: a name shown when the file is loaded.
export async function exportSettings(password, { confirm, device = '' } = {}) {
  if (String(password || '').length < MIN_PASSWORD) throw new SettingsFileError('short');
  if (confirm !== undefined && confirm !== password) throw new SettingsFileError('mismatch');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const head = { format: FORMAT, v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: b64(salt) }, cipher: { name: 'AES-GCM', iv: b64(iv) } };
  const payload = { app: 'toollib', created: new Date().toISOString(), device: String(device || ''), settings: collectSettings() };
  const key = await keyFrom(password, salt, ITERATIONS);
  const data = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(headerText(head)), tagLength: 128 }, key, enc.encode(JSON.stringify(payload)));
  return `${JSON.stringify({ ...head, data: b64(new Uint8Array(data)) }, null, 1)}\n`;
}

export const fileName = () => `toollib-settings-${new Date().toISOString().slice(0, 10)}.json`;

// Opens a file: { created, device, settings: { storageKey: value }, ignored } or a SettingsFileError.
export async function readSettingsFile(text, password) {
  if (typeof text !== 'string' || text.length > MAX_FILE) throw new SettingsFileError('too-large');
  let head;
  try { head = JSON.parse(text); } catch { throw new SettingsFileError('not-settings'); }
  if (!head || head.format !== FORMAT) throw new SettingsFileError('not-settings');
  if (head.v !== 1 || head.kdf?.name !== 'PBKDF2' || head.kdf?.hash !== 'SHA-256' || head.cipher?.name !== 'AES-GCM') throw new SettingsFileError('unsupported');
  const iterations = head.kdf.iterations;
  // fewer rounds would make guessing easier, many more would freeze the device
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 5000000) throw new SettingsFileError('unsupported');
  const salt = unb64(head.kdf.salt);
  const iv = unb64(head.cipher.iv);
  const data = unb64(head.data);
  if (salt.length < 16 || iv.length !== 12 || data.length < 17) throw new SettingsFileError('not-settings');
  let plain;
  try {
    const key = await keyFrom(password, salt, iterations);
    plain = await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(headerText(head)), tagLength: 128 }, key, data);
  } catch (e) {
    if (e instanceof SettingsFileError) throw e;
    throw new SettingsFileError('wrong-password');   // a wrong password and a changed file look the same
  }
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(plain)); } catch { throw new SettingsFileError('not-settings'); }
  if (payload?.app !== 'toollib' || !payload.settings || typeof payload.settings !== 'object') throw new SettingsFileError('not-settings');
  const settings = {};
  let ignored = 0;
  for (const [k, v] of Object.entries(payload.settings)) {
    const kind = kindOf(k);
    if (kind && valid(kind, v)) settings[k] = v; else ignored++;   // only known settings of the right kind
  }
  return { created: String(payload.created || ''), device: String(payload.device || '').slice(0, 80), settings, ignored };
}

// ------------------------------------------------------------------ loading
// One row per setting in the file: { key, secret, now, next, state: 'new' | 'changed' | 'same' }.
export function diffSettings(settings) {
  return Object.entries(settings).map(([key, next]) => {
    const now = read(key);
    const state = now === undefined || now === '' ? 'new' : JSON.stringify(now) === JSON.stringify(next) ? 'same' : 'changed';
    return { key, secret: isSecret(key), now, next, state };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

// Writes the chosen rows; what was there before can be put back with undoImport() until this tab closes.
export function applySettings(rows) {
  const chosen = rows.filter((r) => r.state !== 'same' && kindOf(r.key) && valid(kindOf(r.key), r.next));
  if (!chosen.length) return 0;
  const before = chosen.map((r) => ({ key: r.key, raw: (() => { try { return localStorage.getItem(r.key); } catch { return null; } })() }));
  try { sessionStorage.setItem(UNDO, JSON.stringify({ at: Date.now(), before })); } catch { /* no way back, but the import still works */ }
  for (const r of chosen) {
    try { localStorage.setItem(r.key, JSON.stringify(merged(r.key, r.next))); } catch { /* storage full */ }
  }
  return chosen.length;
}

// Kobras Konten und Repositorys: was nur hier steht, bleibt; was in der Datei steht, gilt.
function merged(key, next) {
  const id = MERGED[key];
  const now = read(key);
  if (!id || !Array.isArray(now) || !Array.isArray(next)) return next;
  const out = [...next];
  const seen = new Set(next.map(id));
  for (const x of now) if (id(x) && !seen.has(id(x))) out.push(x);
  return out.slice(0, 500);
}

export function undoInfo() {
  try {
    const u = JSON.parse(sessionStorage.getItem(UNDO) || 'null');
    return u && Array.isArray(u.before) ? { at: u.at, n: u.before.length } : null;
  } catch {
    return null;
  }
}

export function undoImport() {
  let u = null;
  try { u = JSON.parse(sessionStorage.getItem(UNDO) || 'null'); } catch { u = null; }
  if (!u || !Array.isArray(u.before)) return 0;
  for (const { key, raw } of u.before) {
    if (!kindOf(key)) continue;
    try { if (raw == null) localStorage.removeItem(key); else localStorage.setItem(key, raw); } catch { /* storage */ }
  }
  try { sessionStorage.removeItem(UNDO); } catch { /* gone */ }
  return u.before.length;
}
