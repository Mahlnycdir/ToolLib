// Output of a Python run: text, errors, input() and figures. Taken from Kobra's ConsoleView (runner.js);
// changes for Toollib: no REPL yet, all texts via t(), figures can be saved with shareOrDownload-like download.
import { h } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';

const MAX_CHARS = 200000;

export class ConsoleView {
  constructor({ onFinished } = {}) {
    this.onFinished = onFinished;
    this.out = h('div', { class: 'console-out', role: 'log', 'aria-live': 'polite' });
    this.status = h('div', { class: 'console-progress', hidden: true });
    this.root = h('div', { class: 'console' }, this.status, this.out);
    this.figures = new Map();
    this.chars = 0;
    this.lastBlock = null;
    this.inputResolve = null;
  }

  clear() {
    this.cancelInput();
    this.out.replaceChildren();
    this.chars = 0;
    this.lastBlock = null;
    this.figures.clear();
    this.progress(null);
  }

  started() {
    this.clear();
    const time = new Date().toLocaleTimeString(getLang() === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.out.append(h('div', { class: 'con-run' }, h('span', { text: `▶ ${t('console.started')}` }), h('span', { class: 'muted', text: time })));
  }

  write(text, kind = 'out') {
    if (!text) return;
    if (!this.lastBlock || this.lastBlock.dataset.kind !== kind) {
      this.lastBlock = h('pre', { class: `con-${kind}`, dataset: { kind } });
      this.out.append(this.lastBlock);
    }
    this.lastBlock.append(document.createTextNode(text));
    this.chars += text.length;
    while (this.chars > MAX_CHARS && this.out.firstChild) {
      const n = this.out.firstChild;
      this.chars -= (n.textContent || '').length;
      n.remove();
      if (n === this.lastBlock) this.lastBlock = null;
    }
  }

  note(code, vars = {}, kind = 'info') {
    this.lastBlock = null;
    const row = h('div', { class: `con-note ${kind}` },
      h('span', { class: 'icon', html: icon(kind === 'ok' ? 'check' : kind === 'warn' ? 'warn' : 'info') }),
      h('span', { text: t(code, vars) }));
    this.out.append(row);
    return row;
  }

  progress(code, vars) {
    if (!code) { this.status.hidden = true; this.status.textContent = ''; return; }
    this.status.hidden = false;
    this.status.replaceChildren(h('span', { class: 'icon spin', html: icon('refresh') }), h('span', { text: t(code, vars) }));
  }

  done(result, ms) {
    this.lastBlock = null;
    const ok = result.exit === 0;
    const locale = getLang() === 'de' ? 'de-DE' : 'en-GB';
    const secs = ms < 1000 ? `${ms} ms` : `${(ms / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
    const key = result.gui ? 'console.live' : ok ? 'console.done' : 'console.failed';
    this.out.append(h('div', { class: `con-end ${ok ? 'ok' : 'bad'}`, text: t(key, { time: secs, code: result.exit }) }));
    this.onFinished?.(result);
  }

  liveEnded() {
    this.out.append(h('div', { class: 'con-end ok', text: t('console.liveEnded') }));
  }

  // input(): a field in the output; Enter sends, "End" sends EOF.
  requestInput() {
    this.cancelInput();
    return new Promise((resolve) => {
      const field = h('input', { class: 'field stdin-field', type: 'text', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'send', 'aria-label': t('console.input') });
      const send = h('button', { class: 'btn small primary', type: 'button', text: t('console.send') });
      const eof = h('button', { class: 'btn small', type: 'button', text: t('console.eof'), title: t('console.eof.hint') });
      const row = h('div', { class: 'stdin-row' }, field, send, eof);
      this.lastBlock = null;
      this.out.append(row);
      setTimeout(() => field.focus(), 30);
      const finish = (value) => {
        row.remove();
        this.inputResolve = null;
        if (value !== null) this.write(`${value}\n`, 'in');
        resolve(value);
      };
      this.inputResolve = finish;
      send.addEventListener('click', () => finish(field.value));
      eof.addEventListener('click', () => finish(null));
      field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(field.value); } });
    });
  }

  cancelInput() {
    if (this.inputResolve) this.inputResolve(null);
  }

  // matplotlib (and PIL) images; an animation keeps updating the same image.
  figure(key, b64, w, hgt, title) {
    const src = `data:image/png;base64,${b64}`;
    const existing = key ? this.figures.get(key) : null;
    if (existing && existing.isConnected) {
      existing.querySelector('img').src = src;
      return;
    }
    this.lastBlock = null;
    const img = h('img', { src, alt: title || t('console.figure'), width: w, height: hgt });
    const save = h('button', { type: 'button', class: 'icon-btn small', title: t('console.saveFigure'), 'aria-label': t('console.saveFigure'), html: icon('download') });
    save.addEventListener('click', () => {
      const a = h('a', { href: img.src, download: `${(title || key || 'figure').replace(/[^\w-]+/g, '_')}.png` });
      document.body.append(a);
      a.click();
      a.remove();
    });
    const fig = h('figure', { class: 'con-figure' }, img, h('div', { class: 'fig-bar' }, save));
    this.out.append(fig);
    if (key) this.figures.set(key, fig);
  }

  figureClosed(key) {
    this.figures.get(key)?.classList.add('closed');
  }
}
