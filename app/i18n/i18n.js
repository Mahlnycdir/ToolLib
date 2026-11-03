// Texts of the interface. strings.json holds every sentence in English and German, like a .resx file.
// t('key', { name: 'value' }) returns the sentence in the current language; missing German falls back to English.
import { loadPref, savePref } from '../services/prefs.js';

let strings = {};
let lang = 'en';
const listeners = new Set();

export async function initI18n() {
  const res = await fetch(new URL('./strings.json', import.meta.url));
  strings = await res.json();
  lang = loadPref('lang', 'en') === 'de' ? 'de' : 'en';
  document.documentElement.lang = lang;
}

export function t(key, vars = {}) {
  const entry = strings[key];
  const text = entry ? (entry[lang] ?? entry.en ?? key) : key;
  return text.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

export const getLang = () => lang;

export function setLang(next) {
  if (next !== 'en' && next !== 'de') return;
  lang = next;
  savePref('lang', next);
  document.documentElement.lang = next;
  for (const fn of listeners) fn(next);
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
