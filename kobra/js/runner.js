// Verbindung zum Python-Worker und die Konsole.
import { h, loadPref } from './ui.js';
import { icon } from './icons.js';
import { onWorker, postWorker, restartWorker, startWorker, workerAlive, workerReady, workerToken } from '../../app/services/python-host.js';
import { t as tr, getLang } from '../../app/i18n/i18n.js';

const MAX_CONSOLE_CHARS = 400000;

export class ConsoleView {
  constructor(root, { onOpenFile, onInstall, onRepl }) {
    this.root = root;
    this.onOpenFile = onOpenFile;
    this.onInstall = onInstall;
    this.onRepl = onRepl;
    this.out = h('div', { class: 'console-out', role: 'log', 'aria-live': 'polite' });
    this.status = h('div', { class: 'console-progress', hidden: true });
    this.inputRow = null;
    this.figures = new Map();
    this.chars = 0;
    this.lastBlock = null;
    this.replHistory = [];
    this.replPos = 0;
    const replInput = h('textarea', { class: 'repl-input', rows: '1', placeholder: tr('kobra.console.replPlaceholder'), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'send' });
    const replBtn = h('button', { class: 'icon-btn accent', type: 'button', 'aria-label': tr('kobra.run'), html: icon('enter') });
    this.repl = h('div', { class: 'repl-row' }, h('span', { class: 'repl-prompt', text: '>>>' }), replInput, replBtn);
    this.replInput = replInput;
    const submit = () => {
      const code = replInput.value;
      if (!code.trim()) return;
      this.replHistory.push(code);
      this.replPos = this.replHistory.length;
      replInput.value = '';
      this.autoGrow(replInput);
      this.echo(code, '>>> ');
      this.onRepl?.(code);
    };
    replBtn.addEventListener('click', submit);
    replInput.addEventListener('input', () => this.autoGrow(replInput));
    replInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const v = replInput.value;
        // Mehrzeilige Bloecke: nach ':' neue Zeile statt ausfuehren
        if (/:\s*$/.test(v) || (v.includes('\n') && !/\n\s*$/.test(v) && /^\s+/.test(v.split('\n').pop()))) return;
        e.preventDefault();
        submit();
      } else if (e.key === 'ArrowUp' && !replInput.value.includes('\n')) {
        if (this.replPos > 0) { this.replPos--; replInput.value = this.replHistory[this.replPos]; e.preventDefault(); }
      } else if (e.key === 'ArrowDown' && !replInput.value.includes('\n')) {
        if (this.replPos < this.replHistory.length) { this.replPos++; replInput.value = this.replHistory[this.replPos] || ''; e.preventDefault(); }
      }
    });
    this.root.append(this.out, this.status, this.repl);
  }

  autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }

  atBottom() {
    const o = this.out;
    return o.scrollHeight - o.scrollTop - o.clientHeight < 60;
  }

  scroll(force) {
    if (force || this.stick) this.out.scrollTop = this.out.scrollHeight;
  }

  clear() {
    this.out.textContent = '';
    this.chars = 0;
    this.lastBlock = null;
    this.figures.clear();
    this.setProgress(null);
  }

  trim() {
    while (this.chars > MAX_CONSOLE_CHARS && this.out.firstChild) {
      const n = this.out.firstChild;
      this.chars -= (n.textContent || '').length;
      n.remove();
      if (n === this.lastBlock) this.lastBlock = null;
    }
  }

  write(text, kind = 'out') {
    if (!text) return;
    this.stick = this.atBottom();
    if (kind === 'err') {
      this.writeError(text);
    } else {
      if (!this.lastBlock || this.lastBlock.dataset.kind !== kind) {
        this.lastBlock = h('pre', { class: `con-${kind}`, dataset: { kind } });
        this.out.append(this.lastBlock);
      }
      this.lastBlock.append(document.createTextNode(text));
    }
    this.chars += text.length;
    this.trim();
    this.scroll();
  }

  writeError(text) {
    if (!this.lastBlock || this.lastBlock.dataset.kind !== 'err') {
      this.lastBlock = h('pre', { class: 'con-err', dataset: { kind: 'err' } });
      this.out.append(this.lastBlock);
    }
    // Dateiverweise klickbar machen
    const re = /File "([^"]+)", line (\d+)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      this.lastBlock.append(document.createTextNode(text.slice(last, m.index)));
      const file = m[1];
      const line = parseInt(m[2], 10);
      if (!file.startsWith('/') && !file.startsWith('<')) {
        const a = h('a', { class: 'tb-link', href: '#', text: m[0] });
        a.addEventListener('click', (e) => { e.preventDefault(); this.onOpenFile?.(file, line); });
        this.lastBlock.append(a);
      } else {
        this.lastBlock.append(document.createTextNode(m[0]));
      }
      last = m.index + m[0].length;
    }
    this.lastBlock.append(document.createTextNode(text.slice(last)));
  }

  echo(text, prefix = '') {
    this.lastBlock = null;
    this.out.append(h('pre', { class: 'con-echo', text: prefix + text.replace(/\n/g, '\n... ') }));
    this.lastBlock = null;
    this.scroll(true);
  }

  info(text, kind = 'info') {
    this.lastBlock = null;
    const row = h('div', { class: `con-note ${kind}` });
    row.innerHTML = `${icon(kind === 'ok' ? 'check' : kind === 'warn' ? 'warn' : 'info')}<span></span>`;
    row.querySelector('span').textContent = text;
    this.out.append(row);
    this.scroll(true);
    return row;
  }

  runHeader(file) {
    this.lastBlock = null;
    const d = new Date();
    const time = d.toLocaleTimeString(getLang() === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.out.append(h('div', { class: 'con-run' }, h('span', { text: `▶ ${file}` }), h('span', { class: 'muted', text: time })));
    this.scroll(true);
  }

  runFooter(result, ms) {
    this.lastBlock = null;
    const ok = result.exit === 0;
    const secs = ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
    const text = result.gui ? tr('kobra.console.windowGoesOn', { secs }) : ok ? tr('kobra.console.doneAfter', { secs }) : tr('kobra.console.failedAfter', { exit: result.exit, secs });
    this.out.append(h('div', { class: `con-end ${ok ? 'ok' : 'bad'}`, text }));
    this.scroll(true);
  }

  setProgress(text) {
    if (!text) { this.status.hidden = true; this.status.textContent = ''; return; }
    this.status.hidden = false;
    this.status.textContent = text;
  }

  missingModule(mod, pkg) {
    const row = this.info(tr('kobra.console.missingModule', { mod }), 'warn');
    const b = h('button', { class: 'btn small primary', type: 'button', text: `${pkg} installieren` });
    b.addEventListener('click', () => { b.disabled = true; this.onInstall?.(pkg); });
    row.append(b);
  }

  // Eingabe fuer input()
  requestInput() {
    this.cancelInput();
    return new Promise((resolve) => {
      this.stick = true;
      const field = h('input', { class: 'stdin-field', type: 'text', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'send', 'aria-label': tr('kobra.console.input') });
      const send = h('button', { class: 'btn small primary', type: 'button', text: tr('kobra.console.send') });
      const eof = h('button', { class: 'btn small', type: 'button', text: tr('kobra.console.eof'), title: tr('kobra.console.eofHint') });
      const row = h('div', { class: 'stdin-row' }, field, send, eof);
      this.inputRow = row;
      this.lastBlock = null;
      this.out.append(row);
      this.scroll(true);
      setTimeout(() => field.focus(), 30);
      const finish = (value) => {
        row.remove();
        this.inputRow = null;
        this.inputResolve = null;
        if (value !== null) this.write(value + '\n', 'in');
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

  // Abbildungen (matplotlib, PIL)
  figure(key, b64, w, hgt, title, onClose) {
    const src = `data:image/png;base64,${b64}`;
    const existing = key ? this.figures.get(key) : null;
    if (existing && existing.isConnected) {
      existing.querySelector('img').src = src;
      return;
    }
    this.stick = this.atBottom();
    this.lastBlock = null;
    const img = h('img', { src, alt: title || tr('kobra.console.figure'), width: w, height: hgt });
    const fig = h('figure', { class: 'con-figure' }, img);
    const bar = h('div', { class: 'fig-bar' });
    const save = h('button', { class: 'icon-btn small', type: 'button', 'aria-label': tr('kobra.console.saveImage'), html: icon('download') });
    save.addEventListener('click', async () => {
      const blob = await (await fetch(img.src)).blob();
      const { shareOrDownload } = await import('./ui.js');
      shareOrDownload(blob, `${(title || key || 'abbildung').replace(/[^\w-]+/g, '_')}.png`);
    });
    bar.append(save);
    if (key && onClose) {
      const close = h('button', { class: 'icon-btn small', type: 'button', 'aria-label': tr('kobra.console.closeFigure'), html: icon('close') });
      close.addEventListener('click', () => onClose(key));
      bar.append(close);
    }
    fig.append(bar);
    this.out.append(fig);
    if (key) this.figures.set(key, fig);
    img.addEventListener('load', () => this.scroll(), { once: true });
    this.scroll();
  }

  figureClosed(key) {
    const f = this.figures.get(key);
    if (f) f.classList.add('closed');
  }
}

// ------------------------------------------------------------------ Runner
export class Runner {
  constructor({ console: con, gui, onStatus, onFiles, onTools, onRestart, onRunDone }) {
    this.console = con;
    this.gui = gui;
    this.onStatus = onStatus;
    this.onFiles = onFiles;
    this.onTools = onTools;
    this.onRestart = onRestart;
    this.onRunDone = onRunDone;
    this.state = 'off';
    this.pending = new Map();
    this.nextId = 1;
    this.sync = false;
    this.runStart = 0;
    this.moveQueue = [];
    this.moveScheduled = false;
  }

  // Seit 0.23.0 teilt Kobra den einen Python-Worker mit Toollib (app/services/python-host.js). Kobra nimmt die
  // Nachrichten ohne owner und die mit owner "kobra"; die Läufe aus Toollibs Spickzettel gehen Kobra nichts an.
  start(opts = {}) {
    this.lastOpts = opts;
    if (!this.offWorker) this.offWorker = onWorker((m) => this.onHostMessage(m));
    if (!workerReady()) this.setState('loading', tr('kobra.python.loading'));
    startWorker();
  }

  get worker() { return workerAlive(); }
  get token() { return workerToken(); }

  onHostMessage(m) {
    if (m.type === 'restart') { if (m.by !== 'kobra') this.afterRestart(); return; }
    if (m.type === 'worker-error') {
      this.setState('error');
      this.console.info(tr('kobra.python.workerError', { v: m.message || tr('kobra.unknown') }), 'warn');
      return;
    }
    if (m.owner && m.owner !== 'kobra') return;
    this.onMessage(m);
  }

  // Python startet neu (hier oder von Toollib aus): offene Anfragen und Fenster enden, die Dateien kommen wieder hinein
  afterRestart() {
    for (const [, p] of this.pending) p.reject(new Error('Neustart'));
    this.pending.clear();
    this.console.cancelInput();
    this.gui.reset();
    this.setState('loading', tr('kobra.python.loading'));
    this.onRestart?.();
  }

  restart(opts) {
    if (opts) this.lastOpts = opts;
    if (!this.offWorker) this.offWorker = onWorker((m) => this.onHostMessage(m));
    restartWorker('kobra');
    this.afterRestart();
  }

  setState(state, msg) {
    this.state = state;
    this.onStatus?.(state, msg);
  }

  post(msg, transfer) { postWorker(msg, transfer); }

  call(type, data = {}, timeout = 0) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ type, id, ...data });
      if (timeout) setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')); }
      }, timeout);
    });
  }

  lsp(method, params, timeout = 4000) {
    if (!this.worker || this.state === 'loading' || this.state === 'running') return Promise.resolve(null);
    return this.call('lsp', { method, params }, timeout);
  }

  syncFiles(project, files, deleted = [], reset = false) {
    const transfer = [];
    const list = files.map(f => {
      const data = typeof f.data === 'string' ? f.data : new Uint8Array(f.data);
      if (typeof data !== 'string') transfer.push(data.buffer);
      return { path: f.path, data };
    });
    this.post({ type: 'sync-files', project, files: list, deleted, reset }, transfer);
  }

  run(project, entry, argv = []) {
    this.console.runHeader(entry);
    this.runStart = performance.now();
    this.gui.reset();
    if (this.sync) navigator.serviceWorker?.controller?.postMessage({ type: 'clear-events', token: this.token });
    this.post({ type: 'run', id: this.nextId++, project, entry, argv });
    this.setState('running');
  }

  stop() {
    this.console.info(tr('kobra.console.stopped'), 'warn');
    this.restart(this.lastOpts);
  }

  sendGuiEvents(events) {
    if (!events.length) return;
    if (this.sync) {
      navigator.serviceWorker?.controller?.postMessage({ type: 'gui-events', token: this.token, events });
    } else {
      this.post({ type: 'gui-events', events: JSON.stringify(events) });
    }
  }

  // Zeigerbewegungen pro Bild zusammenfassen
  sendGuiEvent(ev) {
    if (ev.t === 'move' || ev.e === 'mouse' && ev.t === 'move') {
      const last = this.moveQueue[this.moveQueue.length - 1];
      if (last && last.w === ev.w && (last.t === ev.t)) this.moveQueue[this.moveQueue.length - 1] = ev;
      else this.moveQueue.push(ev);
      if (!this.moveScheduled) {
        this.moveScheduled = true;
        requestAnimationFrame(() => {
          this.moveScheduled = false;
          const q = this.moveQueue;
          this.moveQueue = [];
          this.sendGuiEvents(q);
        });
      }
      return;
    }
    if (this.moveQueue.length) {
      const q = this.moveQueue;
      this.moveQueue = [];
      this.sendGuiEvents([...q, ev]);
      return;
    }
    this.sendGuiEvents([ev]);
  }

  replySync(id, value) {
    const ctrl = navigator.serviceWorker?.controller;
    if (!ctrl) return;
    ctrl.postMessage({ type: 'sync-reply', token: this.token, id, value: JSON.stringify({ v: value === undefined ? null : value }) });
  }

  async onSyncRequest(id, kind, payloadJson) {
    let payload = {};
    try { payload = JSON.parse(payloadJson || '{}'); } catch (e) { payload = {}; }
    let value = null;
    try {
      if (kind === 'stdin') value = await this.console.requestInput();
      else if (kind === 'dialog') value = await this.gui.dialog(payload);
      else if (kind === 'layout') value = this.gui.layoutNow();
      else if (kind === 'measure') value = this.gui.measure(payload);
      else if (kind === 'rgb') value = this.gui.rgb(payload.color);
      else if (kind === 'img_pixels') value = await this.gui.imagePixels(payload.name);
      else if (kind === 'menu') value = await this.gui.popupMenu(payload);
    } catch (e) {
      value = null;
    }
    this.replySync(id, value);
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'status':
        if (msg.state === 'ready' && msg.sync !== undefined) {
          this.sync = !!msg.sync;
          this.python = msg.python;
        }
        this.setState(msg.state, msg.msg);
        if (msg.state !== 'loading') this.console.setProgress(null);
        else if (msg.msg) this.console.setProgress(msg.msg);
        break;
      case 'fatal':
        this.setState('error', msg.msg);
        this.console.info(msg.msg, 'warn');
        if (msg.detail) this.console.write(msg.detail + '\n', 'err');
        break;
      case 'progress':
        this.console.setProgress(msg.msg);
        clearTimeout(this.progressTimer);
        this.progressTimer = setTimeout(() => this.console.setProgress(null), 2500);
        break;
      case 'stdout': this.console.write(msg.text, 'out'); break;
      case 'stderr': this.console.write(msg.text, 'err'); break;
      case 'gui': this.handleGuiOps(msg.ops); break;
      case 'sync-req': this.onSyncRequest(msg.id, msg.kind, msg.payload); break;
      case 'sync-lost':
        this.sync = false;
        this.console.info(tr('kobra.python.syncLost'), 'warn');
        break;
      case 'notify':
        if (msg.data.type === 'missing-module') this.console.missingModule(msg.data.module, msg.data.package);
        break;
      case 'files': this.onFiles?.(msg.project, msg.changed, msg.deleted); break;
      case 'run-done': {
        const ms = Math.round(performance.now() - this.runStart);
        this.console.setProgress(null);
        this.console.runFooter(msg.result, ms);
        this.onRunDone?.(msg.result);
        break;
      }
      case 'gui-ended':
        this.gui.allClosed();
        break;
      case 'tools': this.onTools?.(msg); break;
      case 'result': {
        const p = this.pending.get(msg.id);
        if (!p) break;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.value); else p.reject(new Error(msg.error || tr('kobra.error')));
        break;
      }
      default: break;
    }
  }

  handleGuiOps(json) {
    let ops;
    try { ops = JSON.parse(json); } catch (e) { return; }
    const rest = [];
    for (const op of ops) {
      if (op[0] === 'mpl') {
        this.console.figure(op[1], op[2], op[3], op[4], op[5], (key) => this.sendGuiEvent({ k: 'close', w: key }));
        if (op[1]) this.gui.noteFigure?.(op[1]);
      } else if (op[0] === 'mpl_closed') {
        this.console.figureClosed(op[1]);
      } else {
        rest.push(op);
      }
    }
    if (rest.length) this.gui.apply(rest);
  }
}
