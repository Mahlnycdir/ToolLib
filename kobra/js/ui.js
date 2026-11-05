// Kleine UI-Hilfen: Elemente, Dialoge, Hinweise, Aktionsblaetter.
import { icon } from './icons.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Knopf, der den Fokus (und damit die Bildschirmtastatur) im Editor laesst
export function tapKeepFocus(el, fn) {
  let touched = false;
  el.addEventListener('touchstart', (e) => { touched = true; e.preventDefault(); el.classList.add('pressed'); }, { passive: false });
  el.addEventListener('touchend', (e) => { e.preventDefault(); el.classList.remove('pressed'); fn(e); setTimeout(() => (touched = false), 400); }, { passive: false });
  el.addEventListener('touchcancel', () => el.classList.remove('pressed'));
  el.addEventListener('mousedown', (e) => e.preventDefault());
  el.addEventListener('click', (e) => { if (!touched) fn(e); });
}

let toastTimer = null;
export function toast(msg, kind = 'info', ms = 2600) {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast', role: 'status' }); document.body.append(el); }
  el.className = `toast show ${kind}`;
  el.innerHTML = `${icon(kind === 'error' ? 'warn' : kind === 'ok' ? 'check' : 'info')}<span></span>`;
  el.querySelector('span').textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ------------------------------------------------------------- Dialoge
const stack = [];
export function modal({ title, body, actions = [{ label: 'OK', value: true, kind: 'primary' }], dismissValue = null, wide = false, onOpen }) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' });
    if (title) box.append(h('div', { class: 'modal-title', text: title }));
    const content = h('div', { class: 'modal-body' });
    if (typeof body === 'string') content.innerHTML = body; else if (body) content.append(body);
    box.append(content);
    const bar = h('div', { class: 'modal-actions' });
    let done = false;
    const close = (v) => {
      if (done) return;
      done = true;
      backdrop.classList.remove('show');
      setTimeout(() => backdrop.remove(), 180);
      stack.splice(stack.indexOf(close), 1);
      resolve(v);
    };
    for (const a of actions) {
      const b = h('button', { class: `btn ${a.kind || ''}`, type: 'button', text: a.label });
      b.addEventListener('click', () => {
        const v = typeof a.value === 'function' ? a.value(content) : a.value;
        if (v === undefined) return; // Validierung fehlgeschlagen
        close(v);
      });
      bar.append(b);
    }
    if (actions.length) box.append(bar);
    backdrop.append(box);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(dismissValue); });
    document.body.append(backdrop);
    stack.push(close);
    requestAnimationFrame(() => backdrop.classList.add('show'));
    onOpen?.(content, close);
  });
}

export function closeTopModal() {
  const c = stack[stack.length - 1];
  if (c) { c(null); return true; }
  return false;
}

export function promptDialog(title, { label = '', value = '', placeholder = '', okLabel = 'OK', validate, type = 'text', hint = '' } = {}) {
  const input = h('input', { class: 'field', type, value, placeholder, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const err = h('div', { class: 'field-error' });
  const body = h('div', { class: 'form' }, label ? h('label', { class: 'field-label', text: label }) : null, input, hint ? h('div', { class: 'field-hint', text: hint }) : null, err);
  let submit;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit?.(); } });
  return modal({
    title,
    body,
    actions: [
      { label: 'Abbrechen', value: null },
      { label: okLabel, kind: 'primary', value: () => {
        const v = input.value;
        const problem = validate?.(v);
        if (problem) { err.textContent = problem; return undefined; }
        return v;
      } },
    ],
    onOpen: (content, close) => {
      submit = () => {
        const v = input.value;
        const problem = validate?.(v);
        if (problem) { err.textContent = problem; return; }
        close(v);
      };
      setTimeout(() => { input.focus(); input.select(); }, 60);
    },
  });
}

export function confirmDialog(title, message, { okLabel = 'OK', danger = false, cancelLabel = 'Abbrechen' } = {}) {
  return modal({
    title,
    body: h('p', { text: message }),
    actions: [
      { label: cancelLabel, value: false },
      { label: okLabel, kind: danger ? 'danger' : 'primary', value: true },
    ],
    dismissValue: false,
  });
}

export function actionSheet(title, items) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'sheet-backdrop' });
    const sheet = h('div', { class: 'action-sheet', role: 'menu' });
    if (title) sheet.append(h('div', { class: 'sheet-title', text: title }));
    let done = false;
    const close = (v) => {
      if (done) return;
      done = true;
      backdrop.classList.remove('show');
      setTimeout(() => backdrop.remove(), 200);
      stack.splice(stack.indexOf(close), 1);
      resolve(v);
    };
    for (const it of items) {
      if (it === '-') { sheet.append(h('div', { class: 'sheet-sep' })); continue; }
      const b = h('button', { class: `sheet-item${it.danger ? ' danger' : ''}`, type: 'button', disabled: it.disabled || null });
      b.innerHTML = `${it.icon ? icon(it.icon) : ''}<span></span>${it.detail ? '<small></small>' : ''}`;
      b.querySelector('span').textContent = it.label;
      if (it.detail) b.querySelector('small').textContent = it.detail;
      b.addEventListener('click', () => close(it.value));
      sheet.append(b);
    }
    sheet.append(h('button', { class: 'sheet-item cancel', type: 'button', text: 'Abbrechen', onclick: () => close(null) }));
    backdrop.append(sheet);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    document.body.append(backdrop);
    stack.push(close);
    requestAnimationFrame(() => backdrop.classList.add('show'));
  });
}

// Vollbild-Blatt (z.B. fuer Bausteine, Diff, Einstellungen)
export function openSheet(title, content, { onClose, full = false, actions } = {}) {
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const sheet = h('div', { class: `panel-sheet${full ? ' full' : ''}` });
  const head = h('div', { class: 'panel-sheet-head' });
  head.append(h('div', { class: 'panel-sheet-title', text: title }));
  if (actions) head.append(actions);
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Schließen', html: icon('close') });
  head.append(closeBtn);
  const body = h('div', { class: 'panel-sheet-body' });
  body.append(content);
  sheet.append(head, body);
  backdrop.append(sheet);
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 200);
    stack.splice(stack.indexOf(close), 1);
    onClose?.();
  };
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);
  stack.push(close);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  return { close, body, sheet };
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function loadPref(key, def) {
  try { const v = localStorage.getItem(`kobra.${key}`); return v == null ? def : JSON.parse(v); }
  catch (e) { return def; }
}

export function savePref(key, value) {
  try { localStorage.setItem(`kobra.${key}`, JSON.stringify(value)); } catch (e) { /* privat */ }
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
}

export async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  downloadBlob(blob, name);
}

export function pickFiles({ accept = '', multiple = true, directory = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple: multiple || null, style: { display: 'none' } });
    if (directory) input.setAttribute('webkitdirectory', '');
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}
