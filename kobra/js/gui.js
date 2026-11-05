// GUI-Emulator: zeichnet tkinter- und Qt-Fenster aus den Operationen des Python-Workers.
import { h, esc, toast } from './ui.js';
import { icon } from './icons.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const PT = 1.2;            // Tk-Punkte -> CSS-Pixel
const DEFAULT_FONT = { family: 'TkDefaultFont', size: 13 };

// ------------------------------------------------------------------ Farben
const SYSTEM_COLORS = {
  systembuttonface: '#ececec', systemwindow: '#ffffff', systembuttontext: '#000000', systemwindowtext: '#000000',
  systemwindowbody: '#ececec', systemhighlight: '#3b82f6', systemhighlighttext: '#ffffff', systemwindowbackgroundcolor: '#ececec',
  systemtextbackgroundcolor: '#ffffff', systemtextcolor: '#000000', systemmenu: '#ffffff', systembackground: '#ececec',
  violetred: '#d02090', lightgoldenrod: '#eedd82', navyblue: '#000080', lightslateblue: '#8470ff', mediumforestgreen: '#6b8e23',
  darkyellow: '#808000',
};
const colorCache = new Map();
let colorCtx = null;
export function tkColor(c) {
  if (c == null || c === '') return null;
  const key = String(c);
  if (colorCache.has(key)) return colorCache.get(key);
  let s = key.trim();
  let out = null;
  if (s.startsWith('#')) {
    const hx = s.slice(1);
    if (/^[0-9a-f]+$/i.test(hx)) {
      if (hx.length === 3) out = '#' + hx.split('').map(x => x + x).join('');
      else if (hx.length === 6) out = '#' + hx;
      else if (hx.length === 9 || hx.length === 12) {
        const n = hx.length / 3;
        out = '#' + [0, 1, 2].map(i => hx.slice(i * n, i * n + 2)).join('');
      }
    }
  } else {
    const low = s.toLowerCase().replace(/\s+/g, '');
    const gray = /^gr[ae]y(\d{1,3})$/.exec(low);
    if (gray) {
      const v = Math.round(Math.min(100, +gray[1]) * 2.55);
      out = `rgb(${v},${v},${v})`;
    } else if (SYSTEM_COLORS[low]) {
      out = SYSTEM_COLORS[low];
    } else {
      const m = /^([a-z]+?)([1-4])$/.exec(low);
      const base = m ? m[1] : low;
      if (!colorCtx) colorCtx = document.createElement('canvas').getContext('2d');
      colorCtx.fillStyle = '#010203';
      colorCtx.fillStyle = SYSTEM_COLORS[base] || base;
      let val = colorCtx.fillStyle;
      if (val === '#010203' && base !== '#010203') val = null;
      if (val && m) {
        const f = [1, 0.93, 0.8, 0.55][+m[2] - 1];
        const rgb = hexToRgb(val);
        if (rgb) val = `rgb(${Math.round(rgb[0] * f)},${Math.round(rgb[1] * f)},${Math.round(rgb[2] * f)})`;
      }
      out = val;
    }
  }
  colorCache.set(key, out);
  return out;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function cssToRgb(c) {
  if (!colorCtx) colorCtx = document.createElement('canvas').getContext('2d');
  colorCtx.fillStyle = '#000';
  colorCtx.fillStyle = c;
  const v = colorCtx.fillStyle;
  if (v.startsWith('#')) return hexToRgb(v);
  const m = /rgba?\(([^)]+)\)/.exec(v);
  return m ? m[1].split(',').slice(0, 3).map(x => Math.round(parseFloat(x))) : [0, 0, 0];
}

// ------------------------------------------------------------------- Schrift
const FAMILY_MAP = {
  tkdefaultfont: '-apple-system, system-ui, "Helvetica Neue", Helvetica, Arial, sans-serif',
  tktextfont: '-apple-system, system-ui, Helvetica, Arial, sans-serif',
  tkfixedfont: 'Menlo, "SF Mono", ui-monospace, Courier, monospace',
  tkheadingfont: '-apple-system, system-ui, Helvetica, Arial, sans-serif',
  tkmenufont: '-apple-system, system-ui, Helvetica, Arial, sans-serif',
  tkcaptionfont: '-apple-system, system-ui, Helvetica, Arial, sans-serif',
  tksmallcaptionfont: '-apple-system, system-ui, Helvetica, Arial, sans-serif',
  tkiconfont: '-apple-system, system-ui, Helvetica, Arial, sans-serif',
  tktooltipfont: '-apple-system, system-ui, Helvetica, Arial, sans-serif',
  helvetica: 'Helvetica, Arial, sans-serif', arial: 'Arial, Helvetica, sans-serif',
  courier: '"Courier New", Courier, monospace', 'courier new': '"Courier New", Courier, monospace',
  consolas: 'Menlo, Consolas, monospace', monospace: 'Menlo, ui-monospace, monospace', menlo: 'Menlo, monospace',
  times: '"Times New Roman", Times, serif', 'times new roman': '"Times New Roman", Times, serif',
  'segoe ui': '-apple-system, system-ui, sans-serif', calibri: '-apple-system, system-ui, sans-serif',
  verdana: 'Verdana, sans-serif', georgia: 'Georgia, serif', 'comic sans ms': '"Comic Sans MS", "Chalkboard SE", sans-serif',
  impact: 'Impact, "Arial Black", sans-serif', system: '-apple-system, system-ui, sans-serif',
};
const SMALL_NAMED = { tksmallcaptionfont: 11, tktooltipfont: 11, tkfixedfont: 12, tkiconfont: 12 };

function tkFontCss(spec) {
  if (!spec) spec = DEFAULT_FONT;
  if (spec.named) {
    const n = spec.named.toLowerCase();
    return `${n === 'tkheadingfont' || n === 'tkcaptionfont' ? 600 : 400} ${SMALL_NAMED[n] || 13}px ${FAMILY_MAP[n] || FAMILY_MAP.tkdefaultfont}`;
  }
  const fam = String(spec.family || 'TkDefaultFont');
  const famCss = FAMILY_MAP[fam.toLowerCase()] || `"${fam.replace(/"/g, '')}", -apple-system, system-ui, sans-serif`;
  let size = spec.size == null || spec.size === 0 ? (SMALL_NAMED[fam.toLowerCase()] || 13) : spec.size;
  if (fam.toLowerCase().startsWith('tk') && spec.size == null) size = SMALL_NAMED[fam.toLowerCase()] || 13;
  const px = size < 0 ? -size : Math.round(size * PT * 10) / 10;
  return `${spec.slant === 'italic' ? 'italic ' : ''}${spec.weight === 'bold' ? 700 : 400} ${px}px ${famCss}`;
}

function applyFont(el, spec) {
  el.style.font = tkFontCss(spec);
  const deco = [];
  if (spec?.underline) deco.push('underline');
  if (spec?.overstrike) deco.push('line-through');
  el.style.textDecoration = deco.join(' ');
}

function qtFontCss(f) {
  if (!f) return '';
  const fam = FAMILY_MAP[String(f.family || '').toLowerCase()] || (f.family ? `"${f.family}", -apple-system, system-ui, sans-serif` : '-apple-system, system-ui, sans-serif');
  return `${f.italic ? 'italic ' : ''}${f.weight || 400} ${Math.round((f.px || 13) * 10) / 10}px ${fam}`;
}

const RELIEF = { raised: 'outset', sunken: 'inset', groove: 'groove', ridge: 'ridge', solid: 'solid', flat: 'none' };

const KEYSYMS = {
  ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Enter: 'Return', Backspace: 'BackSpace',
  Escape: 'Escape', Tab: 'Tab', ' ': 'space', Delete: 'Delete', Shift: 'Shift_L', Control: 'Control_L', Alt: 'Alt_L',
  Meta: 'Meta_L', Home: 'Home', End: 'End', PageUp: 'Prior', PageDown: 'Next', CapsLock: 'Caps_Lock',
  ',': 'comma', '.': 'period', '-': 'minus', '+': 'plus', '=': 'equal', '/': 'slash', '\\': 'backslash', ';': 'semicolon',
  "'": 'apostrophe', '[': 'bracketleft', ']': 'bracketright', '`': 'grave', '!': 'exclam', '@': 'at', '#': 'numbersign',
  '$': 'dollar', '%': 'percent', '^': 'asciicircum', '&': 'ampersand', '*': 'asterisk', '(': 'parenleft', ')': 'parenright',
  _: 'underscore', ':': 'colon', '"': 'quotedbl', '<': 'less', '>': 'greater', '?': 'question', '|': 'bar', '{': 'braceleft',
  '}': 'braceright', '~': 'asciitilde',
};
const KEYCODES = { Left: 37, Up: 38, Right: 39, Down: 40, Return: 13, space: 32, Escape: 27, BackSpace: 8, Tab: 9, Delete: 46 };

export function keyInfo(e) {
  const keysym = KEYSYMS[e.key] || (e.key.length === 1 ? e.key : e.key);
  const char = e.key.length === 1 ? e.key : e.key === 'Enter' ? '\r' : e.key === 'Backspace' ? '\b' : e.key === 'Tab' ? '\t' : e.key === 'Escape' ? '\x1b' : '';
  const state = [];
  if (e.shiftKey) state.push('Shift');
  if (e.ctrlKey) state.push('Control');
  if (e.altKey) state.push('Alt');
  if (e.metaKey) state.push('Meta');
  return { keysym, char, keycode: KEYCODES[keysym] || (char ? char.toUpperCase().charCodeAt(0) : 0), state };
}

// 'center' enthaelt die Buchstaben e und n – daher normalisieren
const tclStr = (v) => (v === true ? '1' : v === false ? '0' : typeof v === 'number' && Number.isInteger(v) ? String(v) : String(v ?? ''));
const anc = (a) => { const v = String(a || '').toLowerCase(); return v === 'center' ? '' : v; };

const MSG_LABELS = { ok: 'OK', cancel: 'Abbrechen', yes: 'Ja', no: 'Nein', retry: 'Wiederholen', abort: 'Abbrechen', ignore: 'Ignorieren' };

// ================================================================ GuiManager
export class GuiManager {
  constructor(layer, { sendEvent, onWindowsChanged, fileProvider, onStop }) {
    this.layer = layer;
    this.onStop = onStop;
    this.sendEvent = sendEvent;
    this.onWindowsChanged = onWindowsChanged;
    this.fileProvider = fileProvider;
    this.zoomFit = true;
    this.buildChrome();
    this.reset();
    window.addEventListener('resize', () => this.scheduleLayout());
    document.addEventListener('keydown', (e) => this.onDocKey(e, 'key'));
    document.addEventListener('keyup', (e) => this.onDocKey(e, 'keyup'));
  }

  buildChrome() {
    this.layer.innerHTML = '';
    this.tabsEl = h('div', { class: 'gui-tabs' });
    const btn = (name, label, fn) => {
      const b = h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, html: icon(name) });
      b.addEventListener('click', fn);
      return b;
    };
    this.keypadBtn = btn('dpad', 'Pfeiltasten', () => this.toggleKeypad());
    this.kbdBtn = btn('keyboardDown', 'Tastatur', () => this.focusKeyCatcher());
    this.zoomBtn = btn('zoom', 'Zoom: anpassen / 100 %', () => { this.zoomFit = !this.zoomFit; this.zoomBtn.classList.toggle('on', !this.zoomFit); this.scheduleLayout(); });
    const minBtn = btn('minimize', 'Ausblenden', () => this.hide());
    const stopBtn = btn('stop', 'Programm stoppen', () => this.onStop?.());
    stopBtn.classList.add('danger');
    const closeBtn = btn('close', 'Fenster schließen', () => this.closeActive());
    this.bar = h('div', { class: 'gui-bar' }, this.tabsEl, h('div', { class: 'gui-bar-actions' }, this.keypadBtn, this.kbdBtn, this.zoomBtn, minBtn, stopBtn, closeBtn));
    this.stage = h('div', { class: 'gui-stage' });
    this.keyCatcher = h('input', { class: 'key-catcher', type: 'text', autocapitalize: 'off', autocorrect: 'off', 'aria-label': 'Tastatureingabe für das Programm' });
    this.keyCatcher.addEventListener('keydown', (e) => { this.routeKey(e, 'key'); if (e.key.length > 1) e.preventDefault(); });
    this.keyCatcher.addEventListener('keyup', (e) => this.routeKey(e, 'keyup'));
    this.keyCatcher.addEventListener('input', () => { this.keyCatcher.value = ''; });
    this.keypad = this.buildKeypad();
    this.layer.append(this.bar, this.stage, this.keypad, this.keyCatcher);
  }

  buildKeypad() {
    const pad = h('div', { class: 'gui-keypad', hidden: true });
    const keys = [['Up', '↑'], ['Left', '←'], ['Down', '↓'], ['Right', '→'], ['space', 'Leer'], ['Return', '⏎'], ['Escape', 'Esc']];
    for (const [sym, label] of keys) {
      const b = h('button', { class: `kp kp-${sym}`, type: 'button', text: label });
      const fire = (t) => this.routeKeysym(sym, t);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (er) { /* synthetisch */ } fire('key'); b.classList.add('pressed'); });
      b.addEventListener('pointerup', (e) => { e.preventDefault(); fire('keyup'); b.classList.remove('pressed'); });
      b.addEventListener('pointercancel', () => { fire('keyup'); b.classList.remove('pressed'); });
      pad.append(b);
    }
    return pad;
  }

  toggleKeypad() {
    this.keypad.hidden = !this.keypad.hidden;
    this.keypadBtn.classList.toggle('on', !this.keypad.hidden);
  }

  focusKeyCatcher() {
    this.keyCatcher.focus();
  }

  reset() {
    this.stage.textContent = '';
    this.windows = new Map();     // id -> Fenster
    this.nodes = new Map();       // tk-Widgets
    this.qnodes = new Map();      // Qt-Widgets und Layouts
    this.vars = new Map();
    this.images = new Map();
    this.bindTypes = new Map();
    this.menus = new Map();
    this.textTags = new Map();
    this.ttkStyles = {};
    this.active = null;
    this.geom = {};
    this.layoutScheduled = false;
    this.layer.hidden = true;
    this.visible = false;
    this.figures = new Set();
    this.qtEvents = new Map();
    this.renderTabs();
    this.onWindowsChanged?.(0, false);
  }

  allClosed() {
    if (!this.windows.size) this.hide();
  }

  noteFigure() { /* Abbildungen erscheinen in der Konsole */ }

  get windowCount() { return [...this.windows.values()].filter(w => !w.withdrawn).length; }

  show(id) {
    if (id && this.windows.has(id)) this.active = id;
    this.layer.hidden = false;
    this.visible = true;
    this.renderTabs();
    this.scheduleLayout();
    this.onWindowsChanged?.(this.windowCount, true);
  }

  hide() {
    this.layer.hidden = true;
    this.visible = false;
    this.keyCatcher.blur();
    this.onWindowsChanged?.(this.windowCount, false);
  }

  closeActive() {
    const w = this.windows.get(this.active);
    if (!w) { this.hide(); return; }
    this.sendEvent({ k: 'close', w: w.id });
  }

  renderTabs() {
    this.tabsEl.textContent = '';
    const list = [...this.windows.values()].filter(w => !w.withdrawn);
    for (const w of list) {
      const b = h('button', { class: `gui-tab${w.id === this.active ? ' on' : ''}`, type: 'button', text: w.title || 'Fenster' });
      b.addEventListener('click', () => { this.active = w.id; this.renderTabs(); this.scheduleLayout(); });
      this.tabsEl.append(b);
    }
    for (const w of this.windows.values()) {
      w.frame.hidden = w.id !== this.active || w.withdrawn;
    }
  }

  // -------------------------------------------------------------- Fenster
  createWindow(id, kind, title) {
    const titleEl = h('div', { class: 'win-title', text: title || 'tk' });
    const menubar = h('div', { class: 'win-menubar', hidden: true });
    const content = h('div', { class: `win-content ${kind}` });
    const scaler = h('div', { class: 'win-scaler' }, content);
    const frame = h('div', { class: 'win-frame', dataset: { win: id } }, h('div', { class: 'win-titlebar' }, h('span', { class: 'win-dots', html: '<i></i><i></i><i></i>' }), titleEl), menubar, scaler);
    this.stage.append(frame);
    const w = { id, kind, frame, titleEl, menubar, content, scaler, title: title || '', geometry: null, withdrawn: false, scale: 1, override: false };
    this.windows.set(id, w);
    if (!this.active || !this.windows.has(this.active)) this.active = id;
    else this.active = id;
    this.attachPointer(content);
    this.show(id);
    return w;
  }

  removeWindow(id) {
    const w = this.windows.get(id);
    if (!w) return;
    w.frame.remove();
    this.windows.delete(id);
    if (this.active === id) this.active = [...this.windows.keys()].pop() || null;
    this.renderTabs();
    if (!this.windows.size) this.hide();
    else this.onWindowsChanged?.(this.windowCount, this.visible);
  }

  windowOf(node) {
    let n = node;
    while (n && !this.windows.has(n.wid)) n = n.parent;
    return n ? this.windows.get(n.wid) : null;
  }

  // ------------------------------------------------------------ Operationen
  apply(ops) {
    for (const op of ops) {
      try { this.applyOp(op); } catch (e) { console.warn('GUI-Operation fehlgeschlagen', op, e); }
    }
    this.scheduleLayout();
  }

  applyOp(op) {
    const [name, a, b, c, d, e] = op;
    switch (name) {
      case 'reset': this.reset(); break;
      case 'new': this.tkNew(a, b, c, d || {}); break;
      case 'cfg': this.tkConfig(a, b || {}); break;
      case 'pack': this.tkManage(a, 'pack', b); break;
      case 'grid': this.tkManage(a, 'grid', b); break;
      case 'place': this.tkManage(a, 'place', b); break;
      case 'forget': this.tkForget(a); break;
      case 'rowcol': { const n = this.nodes.get(a); if (n) { (b === 'col' ? n.cols : n.rows)[c] = d; this.dirty(n); } break; }
      case 'propagate': { const n = this.nodes.get(a); if (n) { n.propagate[b] = c; this.dirty(n); } break; }
      case 'grid_anchor': break;
      case 'destroy': this.destroy(a); break;
      case 'var': this.setVar(a, b); break;
      case 'value': this.setValue(a, b); break;
      case 'wm': this.wm(a, b, c); break;
      case 'bind': this.bindTypes.set(a, new Set(b)); this.refreshPointerStyle(); break;
      case 'focus': this.focusWidget(a); break;
      case 'cursor': break;
      case 'select': break;
      case 'see': this.see(a, b); break;
      case 'text': this.renderText(a, b, c); break;
      case 'tagcfg': { let m = this.textTags.get(a); if (!m) this.textTags.set(a, m = {}); m[b] = c; break; }
      case 'items': this.renderListbox(a, b, c, d); break;
      case 'menu': this.menus.set(a, b); this.refreshMenubars(); break;
      case 'popup': this.popupTkMenu(a, b[0], b[1]); break;
      case 'unpost': break;
      case 'tabs': this.renderNotebook(a, b, c); break;
      case 'tree': this.renderTree(a, b); break;
      case 'pane_add': { const n = this.nodes.get(b); const p = this.nodes.get(a); if (n && p) { this.unmanage(n); n.manager = 'pane'; n.mopts = c; n.master = p; p.panes.push(n); this.dirty(p); } break; }
      case 'img': this.addImage(a, b, c, d, e); break;
      case 'img_rgba': this.addRgbaImage(a, b, c, d); break;
      case 'img_scaled': this.addScaledImage(a, b, c, d); break;
      case 'cv_new': this.cvNew(a, b, c, d, e, op[6]); break;
      case 'cv_coords': this.cvCoords(a, b, c); break;
      case 'cv_move': this.cvMove(a, b, c, d); break;
      case 'cv_del': this.cvDelete(a, b); break;
      case 'cv_cfg': this.cvConfig(a, b, c, d); break;
      case 'cv_tags': break;
      case 'cv_order': this.cvOrder(a, b); break;
      case 'cv_bind': { const n = this.nodes.get(a); if (n) { n.itemTypes = new Set(b); n.el.classList.toggle('interactive', true); } break; }
      case 'bell': navigator.vibrate?.(30); break;
      case 'clipboard': navigator.clipboard?.writeText?.(a).catch(() => {}); break;
      case 'raise': { const n = this.nodes.get(a); if (n && this.windows.has(a)) { this.active = a; this.renderTabs(); } break; }
      case 'lower': break;
      case 'dialog_async': this.dialog(a); break;
      case 'ttk_theme': break;
      case 'font_changed': break;
      case 'open_url': window.open(a, '_blank', 'noopener'); break;
      // ---- Qt
      case 'qt_app': break;
      case 'qt_new': this.qtNew(a, b, c, d || {}); break;
      case 'qt_cfg': this.qtConfig(a, b || {}); break;
      case 'qt_window': this.qtWindow(a, b); break;
      case 'qt_wm': this.qtWm(a, b, c); break;
      case 'qt_close': this.removeWindow(a); break;
      case 'qt_events': this.qtEvents.set(a, new Set(b)); this.qtAttachEvents(a); break;
      case 'qt_paint': this.qtPaint(a, b); break;
      case 'qt_layout': this.qtNewLayout(a, b); break;
      case 'qt_ladd': this.qtLayoutAdd(a, b, c, d || {}); break;
      case 'qt_lremove': { const it = this.qnodes.get(b); if (it) it.el.remove(); break; }
      case 'qt_lcfg': this.qtLayoutConfig(a, b); break;
      case 'qt_setlayout': this.qtSetLayout(a, b); break;
      case 'qt_parent': this.qtReparent(a, b); break;
      case 'qt_central': this.qtCentral(a, b); break;
      case 'qt_setmenubar': this.qtSetMenubar(a, b); break;
      case 'qt_menubar': this.qtMenubar(a, b); break;
      case 'qt_menu': break;
      case 'qt_setstatusbar': this.qtSetStatusbar(a, b); break;
      case 'qt_status_add': { const sb = this.qnodes.get(a); const w = this.qnodes.get(b); if (sb && w) sb.el.append(w.el); break; }
      case 'qt_addtoolbar': this.qtAddToolbar(a, b); break;
      case 'qt_tool_add': { const tb = this.qnodes.get(a); const w = this.qnodes.get(b); if (tb && w) tb.el.append(w.el); break; }
      case 'qt_appfont': this.layer.style.setProperty('--qt-font', qtFontCss(a)); break;
      case 'qt_appcss': this.qtAppCss = a; break;
      default: break;
    }
  }

  // =============================================================== tkinter
  tkNew(wid, cls, parentId, opts) {
    const parent = parentId != null ? this.nodes.get(parentId) : null;
    const node = {
      wid, cls, parent, opts: {}, children: [], manager: null, mopts: null, master: null,
      packList: [], gridList: [], placeList: [], panes: [], cols: {}, rows: {}, propagate: { pack: true, grid: true },
      req: null, reqDirty: true, geom: null, items: new Map(), itemOrder: [], tabs: [], ttk: !!opts._ttk,
    };
    this.nodes.set(wid, node);
    if (parent) parent.children.push(node);
    if (cls === 'Tk' || cls === 'Toplevel') {
      const win = this.createWindow(wid, 'tk', opts.title || (cls === 'Tk' ? 'tk' : 'Toplevel'));
      node.el = win.content;
      node.el.dataset.wid = wid;
      node.win = win;
    } else {
      node.el = this.tkCreateElement(node, cls);
      node.el.dataset.wid = wid;
      node.el.classList.add('tkw', `tk-${cls}`);
      if (node.ttk) node.el.classList.add('ttk');
      node.el.style.display = 'none';
      const host = parent ? this.childHost(parent) : null;
      host?.append(node.el);
    }
    this.tkConfig(wid, opts, true);
  }

  childHost(parent) {
    return parent.host || parent.el;
  }

  tkCreateElement(node, cls) {
    switch (cls) {
      case 'Frame': case 'Sizegrip': return h('div');
      case 'LabelFrame': {
        const el = h('div');
        node.labelEl = h('div', { class: 'lf-label' });
        el.append(node.labelEl);
        return el;
      }
      case 'Label': case 'Message': {
        const el = h('div');
        node.textEl = h('span', { class: 'lbl-text' });
        el.append(node.textEl);
        return el;
      }
      case 'Button': {
        const el = h('button', { type: 'button' });
        node.textEl = h('span', { class: 'lbl-text' });
        el.append(node.textEl);
        el.addEventListener('click', () => this.sendEvent({ k: 'cmd', w: node.wid }));
        return el;
      }
      case 'Menubutton': {
        const el = h('button', { type: 'button' });
        node.textEl = h('span', { class: 'lbl-text' });
        el.append(node.textEl, h('span', { class: 'mb-arrow', text: '▾' }));
        el.addEventListener('click', () => {
          const menuId = node.opts.menu;
          if (menuId) this.popupTkMenu(menuId, null, null, el);
        });
        return el;
      }
      case 'OptionMenu': {
        const el = h('div', { class: 'optmenu' });
        const sel = h('select');
        node.selectEl = sel;
        sel.addEventListener('change', () => this.sendEvent({ k: 'val', w: node.wid, v: sel.value }));
        el.append(sel);
        return el;
      }
      case 'Checkbutton': case 'Radiobutton': {
        const el = h('label', { class: 'chk' });
        const input = h('input', { type: cls === 'Checkbutton' ? 'checkbox' : 'radio' });
        node.inputEl = input;
        node.textEl = h('span', { class: 'lbl-text' });
        el.append(input, node.textEl);
        input.addEventListener('click', (e) => {
          e.preventDefault();
          this.sendEvent({ k: 'cmd', w: node.wid });
        });
        return el;
      }
      case 'Entry': case 'Spinbox': case 'Combobox': {
        const el = h('div', { class: 'entry-wrap' });
        const input = h('input', { type: 'text', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
        node.inputEl = input;
        el.append(input);
        input.addEventListener('input', () => this.sendEvent({ k: 'val', w: node.wid, v: input.value, cur: input.selectionStart ?? input.value.length }));
        input.addEventListener('keydown', (e) => this.inputKey(node, e, 'key'));
        input.addEventListener('keyup', (e) => this.inputKey(node, e, 'keyup'));
        input.addEventListener('focus', () => this.sendWidgetEvent(node, 'focus', {}));
        input.addEventListener('blur', () => this.sendWidgetEvent(node, 'blur', {}));
        if (cls === 'Spinbox') {
          const up = h('button', { type: 'button', class: 'spin-btn', text: '▲', tabindex: '-1' });
          const down = h('button', { type: 'button', class: 'spin-btn', text: '▼', tabindex: '-1' });
          up.addEventListener('click', () => this.sendEvent({ k: 'cmd', w: node.wid, dir: 1 }));
          down.addEventListener('click', () => this.sendEvent({ k: 'cmd', w: node.wid, dir: -1 }));
          el.append(h('div', { class: 'spin-btns' }, up, down));
        }
        if (cls === 'Combobox') {
          const sel = h('select', { class: 'combo-select', tabindex: '-1', 'aria-label': 'Auswahl' });
          node.selectEl = sel;
          sel.addEventListener('focus', () => this.sendEvent({ k: 'post', w: node.wid }));
          sel.addEventListener('change', () => {
            input.value = sel.value;
            this.sendEvent({ k: 'val', w: node.wid, v: sel.value, pick: true });
          });
          el.append(h('span', { class: 'combo-arrow', text: '▾' }), sel);
        }
        return el;
      }
      case 'Text': {
        const el = h('div', { class: 'text-wrap' });
        const ta = h('textarea', { autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
        node.inputEl = ta;
        node.richEl = h('div', { class: 'text-rich', hidden: true });
        el.append(ta, node.richEl);
        ta.addEventListener('input', () => this.sendEvent({ k: 'text', w: node.wid, v: ta.value, cur: ta.selectionStart ?? ta.value.length }));
        ta.addEventListener('keydown', (e) => this.inputKey(node, e, 'key'));
        ta.addEventListener('keyup', (e) => this.inputKey(node, e, 'keyup'));
        node.richEl.addEventListener('input', () => this.sendEvent({ k: 'text', w: node.wid, v: node.richEl.innerText.replace(/\n$/, '') }));
        return el;
      }
      case 'Canvas': {
        const el = h('div', { class: 'canvas-wrap' });
        const svg = document.createElementNS(SVGNS, 'svg');
        svg.setAttribute('class', 'tk-svg');
        const defs = document.createElementNS(SVGNS, 'defs');
        svg.append(defs);
        node.svg = svg;
        node.host = h('div', { class: 'canvas-windows' });
        el.append(svg, node.host);
        return el;
      }
      case 'Scale': {
        const el = h('div', { class: 'scale' });
        node.labelEl = h('div', { class: 'scale-label' });
        node.valueEl = h('div', { class: 'scale-value' });
        const input = h('input', { type: 'range' });
        node.inputEl = input;
        input.addEventListener('input', () => {
          node.valueEl.textContent = this.fmtScale(node, input.value);
          this.sendEvent({ k: 'val', w: node.wid, v: parseFloat(input.value) });
        });
        el.append(node.labelEl, node.valueEl, input);
        return el;
      }
      case 'Scrollbar': return h('div', { class: 'scrollbar' });
      case 'Separator': return h('div', { class: 'separator' });
      case 'Listbox': {
        const el = h('div', { class: 'listbox', tabindex: '0' });
        node.listEl = el;
        el.addEventListener('click', (e) => {
          const item = e.target.closest('.lb-item');
          if (!item) return;
          const i = +item.dataset.i;
          let sel = [...(node.sel || [])];
          const mode = node.opts.selectmode || 'browse';
          if (mode === 'multiple' || (mode === 'extended' && (e.metaKey || e.ctrlKey))) {
            sel = sel.includes(i) ? sel.filter(x => x !== i) : [...sel, i];
          } else sel = [i];
          node.sel = sel;
          this.highlightListbox(node);
          this.sendEvent({ k: 'sel', w: node.wid, sel });
        });
        return el;
      }
      case 'Progressbar': {
        const el = h('div', { class: 'progress' });
        node.barEl = h('div', { class: 'progress-bar' });
        el.append(node.barEl);
        return el;
      }
      case 'Notebook': {
        const el = h('div', { class: 'notebook' });
        node.tabBar = h('div', { class: 'nb-tabs' });
        node.host = h('div', { class: 'nb-panel' });
        el.append(node.tabBar, node.host);
        return el;
      }
      case 'Treeview': {
        const el = h('div', { class: 'treeview' });
        node.tableEl = el;
        return el;
      }
      case 'PanedWindow': return h('div', { class: 'paned' });
      case 'Menu': {
        const el = h('div');
        el.hidden = true;
        return el;
      }
      default: return h('div');
    }
  }

  tkConfig(wid, opts, initial = false) {
    const node = this.nodes.get(wid);
    if (!node) return;
    Object.assign(node.opts, opts);
    const o = node.opts;
    const el = node.el;
    node.reqDirty = true;
    if (node.win) {
      if (opts.background !== undefined) el.style.background = tkColor(o.background) || '';
      if (opts.menu !== undefined) this.refreshMenubars();
      if (opts.width !== undefined || opts.height !== undefined) this.dirty(node);
      this.dirty(node);
      return;
    }
    if (opts._style) node.style = opts._style;
    const st = node.ttk ? (node.style || {}) : {};
    const get = (k) => (o[k] !== undefined && o[k] !== null && o[k] !== '') ? o[k] : st[k];
    const cls = node.cls;
    // Farben
    const bg = tkColor(get('background'));
    const fg = tkColor(get('foreground'));
    node.hasBg = !!bg;
    el.style.background = bg || '';
    el.style.color = fg || '';
    if (node.inputEl && (cls === 'Entry' || cls === 'Spinbox' || cls === 'Combobox' || cls === 'Text')) {
      node.inputEl.style.background = tkColor(get('fieldbackground')) || bg || '';
      node.inputEl.style.color = fg || '';
      if (cls !== 'Text') el.style.background = '';
    }
    if (cls === 'Text') {
      node.inputEl.style.caretColor = tkColor(o.insertbackground) || '';
    }
    // Rahmen
    const relief = get('relief');
    const bw = get('borderwidth');
    if ((relief !== undefined && relief !== null) || bw !== undefined) {
      const r = RELIEF[relief] || (relief ? 'solid' : null);
      if (r && r !== 'none' && (bw == null || bw > 0)) {
        el.style.border = `${bw == null ? (cls === 'Button' ? 2 : 1) : bw}px ${r} ${tkColor(get('highlightbackground')) || (bg ? 'rgba(0,0,0,0.25)' : '#a8a8a8')}`;
        if (r === 'outset' || r === 'inset' || r === 'groove' || r === 'ridge') el.style.borderColor = bg || '#d4d4d4';
        node.customBorder = true;
      } else if (relief === 'flat' || bw === 0) {
        el.style.border = 'none';
        node.customBorder = true;
      }
    }
    if (o.highlightthickness > 0 && (cls === 'Frame' || cls === 'Canvas') && o.highlightbackground) {
      el.style.outline = `${o.highlightthickness}px solid ${tkColor(o.highlightbackground)}`;
      el.style.outlineOffset = `-${o.highlightthickness}px`;
    }
    // Schrift
    const font = get('font');
    if (font !== undefined || initial) applyFont(node.inputEl && cls !== 'Checkbutton' && cls !== 'Radiobutton' ? node.inputEl : el, font || (cls === 'Text' ? { named: 'TkFixedFont' } : null));
    if (node.inputEl && (cls === 'Entry' || cls === 'Spinbox' || cls === 'Combobox') && font) applyFont(node.inputEl, font);
    // Text, Bild
    if (node.textEl) {
      let text = o.text;
      if (o.textvariable && this.vars.has(o.textvariable)) text = this.vars.get(o.textvariable).value;
      this.setLabelContent(node, text == null ? '' : String(text));
    }
    if (o.state !== undefined) {
      const disabled = o.state === 'disabled';
      el.classList.toggle('disabled', disabled);
      if (node.inputEl) {
        node.inputEl.disabled = disabled;
        if (cls === 'Combobox' || cls === 'Entry' || cls === 'Spinbox') node.inputEl.readOnly = o.state === 'readonly';
      }
      if (cls === 'Button') el.disabled = disabled;
      if (node.selectEl) node.selectEl.disabled = disabled;
    }
    if (cls === 'Combobox') {
      const ro = o.state === 'readonly';
      el.classList.toggle('readonly', ro);
    }
    if (node.inputEl && o.show !== undefined && cls !== 'Text') node.inputEl.type = o.show ? 'password' : 'text';
    if (node.inputEl && o.justify && cls !== 'Text') node.inputEl.style.textAlign = o.justify === 'center' ? 'center' : o.justify === 'right' ? 'right' : 'left';
    if (node.textEl && o.justify) node.textEl.style.textAlign = o.justify;
    if (node.textEl && (o.anchor || st.anchor) && (cls === 'Label' || cls === 'Button' || cls === 'Message' || cls === 'Checkbutton' || cls === 'Radiobutton')) {
      const a = anc(o.anchor || st.anchor);
      el.style.justifyContent = a.includes('w') ? 'flex-start' : a.includes('e') ? 'flex-end' : 'center';
      el.style.alignItems = a.includes('n') ? 'flex-start' : a.includes('s') ? 'flex-end' : 'center';
    }
    if ((cls === 'Label' || cls === 'Button' || cls === 'Message' || cls === 'Checkbutton' || cls === 'Radiobutton') && (opts.padx !== undefined || opts.pady !== undefined || opts.padding !== undefined)) {
      const pad = o.padding != null ? (Array.isArray(o.padding) ? o.padding : String(o.padding).split(/\s+/)).map(Number) : null;
      if (pad) el.style.padding = pad.length === 1 ? `${pad[0]}px` : pad.length === 2 ? `${pad[1]}px ${pad[0]}px` : `${pad[1]}px ${pad[2] ?? pad[0]}px ${pad[3] ?? pad[1]}px ${pad[0]}px`;
      else el.style.padding = `${o.pady ?? 1}px ${o.padx ?? (cls === 'Button' ? 12 : 2)}px`;
    }
    if (o.wraplength !== undefined && node.textEl) node.textEl.style.maxWidth = o.wraplength > 0 ? `${o.wraplength}px` : '';
    if (cls === 'Message' && node.textEl) node.textEl.style.maxWidth = `${o.width > 0 ? o.width : 250}px`;
    // Variablen
    for (const key of ['textvariable', 'variable']) {
      if (opts[key] !== undefined && o[key]) {
        const v = this.vars.get(o[key]) || this.setVar(o[key], key === 'variable' ? 0 : '');
        v.widgets.add(wid);
        this.updateFromVar(node);
      }
    }
    if (cls === 'Checkbutton' || cls === 'Radiobutton') {
      if (o.indicatoron === 0 || o.indicatoron === false) el.classList.add('toolbutton');
      this.updateFromVar(node);
    }
    if (cls === 'Scale') {
      const input = node.inputEl;
      input.min = o.from ?? 0;
      input.max = o.to ?? 100;
      const res = o.resolution ?? 1;
      input.step = res > 0 ? res : 'any';
      node.labelEl.textContent = o.label || '';
      node.labelEl.hidden = !o.label;
      node.valueEl.hidden = !(o.showvalue === undefined ? !node.ttk : o.showvalue);
      el.classList.toggle('vertical', (o.orient || (node.ttk ? 'horizontal' : 'vertical')) === 'vertical');
      if (opts.value !== undefined) { input.value = opts.value; node.valueEl.textContent = this.fmtScale(node, opts.value); }
      this.updateFromVar(node);
    }
    if (cls === 'Progressbar') this.updateProgress(node);
    if (cls === 'Separator') el.classList.toggle('vertical', o.orient === 'vertical');
    if (cls === 'Scrollbar') el.classList.toggle('horizontal', o.orient === 'horizontal');
    if (cls === 'LabelFrame' && node.labelEl) {
      node.labelEl.textContent = o.text || '';
      node.labelEl.hidden = !o.text;
      if (font) applyFont(node.labelEl, font);
    }
    if ((cls === 'Combobox' || cls === 'Spinbox') && o.values !== undefined) {
      const vals = Array.isArray(o.values) ? o.values : String(o.values).split(/\s+/).filter(Boolean);
      if (node.selectEl) {
        node.selectEl.textContent = '';
        node.selectEl.append(h('option', { value: '', text: '', disabled: true }));
        for (const v of vals) node.selectEl.append(h('option', { value: String(v), text: String(v) }));
        node.selectEl.value = '';
      }
    }
    if (cls === 'OptionMenu') {
      const vals = o.values || [];
      node.selectEl.textContent = '';
      for (const v of vals) node.selectEl.append(h('option', { value: String(v), text: String(v) }));
      this.updateFromVar(node);
    }
    if (cls === 'Text') {
      node.inputEl.style.whiteSpace = o.wrap === 'none' ? 'pre' : 'pre-wrap';
      node.inputEl.style.overflowWrap = o.wrap === 'word' ? 'break-word' : 'anywhere';
    }
    if (cls === 'Canvas') {
      el.style.background = bg || (node.hasBg ? '' : '#f0f0f0');
      if (o.cursor === 'none') el.style.cursor = 'none';
    }
    if (cls === 'Listbox') this.highlightListbox(node);
    if (opts._anim !== undefined && cls === 'Progressbar') el.classList.toggle('indeterminate', !!opts._anim || o.mode === 'indeterminate' && opts._anim);
    if (cls === 'Menubutton' && o.menu) node.menuId = o.menu;
    this.dirty(node);
  }

  setLabelContent(node, text) {
    const o = node.opts;
    const img = o.image ? this.images.get(o.image) : null;
    const el = node.textEl;
    el.textContent = '';
    const compound = o.compound || (img ? 'none' : null);
    if (img && (compound === 'none' || !text || compound === 'image')) {
      el.append(this.imgElement(img));
      el.classList.add('has-img');
    } else if (img && compound && compound !== 'none') {
      const im = this.imgElement(img);
      const t = document.createElement('span');
      t.textContent = text;
      el.classList.add('compound', `compound-${compound}`);
      if (compound === 'left' || compound === 'top') el.append(im, t); else el.append(t, im);
    } else {
      el.classList.remove('has-img');
      el.textContent = text;
    }
    if (o.underline != null && o.underline >= 0 && typeof o.underline === 'number' && !img) {
      // Unterstrich fuer Tastenkuerzel ignorieren
    }
  }

  imgElement(img) {
    const im = document.createElement('img');
    im.src = img.url;
    im.width = img.w;
    im.height = img.h;
    im.draggable = false;
    return im;
  }

  fmtScale(node, v) {
    const res = node.opts.resolution ?? 1;
    const x = parseFloat(v);
    if (res >= 1) return String(Math.round(x));
    const dec = Math.max(0, Math.ceil(-Math.log10(res || 0.01)));
    return x.toFixed(Math.min(dec, 6));
  }

  updateProgress(node) {
    const o = node.opts;
    let v = o.value || 0;
    if (o.variable && this.vars.has(o.variable)) v = parseFloat(this.vars.get(o.variable).value) || 0;
    const max = o.maximum || 100;
    node.barEl.style.width = `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
    node.el.classList.toggle('vertical', o.orient === 'vertical');
    if (o.mode === 'indeterminate') node.el.classList.add('indeterminate-mode');
  }

  // Variablen
  setVar(name, value) {
    let v = this.vars.get(name);
    if (!v) { v = { value, widgets: new Set() }; this.vars.set(name, v); }
    v.value = value;
    for (const wid of v.widgets) {
      const n = this.nodes.get(wid);
      if (n) this.updateFromVar(n);
    }
    return v;
  }

  updateFromVar(node) {
    const o = node.opts;
    const cls = node.cls;
    if (o.textvariable && this.vars.has(o.textvariable)) {
      const val = this.vars.get(o.textvariable).value;
      const s = val == null ? '' : String(val);
      if (node.textEl && cls !== 'Checkbutton' && cls !== 'Radiobutton') { this.setLabelContent(node, s); node.reqDirty = true; this.dirty(node); }
      if (node.inputEl && (cls === 'Entry' || cls === 'Spinbox' || cls === 'Combobox') && node.inputEl.value !== s) node.inputEl.value = s;
      if (cls === 'OptionMenu') node.selectEl.value = s;
    }
    if (o.variable && this.vars.has(o.variable)) {
      const val = this.vars.get(o.variable).value;
      if (cls === 'Checkbutton') node.inputEl.checked = tclStr(val) === tclStr(o.onvalue ?? 1);
      else if (cls === 'Radiobutton') node.inputEl.checked = tclStr(val) === tclStr(o.value ?? '');
      else if (cls === 'Scale') {
        if (document.activeElement !== node.inputEl) node.inputEl.value = val;
        node.valueEl.textContent = this.fmtScale(node, val);
      } else if (cls === 'Progressbar') this.updateProgress(node);
    }
    if (cls === 'Checkbutton' || cls === 'Radiobutton') node.el.classList.toggle('checked', node.inputEl.checked);
  }

  setValue(wid, value) {
    const node = this.nodes.get(wid);
    if (!node) return;
    if (node.inputEl && (node.cls === 'Entry' || node.cls === 'Spinbox' || node.cls === 'Combobox')) {
      if (node.inputEl.value !== String(value)) node.inputEl.value = String(value);
    } else if (node.cls === 'Scale') {
      node.inputEl.value = value;
      node.valueEl.textContent = this.fmtScale(node, value);
    }
  }

  wm(wid, what, value) {
    const node = this.nodes.get(wid);
    const win = this.windows.get(wid);
    if (!win) return;
    switch (what) {
      case 'title': win.title = String(value); win.titleEl.textContent = win.title; this.renderTabs(); break;
      case 'geometry': win.geometry = value; this.dirty(node); break;
      case 'minsize': win.minsize = value; this.dirty(node); break;
      case 'maxsize': break;
      case 'state':
        win.withdrawn = value === 'withdrawn' || value === 'iconic';
        if (value === 'zoomed') win.zoomed = true;
        if (!win.withdrawn) this.active = wid;
        else if (this.active === wid) this.active = [...this.windows.values()].find(w => !w.withdrawn)?.id || null;
        this.renderTabs();
        if (!win.withdrawn) this.show(wid);
        this.onWindowsChanged?.(this.windowCount, this.visible);
        break;
      case 'attr':
        if (value[0] === 'fullscreen' || value[0] === 'zoomed') { win.zoomed = !!value[1] && value[1] !== '0'; this.dirty(node); }
        if (value[0] === 'alpha') win.frame.style.opacity = value[1];
        break;
      case 'override': win.override = !!value; win.frame.classList.toggle('override', !!value); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ Geometrie
  tkManage(wid, manager, opts) {
    const node = this.nodes.get(wid);
    if (!node) return;
    const masterId = opts.in || node.parent?.wid;
    const master = this.nodes.get(masterId) || node.parent;
    if (!master) return;
    const wasSame = node.manager === manager && node.master === master;
    if (!wasSame) this.unmanage(node);
    node.manager = manager;
    node.mopts = opts;
    node.master = master;
    if (manager === 'pack') {
      const list = master.packList;
      const idx = list.indexOf(node);
      if (opts.before || opts.after) {
        if (idx >= 0) list.splice(idx, 1);
        const ref = this.nodes.get(opts.before || opts.after);
        let at = ref ? list.indexOf(ref) : -1;
        if (at < 0) list.push(node);
        else list.splice(opts.after ? at + 1 : at, 0, node);
      } else if (idx < 0) list.push(node);
    } else if (manager === 'grid') {
      if (!master.gridList.includes(node)) master.gridList.push(node);
    } else if (manager === 'place') {
      if (!master.placeList.includes(node)) master.placeList.push(node);
    }
    if (node.el.parentElement !== this.childHost(master) && master !== node.parent) this.childHost(master).append(node.el);
    node.el.style.display = '';
    this.dirty(master);
  }

  unmanage(node) {
    const m = node.master;
    if (m) {
      for (const k of ['packList', 'gridList', 'placeList', 'panes']) {
        const i = m[k].indexOf(node);
        if (i >= 0) m[k].splice(i, 1);
      }
      this.dirty(m);
    }
    node.manager = null;
    node.master = null;
  }

  tkForget(wid) {
    const node = this.nodes.get(wid) || this.qnodes.get(wid);
    if (!node) return;
    if (this.nodes.has(wid)) {
      this.unmanage(node);
      node.el.style.display = 'none';
    } else {
      node.el.remove();
    }
  }

  destroy(wid) {
    if (this.qnodes.has(wid)) {
      const q = this.qnodes.get(wid);
      q.el.remove();
      this.qnodes.delete(wid);
      if (this.windows.has(wid)) this.removeWindow(wid);
      return;
    }
    const node = this.nodes.get(wid);
    if (!node) return;
    const rm = (n) => {
      for (const c of n.children) rm(c);
      this.nodes.delete(n.wid);
      this.bindTypes.delete(n.wid);
    };
    this.unmanage(node);
    if (node.parent) node.parent.children = node.parent.children.filter(c => c !== node);
    rm(node);
    if (this.windows.has(wid)) this.removeWindow(wid);
    else node.el.remove();
    this.scheduleLayout();
  }

  dirty(node) {
    this.scheduleLayout();
  }

  scheduleLayout() {
    if (this.layoutScheduled) return;
    this.layoutScheduled = true;
    requestAnimationFrame(() => {
      this.layoutScheduled = false;
      this.layoutAll(true);
    });
  }

  layoutNow() {
    this.layoutAll(false);
    const out = {};
    for (const [wid, g] of Object.entries(this.geom)) out[wid] = g;
    Object.assign(out, this.qtGeometry());
    return out;
  }

  layoutAll(report) {
    const changed = {};
    for (const win of this.windows.values()) {
      if (win.kind === 'tk') this.layoutTkWindow(win, changed);
      else this.layoutQtWindow(win);
    }
    if (report) {
      const g = {};
      for (const [wid, geo] of Object.entries(changed)) g[wid] = geo;
      const qt = this.qtGeometry(true);
      Object.assign(g, qt);
      if (Object.keys(g).length) this.sendEvent({ k: 'geom', g });
      // <Configure>-Ereignisse
      for (const [wid, geo] of Object.entries(changed)) {
        if (this.wantsType(wid, 'configure')) this.sendEvent({ k: 'ev', w: wid, t: 'configure', width: Math.round(geo[2]), height: Math.round(geo[3]), x: Math.round(geo[0]), y: Math.round(geo[1]) });
      }
    }
  }

  // Natuerliche Groesse eines Blatt-Widgets messen
  measureLeaf(node) {
    const el = node.el;
    const o = node.opts;
    const cls = node.cls;
    const st = el.style;
    const prev = st.display;
    st.display = '';
    st.width = '';
    st.height = '';
    const chW = (n, fontEl) => `${n}ch`;
    // Breite/Hoehe in Zeichen bzw. Zeilen
    if (cls === 'Entry' || cls === 'Spinbox' || cls === 'Combobox') {
      st.width = chW(o.width || 20) ;
      if (node.inputEl) node.inputEl.style.width = '100%';
      st.width = `calc(${o.width || 20}ch + ${cls === 'Entry' ? 12 : 34}px)`;
    } else if (cls === 'Text' || cls === 'Listbox') {
      const lines = o.height || (cls === 'Text' ? 24 : 10);
      st.width = `calc(${o.width || (cls === 'Text' ? 80 : 20)}ch + 10px)`;
      st.height = `calc(${lines} * 1.35em + 8px)`;
    } else if ((cls === 'Label' || cls === 'Button' || cls === 'Checkbutton' || cls === 'Radiobutton' || cls === 'Menubutton') && o.width) {
      const img = o.image && this.images.get(o.image);
      st.width = img && !o.text ? `${o.width}px` : `calc(${o.width}ch + ${cls === 'Button' ? 16 : 6}px)`;
      if (o.height) st.height = img && !o.text ? `${o.height}px` : `calc(${o.height} * 1.35em + 6px)`;
    } else if (cls === 'Canvas') {
      st.width = `${(o.width ?? 378) + 2 * (o.borderwidth || 0) + 2 * (o.highlightthickness ?? 0)}px`;
      st.height = `${(o.height ?? 265) + 2 * (o.borderwidth || 0) + 2 * (o.highlightthickness ?? 0)}px`;
    } else if (cls === 'Scale') {
      const vertical = el.classList.contains('vertical');
      const len = o.length || 100;
      if (vertical) { st.height = `${len + 20}px`; } else { st.width = `${len + 4}px`; }
    } else if (cls === 'Progressbar') {
      const len = o.length || 100;
      if (o.orient === 'vertical') { st.width = '14px'; st.height = `${len}px`; } else { st.width = `${len}px`; st.height = '14px'; }
    } else if (cls === 'Scrollbar') {
      if (o.orient === 'horizontal') { st.height = '12px'; st.width = '40px'; } else { st.width = '12px'; st.height = '40px'; }
    } else if (cls === 'Separator') {
      if (o.orient === 'vertical') { st.width = '2px'; st.height = '2px'; } else { st.height = '2px'; st.width = '2px'; }
    } else if (cls === 'Treeview') {
      st.height = `calc(${(o.height || 10)} * 26px + 30px)`;
    }
    if (!st.width) st.width = 'max-content';
    const r = { w: el.offsetWidth, h: el.offsetHeight };
    // innere Abstaende (padx/pady) bei Label/Button
    if ((cls === 'Label' || cls === 'Button' || cls === 'Message') && !node.ttk) {
      // bereits per CSS-Padding enthalten
    }
    st.display = prev;
    return r;
  }

  isContainer(node) {
    return ['Frame', 'LabelFrame', 'Tk', 'Toplevel', 'Notebook', 'PanedWindow'].includes(node.cls);
  }

  // Innenabstaende eines Containers (Rahmen, Beschriftung, Tabs)
  insets(node) {
    const o = node.opts;
    const st = node.ttk ? (node.style || {}) : {};
    let bw = (o.borderwidth ?? st.borderwidth ?? (node.cls === 'LabelFrame' ? 2 : 0)) || 0;
    if (node.cls === 'LabelFrame' && !node.customBorder) bw = 1;
    let pad = o.padding ?? st.padding;
    let pl = 0, pt = 0, pr = 0, pb = 0;
    if (pad != null) {
      const p = Array.isArray(pad) ? pad.map(Number) : String(pad).split(/\s+/).map(Number);
      [pl, pt, pr, pb] = p.length === 1 ? [p[0], p[0], p[0], p[0]] : p.length === 2 ? [p[0], p[1], p[0], p[1]] : p.length === 3 ? [p[0], p[1], p[2], p[1]] : p;
    }
    const padx = (o.padx || 0), pady = (o.pady || 0);
    let top = bw + pt + pady, left = bw + pl + padx, right = bw + pr + padx, bottom = bw + pb + pady;
    if (node.cls === 'LabelFrame') {
      top += node.labelEl && !node.labelEl.hidden ? Math.max(node.labelEl.offsetHeight || 16, 14) - 2 : 4;
      left += 4; right += 4; bottom += 4;
    }
    if (node.cls === 'Notebook') top += node.tabBar.offsetHeight || 30;
    return { left, top, right, bottom };
  }

  computeReq(node) {
    if (!this.isContainer(node)) {
      if (node.reqDirty || !node.req) {
        node.req = this.measureLeaf(node);
        node.reqDirty = false;
      }
      return node.req;
    }
    const ins = this.insets(node);
    const o = node.opts;
    let w = 0, hgt = 0;
    const hasPack = node.packList.length > 0;
    const hasGrid = node.gridList.length > 0;
    if (node.cls === 'Notebook') {
      for (const t of node.tabs) {
        const c = this.nodes.get(t.w);
        if (!c) continue;
        const r = this.computeReq(c);
        w = Math.max(w, r.w);
        hgt = Math.max(hgt, r.h);
      }
      w = Math.max(w, node.tabBar.scrollWidth || 0);
    } else if (node.cls === 'PanedWindow') {
      const horiz = (o.orient || 'horizontal') === 'horizontal';
      for (const c of node.panes) {
        const r = this.computeReq(c);
        if (horiz) { w += r.w + 4; hgt = Math.max(hgt, r.h); } else { hgt += r.h + 4; w = Math.max(w, r.w); }
      }
    } else {
      if (hasPack && node.propagate.pack) {
        const r = this.packReq(node);
        w = Math.max(w, r.w); hgt = Math.max(hgt, r.h);
      }
      if (hasGrid && node.propagate.grid) {
        const r = this.gridReq(node);
        w = Math.max(w, r.w); hgt = Math.max(hgt, r.h);
      }
      // place-Slaves beeinflussen die Groesse nicht; ebensowenig pack ohne propagate
      for (const c of node.placeList) this.computeReq(c);
      if (!node.propagate.pack) for (const c of node.packList) this.computeReq(c);
      if (!node.propagate.grid) for (const c of node.gridList) this.computeReq(c);
    }
    const propagates = (hasPack && node.propagate.pack) || (hasGrid && node.propagate.grid) || node.cls === 'Notebook' || node.cls === 'PanedWindow';
    let rw = w + ins.left + ins.right;
    let rh = hgt + ins.top + ins.bottom;
    if (!propagates || (!hasPack && !hasGrid && node.cls !== 'Notebook' && node.cls !== 'PanedWindow')) {
      rw = o.width > 0 ? o.width : (hasPack || hasGrid ? rw : ins.left + ins.right + (node.cls === 'Tk' || node.cls === 'Toplevel' ? 200 : 1));
      rh = o.height > 0 ? o.height : (hasPack || hasGrid ? rh : ins.top + ins.bottom + (node.cls === 'Tk' || node.cls === 'Toplevel' ? 200 : 1));
      if (node.cls === 'LabelFrame' && node.labelEl && !node.labelEl.hidden) rw = Math.max(rw, (node.labelEl.offsetWidth || 0) + 16);
    }
    node.req = { w: rw, h: rh };
    return node.req;
  }

  packReq(node) {
    let width = 0, height = 0, maxW = 0, maxH = 0;
    for (const c of node.packList) {
      const r = this.computeReq(c);
      const m = c.mopts;
      const px = m.padx[0] + m.padx[1] + 2 * (m.ipadx || 0);
      const py = m.pady[0] + m.pady[1] + 2 * (m.ipady || 0);
      if (m.side === 'top' || m.side === 'bottom') {
        maxW = Math.max(maxW, r.w + px + width);
        height += r.h + py;
      } else {
        maxH = Math.max(maxH, r.h + py + height);
        width += r.w + px;
      }
    }
    return { w: Math.max(maxW, width), h: Math.max(maxH, height) };
  }

  gridInfo(node) {
    const cols = [], rows = [];
    const slaves = node.gridList;
    for (const c of slaves) this.computeReq(c);
    const ensure = (arr, i) => { while (arr.length <= i) arr.push(0); };
    // erst einfache Zellen, dann gespannte
    const sorted = [...slaves].sort((a, b) => (a.mopts.columnspan + a.mopts.rowspan) - (b.mopts.columnspan + b.mopts.rowspan));
    for (const c of sorted) {
      const m = c.mopts;
      const r = c.req;
      const needW = r.w + m.padx[0] + m.padx[1] + 2 * (m.ipadx || 0);
      const needH = r.h + m.pady[0] + m.pady[1] + 2 * (m.ipady || 0);
      ensure(cols, m.column + m.columnspan - 1);
      ensure(rows, m.row + m.rowspan - 1);
      const distribute = (arr, start, span, need, cfg) => {
        let have = 0;
        for (let i = start; i < start + span; i++) have += arr[i];
        if (have >= need) return;
        const extra = need - have;
        if (span === 1) { arr[start] = need; return; }
        let wsum = 0;
        for (let i = start; i < start + span; i++) wsum += (cfg[i]?.weight || 0);
        for (let i = start; i < start + span; i++) {
          const share = wsum ? extra * ((cfg[i]?.weight || 0) / wsum) : extra / span;
          arr[i] += share;
        }
      };
      distribute(cols, m.column, m.columnspan, needW, node.cols);
      distribute(rows, m.row, m.rowspan, needH, node.rows);
    }
    for (const [i, cfg] of Object.entries(node.cols)) { ensure(cols, +i); cols[+i] = Math.max(cols[+i], cfg.minsize || 0) + (cfg.pad || 0); }
    for (const [i, cfg] of Object.entries(node.rows)) { ensure(rows, +i); rows[+i] = Math.max(rows[+i], cfg.minsize || 0) + (cfg.pad || 0); }
    // uniform-Gruppen
    for (const [arr, cfgs] of [[cols, node.cols], [rows, node.rows]]) {
      const groups = {};
      for (const [i, cfg] of Object.entries(cfgs)) if (cfg.uniform) (groups[cfg.uniform] ||= []).push(+i);
      for (const idx of Object.values(groups)) {
        const m = Math.max(...idx.map(i => arr[i] / Math.max(1, cfgs[i].weight || 1)));
        for (const i of idx) arr[i] = m * Math.max(1, cfgs[i].weight || 1);
      }
    }
    return { cols, rows };
  }

  gridReq(node) {
    const { cols, rows } = this.gridInfo(node);
    node._grid = { cols, rows };
    return { w: cols.reduce((a, b) => a + b, 0), h: rows.reduce((a, b) => a + b, 0) };
  }

  arrange(node, W, H) {
    const ins = this.insets(node);
    const ix = ins.left, iy = ins.top;
    const iw = Math.max(0, W - ins.left - ins.right);
    const ih = Math.max(0, H - ins.top - ins.bottom);
    if (node.cls === 'Notebook') {
      for (const t of node.tabs) {
        const c = this.nodes.get(t.w);
        if (!c) continue;
        const on = t.w === node.currentTab;
        c.el.style.display = on ? '' : 'none';
        if (on) this.place(c, 0, 0, iw, ih);
      }
      return;
    }
    if (node.cls === 'PanedWindow') {
      const horiz = (node.opts.orient || 'horizontal') === 'horizontal';
      const total = node.panes.reduce((s, c) => s + (horiz ? c.req.w : c.req.h), 0) || 1;
      const avail = (horiz ? iw : ih) - 4 * Math.max(0, node.panes.length - 1);
      let pos = 0;
      for (const c of node.panes) {
        const size = Math.max(10, avail * ((horiz ? c.req.w : c.req.h) / total));
        if (horiz) this.place(c, ix + pos, iy, size, ih); else this.place(c, ix, iy + pos, iw, size);
        pos += size + 4;
      }
      return;
    }
    if (node.packList.length) this.arrangePack(node, ix, iy, iw, ih);
    if (node.gridList.length) this.arrangeGrid(node, ix, iy, iw, ih);
    for (const c of node.placeList) this.arrangePlace(c, ix, iy, iw, ih, W, H);
  }

  expansion(list, start, cavity, vertical) {
    // tkPack.c: XExpansion / YExpansion
    let minExpand = cavity, numExpand = 0;
    for (let i = start; i < list.length; i++) {
      const c = list[i];
      const m = c.mopts;
      const along = vertical ? (m.side === 'top' || m.side === 'bottom') : (m.side === 'left' || m.side === 'right');
      const size = vertical ? c.req.h + m.pady[0] + m.pady[1] + 2 * (m.ipady || 0) : c.req.w + m.padx[0] + m.padx[1] + 2 * (m.ipadx || 0);
      if (!along) {
        if (numExpand) {
          const cur = (cavity - size) / numExpand;
          if (cur < minExpand) minExpand = cur;
        }
      } else {
        cavity -= size;
        if (m.expand) numExpand++;
      }
    }
    if (numExpand) {
      const cur = cavity / numExpand;
      if (cur < minExpand) minExpand = cur;
    }
    return minExpand < 0 ? 0 : minExpand;
  }

  arrangePack(node, ix, iy, iw, ih) {
    let cx = ix, cy = iy, cw = iw, ch = ih;
    const list = node.packList;
    list.forEach((c, i) => {
      const m = c.mopts;
      const px = m.padx[0] + m.padx[1], py = m.pady[0] + m.pady[1];
      const ipx = 2 * (m.ipadx || 0), ipy = 2 * (m.ipady || 0);
      let fx, fy, fw, fh;
      if (m.side === 'top' || m.side === 'bottom') {
        fw = cw;
        fh = c.req.h + py + ipy;
        if (m.expand) fh += this.expansion(list, i, ch, true);
        ch -= fh;
        if (ch < 0) { fh += ch; ch = 0; }
        fx = cx;
        if (m.side === 'top') { fy = cy; cy += fh; } else fy = cy + ch;
      } else {
        fh = ch;
        fw = c.req.w + px + ipx;
        if (m.expand) fw += this.expansion(list, i, cw, false);
        cw -= fw;
        if (cw < 0) { fw += cw; cw = 0; }
        fy = cy;
        if (m.side === 'left') { fx = cx; cx += fw; } else fx = cx + cw;
      }
      let w = c.req.w + ipx;
      if (m.fill === 'x' || m.fill === 'both' || w > fw - px) w = fw - px;
      let hh = c.req.h + ipy;
      if (m.fill === 'y' || m.fill === 'both' || hh > fh - py) hh = fh - py;
      const a = anc(m.anchor);
      let x = fx + m.padx[0] + (fw - px - w) / 2;
      let y = fy + m.pady[0] + (fh - py - hh) / 2;
      if (a.includes('w')) x = fx + m.padx[0];
      if (a.includes('e')) x = fx + fw - m.padx[1] - w;
      if (a.includes('n')) y = fy + m.pady[0];
      if (a.includes('s')) y = fy + fh - m.pady[1] - hh;
      if (w <= 0 || hh <= 0) { c.el.style.visibility = 'hidden'; this.place(c, x, y, Math.max(0, w), Math.max(0, hh)); }
      else { c.el.style.visibility = ''; this.place(c, x, y, w, hh); }
    });
  }

  arrangeGrid(node, ix, iy, iw, ih) {
    const { cols, rows } = node._grid || this.gridInfo(node);
    const fit = (sizes, cfgs, avail) => {
      const total = sizes.reduce((a, b) => a + b, 0);
      let extra = avail - total;
      const out = [...sizes];
      const weights = sizes.map((_, i) => cfgs[i]?.weight || 0);
      const wsum = weights.reduce((a, b) => a + b, 0);
      if (!wsum) return { sizes: out, offset: 0 };
      if (extra > 0) {
        for (let i = 0; i < out.length; i++) out[i] += extra * (weights[i] / wsum);
      } else if (extra < 0) {
        // gewichtete Spalten bis zur Mindestgroesse schrumpfen
        for (let pass = 0; pass < 4 && extra < -0.5; pass++) {
          const ws = out.reduce((s, v, i) => s + (weights[i] && v > (cfgs[i]?.minsize || 0) ? weights[i] : 0), 0);
          if (!ws) break;
          let used = 0;
          for (let i = 0; i < out.length; i++) {
            if (!weights[i] || out[i] <= (cfgs[i]?.minsize || 0)) continue;
            const take = Math.min(out[i] - (cfgs[i]?.minsize || 0), -extra * (weights[i] / ws));
            out[i] -= take;
            used += take;
          }
          extra += used;
        }
      }
      return { sizes: out, offset: 0 };
    };
    const cs = fit(cols, node.cols, iw).sizes;
    const rs = fit(rows, node.rows, ih).sizes;
    const colX = [ix];
    for (let i = 0; i < cs.length; i++) colX.push(colX[i] + cs[i]);
    const rowY = [iy];
    for (let i = 0; i < rs.length; i++) rowY.push(rowY[i] + rs[i]);
    for (const c of node.gridList) {
      const m = c.mopts;
      const x0 = colX[m.column] ?? ix, x1 = colX[Math.min(cs.length, m.column + m.columnspan)] ?? x0;
      const y0 = rowY[m.row] ?? iy, y1 = rowY[Math.min(rs.length, m.row + m.rowspan)] ?? y0;
      const cellW = x1 - x0 - m.padx[0] - m.padx[1];
      const cellH = y1 - y0 - m.pady[0] - m.pady[1];
      const s = m.sticky || '';
      let w = Math.min(c.req.w + 2 * (m.ipadx || 0), cellW);
      let hh = Math.min(c.req.h + 2 * (m.ipady || 0), cellH);
      if (s.includes('e') && s.includes('w')) w = cellW;
      if (s.includes('n') && s.includes('s')) hh = cellH;
      let x = x0 + m.padx[0] + (cellW - w) / 2;
      let y = y0 + m.pady[0] + (cellH - hh) / 2;
      if (s.includes('w')) x = x0 + m.padx[0];
      else if (s.includes('e')) x = x0 + m.padx[0] + cellW - w;
      if (s.includes('n')) y = y0 + m.pady[0];
      else if (s.includes('s')) y = y0 + m.pady[0] + cellH - hh;
      this.place(c, x, y, Math.max(0, w), Math.max(0, hh));
    }
  }

  arrangePlace(c, ix, iy, iw, ih) {
    const m = c.mopts;
    let w = m.width != null ? m.width : null;
    let hh = m.height != null ? m.height : null;
    if (m.relwidth != null) w = (w || 0) + m.relwidth * iw;
    if (m.relheight != null) hh = (hh || 0) + m.relheight * ih;
    if (w == null) w = c.req.w;
    if (hh == null) hh = c.req.h;
    let x = ix + (m.x || 0) + (m.relx || 0) * iw;
    let y = iy + (m.y || 0) + (m.rely || 0) * ih;
    const a = anc(m.anchor || 'nw');
    if (a === '' || a === 'n' || a === 's') x -= w / 2;
    if (a.includes('e')) x -= w;
    if (a === '' || a === 'w' || a === 'e') y -= hh / 2;
    if (a.includes('s')) y -= hh;
    this.place(c, x, y, w, hh);
  }

  place(c, x, y, w, hh) {
    const st = c.el.style;
    const L = `${Math.round(x)}px`, T = `${Math.round(y)}px`, Wd = `${Math.round(w)}px`, Ht = `${Math.round(hh)}px`;
    if (st.left !== L) st.left = L;
    if (st.top !== T) st.top = T;
    if (st.width !== Wd) st.width = Wd;
    if (st.height !== Ht) st.height = Ht;
    c.geom = [x, y, w, hh];
    if (this.isContainer(c)) this.arrange(c, w, hh);
    if (c.cls === 'Canvas') this.layoutCanvasWindows(c);
  }

  layoutTkWindow(win, changed) {
    const root = this.nodes.get(win.id);
    if (!root) return;
    if (win.withdrawn && this.active !== win.id) { /* trotzdem messen, aber unsichtbar */ }
    const frameHidden = win.frame.hidden;
    if (frameHidden) win.frame.hidden = false;
    win.frame.style.visibility = frameHidden ? 'hidden' : '';
    win.frame.style.position = frameHidden ? 'absolute' : '';
    // Mess-Pass
    for (const n of this.nodes.values()) if (n.reqDirty && !this.isContainer(n)) { /* wird in computeReq gemessen */ }
    const req = this.computeReq(root);
    let W = req.w, H = req.h;
    if (win.geometry) { W = win.geometry[0]; H = win.geometry[1]; }
    if (win.minsize) { W = Math.max(W, win.minsize[0]); H = Math.max(H, win.minsize[1]); }
    const avail = this.stageSize();
    if (win.zoomed) { W = avail.w; H = Math.max(H, avail.h - 40); }
    W = Math.max(1, Math.round(W));
    H = Math.max(1, Math.round(H));
    win.w = W; win.h = H;
    root.geom = [0, 0, W, H];
    root.el.style.width = `${W}px`;
    root.el.style.height = `${H}px`;
    this.arrange(root, W, H);
    this.applyScale(win, W, H);
    // Geometrie fuer Python
    const visit = (n, ox, oy) => {
      const g = n.geom || [0, 0, 0, 0];
      const rx = ox + g[0], ry = oy + g[1];
      const req = n.req || { w: g[2], h: g[3] };
      const val = [g[0], g[1], g[2], g[3], rx, ry, req.w, req.h].map(v => Math.round(v));
      const old = this.geom[n.wid];
      if (!old || old.some((v, i) => v !== val[i])) changed[n.wid] = val;
      this.geom[n.wid] = val;
      for (const c of n.children) if (c.geom && c.el.style.display !== 'none') visit(c, rx, ry);
    };
    visit(root, 0, 0);
    if (frameHidden) { win.frame.hidden = true; win.frame.style.visibility = ''; win.frame.style.position = ''; }
  }

  stageSize() {
    const r = this.stage.getBoundingClientRect();
    return { w: Math.max(200, (r.width || window.innerWidth) - 24), h: Math.max(200, (r.height || window.innerHeight) - 60) };
  }

  applyScale(win, W, H) {
    const avail = this.stageSize();
    let s = 1;
    if (this.zoomFit) {
      s = Math.min(avail.w / W, 1.6);
      if (s > 1) s = Math.min(s, Math.max(1, (avail.h - 40) / H));
    }
    win.scale = s;
    win.content.style.transform = s === 1 ? '' : `scale(${s})`;
    win.scaler.style.width = `${W * s}px`;
    win.scaler.style.height = `${H * s}px`;
    win.frame.style.width = `${W * s}px`;
  }

  // -------------------------------------------------------------- Listbox
  renderListbox(wid, items, sel, itemcfg) {
    const node = this.nodes.get(wid);
    if (!node) return;
    node.sel = sel || [];
    const el = node.listEl;
    el.textContent = '';
    items.forEach((t, i) => {
      const it = h('div', { class: 'lb-item', dataset: { i: String(i) }, text: t === '' ? ' ' : t });
      const cfg = itemcfg?.[String(i)];
      if (cfg) {
        if (cfg.background) it.style.background = tkColor(cfg.background);
        if (cfg.foreground) it.style.color = tkColor(cfg.foreground);
      }
      el.append(it);
    });
    this.highlightListbox(node);
  }

  highlightListbox(node) {
    const sel = new Set(node.sel || []);
    for (const it of node.listEl?.children || []) it.classList.toggle('sel', sel.has(+it.dataset.i));
    if (node.opts.selectbackground) node.el.style.setProperty('--lb-sel', tkColor(node.opts.selectbackground));
  }

  // ----------------------------------------------------------------- Text
  renderText(wid, text, segs) {
    const node = this.nodes.get(wid);
    if (!node) return;
    const editable = node.opts.state !== 'disabled';
    if (!segs) {
      node.inputEl.hidden = false;
      node.richEl.hidden = true;
      if (node.inputEl.value !== text) node.inputEl.value = text;
      return;
    }
    node.inputEl.hidden = true;
    node.richEl.hidden = false;
    node.richEl.contentEditable = editable ? 'true' : 'false';
    node.richEl.style.font = node.inputEl.style.font;
    node.richEl.style.background = node.inputEl.style.background;
    node.richEl.style.color = node.inputEl.style.color;
    node.richEl.style.whiteSpace = node.inputEl.style.whiteSpace;
    const tags = this.textTags.get(wid) || {};
    node.richEl.textContent = '';
    for (const [t, names] of segs) {
      if (!names.length) { node.richEl.append(document.createTextNode(t)); continue; }
      const span = document.createElement('span');
      span.textContent = t;
      for (const n of names) {
        const c = tags[n];
        if (!c) continue;
        if (c.foreground) span.style.color = tkColor(c.foreground);
        if (c.background) span.style.background = tkColor(c.background);
        if (c.font) applyFont(span, c.font);
        if (c.underline) span.style.textDecoration = 'underline';
        if (c.overstrike) span.style.textDecoration = 'line-through';
        if (c.justify) span.style.display = 'block', span.style.textAlign = c.justify;
      }
      node.richEl.append(span);
    }
  }

  see(wid, where) {
    const node = this.nodes.get(wid);
    if (!node) return;
    requestAnimationFrame(() => {
      const el = node.cls === 'Text' ? (node.richEl.hidden ? node.inputEl : node.richEl) : node.listEl;
      if (!el) return;
      if (where === 'end' || node.cls === 'Text') el.scrollTop = el.scrollHeight;
      else if (node.listEl) node.listEl.children[where]?.scrollIntoView({ block: 'nearest' });
    });
  }

  // ------------------------------------------------------------- Notebook
  renderNotebook(wid, tabs, current) {
    const node = this.nodes.get(wid);
    if (!node) return;
    node.tabs = tabs;
    node.currentTab = current;
    node.tabBar.textContent = '';
    tabs.forEach((t, i) => {
      if (t.state === 'hidden') return;
      const b = h('button', { class: `nb-tab${t.w === current ? ' on' : ''}`, type: 'button', text: t.text || `Tab ${i + 1}` });
      if (t.state === 'disabled') b.disabled = true;
      b.addEventListener('click', () => this.sendEvent({ k: 'tab', w: wid, i }));
      node.tabBar.append(b);
      const child = this.nodes.get(t.w);
      if (child) {
        child.manager = 'notebook';
        if (child.el.parentElement !== node.host) node.host.append(child.el);
        child.el.style.display = t.w === current ? '' : 'none';
      }
    });
    this.dirty(node);
  }

  // ------------------------------------------------------------- Treeview
  renderTree(wid, data) {
    const node = this.nodes.get(wid);
    if (!node) return;
    node.treeData = data;
    const el = node.tableEl;
    el.textContent = '';
    const showTree = String(data.show).includes('tree');
    const showHead = String(data.show).includes('headings');
    let cols = data.columns;
    if (Array.isArray(data.display)) cols = data.display;
    const table = h('table');
    if (showHead) {
      const tr = h('tr');
      if (showTree) {
        const th = h('th', { text: data.headings['#0']?.text || '' });
        th.addEventListener('click', () => this.sendEvent({ k: 'head', w: wid, col: '#0' }));
        tr.append(th);
      }
      for (const c of cols) {
        const th = h('th', { text: data.headings[c]?.text ?? c });
        const w = data.colopts[c]?.width;
        if (w) th.style.width = `${w}px`;
        th.addEventListener('click', () => this.sendEvent({ k: 'head', w: wid, col: c }));
        tr.append(th);
      }
      table.append(h('thead', {}, tr));
    }
    const body = h('tbody');
    const sel = new Set(data.sel);
    const colIndex = Object.fromEntries(data.columns.map((c, i) => [c, i]));
    const addRows = (rows, depth) => {
      for (const r of rows) {
        const tr = h('tr', { dataset: { iid: r.id }, class: sel.has(r.id) ? 'sel' : '' });
        for (const t of r.tags || []) {
          const tc = data.tags[t];
          if (tc?.background) tr.style.background = tkColor(tc.background);
          if (tc?.foreground) tr.style.color = tkColor(tc.foreground);
        }
        if (showTree) {
          const td = h('td', { class: 'tree-cell' });
          td.style.paddingLeft = `${6 + depth * 16}px`;
          if (r.children.length) {
            const tog = h('span', { class: 'tree-toggle', text: r.open ? '▾' : '▸' });
            tog.addEventListener('click', (e) => {
              e.stopPropagation();
              r.open = !r.open;
              this.sendEvent({ k: 'topen', w: wid, id: r.id, open: r.open });
              this.renderTree(wid, data);
            });
            td.append(tog);
          }
          td.append(document.createTextNode(r.text));
          tr.append(td);
        }
        for (const c of cols) {
          const td = h('td', { text: r.values[colIndex[c]] ?? '' });
          const anchor = data.colopts[c]?.anchor;
          if (anchor) td.style.textAlign = anchor === 'center' ? 'center' : anchor.includes('e') ? 'right' : 'left';
          tr.append(td);
        }
        tr.addEventListener('click', (e) => {
          let s;
          if ((data.selectmode === 'extended' && (e.metaKey || e.ctrlKey)) || node.opts.selectmode === 'multiple') {
            s = sel.has(r.id) ? [...sel].filter(x => x !== r.id) : [...sel, r.id];
          } else s = [r.id];
          data.sel = s;
          this.sendEvent({ k: 'tsel', w: wid, sel: s });
          this.renderTree(wid, data);
        });
        tr.addEventListener('dblclick', () => this.sendWidgetEvent(node, 'down', { num: 1, dbl: true, row: r.id }));
        body.append(tr);
        if (r.open && r.children.length) addRows(r.children, depth + 1);
      }
    };
    addRows(data.rows, 0);
    table.append(body);
    el.append(table);
  }

  // --------------------------------------------------------------- Menues
  refreshMenubars() {
    for (const win of this.windows.values()) {
      if (win.kind !== 'tk') continue;
      const node = this.nodes.get(win.id);
      const menuId = node?.opts.menu;
      const entries = menuId ? this.menus.get(menuId) : null;
      win.menubar.textContent = '';
      win.menubar.hidden = !entries || !entries.length;
      if (!entries) continue;
      entries.forEach((e, i) => {
        if (e.type === 'separator') return;
        const b = h('button', { class: 'mb-item', type: 'button', text: String(e.label || '').replace(/&/g, '') });
        if (e.state === 'disabled') b.disabled = true;
        b.addEventListener('click', () => {
          if (e.type === 'cascade' && e.menu) this.popupTkMenu(e.menu, null, null, b);
          else this.sendEvent({ k: 'menu', w: menuId, i });
        });
        win.menubar.append(b);
      });
    }
  }

  popupTkMenu(menuId, x, y, anchorEl) {
    const entries = this.menus.get(menuId) || [];
    const items = entries.map((e, i) => ({ ...e, i }));
    this.showPopup(items.map(e => {
      if (e.type === 'separator') return { sep: true };
      const label = String(e.label || '').replace(/&/g, '');
      return {
        label, disabled: e.state === 'disabled', checked: e.type === 'checkbutton' || e.type === 'radiobutton' ? !!e.on : undefined,
        accel: e.accelerator, sub: e.type === 'cascade' ? e.menu : null, value: e.i,
      };
    }), anchorEl, x, y).then(v => {
      if (v == null) return;
      const e = entries[v];
      if (e?.type === 'cascade' && e.menu) this.popupTkMenu(e.menu, x, y, anchorEl);
      else this.sendEvent({ k: 'menu', w: menuId, i: v });
    });
  }

  showPopup(items, anchorEl, x, y) {
    return new Promise((resolve) => {
      const back = h('div', { class: 'popup-backdrop' });
      const box = h('div', { class: 'popup-menu', role: 'menu' });
      for (const it of items) {
        if (it.sep) { box.append(h('div', { class: 'popup-sep' })); continue; }
        const b = h('button', { class: 'popup-item', type: 'button', disabled: it.disabled || null });
        b.append(h('span', { class: 'popup-check', text: it.checked ? '✓' : '' }), h('span', { class: 'popup-label', text: it.label }));
        if (it.accel) b.append(h('span', { class: 'popup-accel', text: it.accel }));
        if (it.sub) b.append(h('span', { class: 'popup-accel', text: '▸' }));
        b.addEventListener('click', () => { close(); resolve(it.value); });
        box.append(b);
      }
      const close = () => back.remove();
      back.addEventListener('click', (e) => { if (e.target === back) { close(); resolve(null); } });
      back.append(box);
      document.body.append(back);
      const r = anchorEl?.getBoundingClientRect();
      let left = r ? r.left : (x ?? 40);
      let top = r ? r.bottom + 4 : (y ?? 80);
      const bw = box.offsetWidth, bh = box.offsetHeight;
      left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - bh - 8));
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
    });
  }

  async popupMenu(payload) {
    const conv = (items) => items.map(a => a.sep ? { sep: true } : { label: a.text, disabled: !a.enabled, checked: a.checkable ? a.checked : undefined, accel: a.shortcut, value: a.id, subItems: a.sub });
    let items = conv(payload.items || []);
    while (true) {
      const v = await this.showPopup(items, null, payload.x, payload.y);
      if (v == null) return null;
      const it = items.find(i => i.value === v);
      if (it?.subItems) { items = conv(it.subItems); continue; }
      return v;
    }
  }

  // --------------------------------------------------------------- Bilder
  addImage(name, mime, b64, w, hgt) {
    const url = `data:${mime === 'image/x-portable-pixmap' ? 'image/png' : mime};base64,${b64}`;
    this.images.set(name, { url, w, h: hgt });
    this.refreshImageUsers(name);
  }

  addRgbaImage(name, b64, w, hgt) {
    const bin = atob(b64);
    const arr = new Uint8ClampedArray(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = hgt;
    if (w && hgt) cv.getContext('2d').putImageData(new ImageData(arr, w, hgt), 0, 0);
    this.images.set(name, { url: cv.toDataURL(), w, h: hgt, canvas: cv });
    this.refreshImageUsers(name);
  }

  addScaledImage(name, src, w, hgt) {
    const s = this.images.get(src);
    if (!s) return;
    this.images.set(name, { url: s.url, w, h: hgt });
    this.refreshImageUsers(name);
  }

  refreshImageUsers(name) {
    for (const n of this.nodes.values()) {
      if (n.opts.image === name && n.textEl) {
        this.setLabelContent(n, String(n.opts.text ?? ''));
        n.reqDirty = true;
      }
      if (n.cls === 'Canvas') {
        for (const [id, it] of n.items) if (it.type === 'image' && it.opts.image === name) this.cvRender(n, id);
      }
    }
    this.scheduleLayout();
  }

  async imagePixels(name) {
    const img = this.images.get(name);
    if (!img) return null;
    let cv = img.canvas;
    if (!cv) {
      const im = new Image();
      im.src = img.url;
      await im.decode().catch(() => {});
      cv = document.createElement('canvas');
      cv.width = img.w; cv.height = img.h;
      cv.getContext('2d').drawImage(im, 0, 0, img.w, img.h);
    }
    const data = cv.getContext('2d').getImageData(0, 0, img.w, img.h).data;
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < data.length; i += chunk) s += String.fromCharCode.apply(null, data.subarray(i, i + chunk));
    return btoa(s);
  }

  // =============================================================== Canvas
  cvNew(wid, id, type, coords, opts, tags) {
    const node = this.nodes.get(wid);
    if (!node) return;
    const it = { type, coords, opts: opts || {}, tags: tags || [], el: null };
    node.items.set(id, it);
    node.itemOrder.push(id);
    this.cvRender(node, id);
  }

  cvRender(node, id) {
    const it = node.items.get(id);
    if (!it) return;
    const o = it.opts;
    const c = it.coords;
    let el = it.el;
    const make = (tag) => {
      const e = document.createElementNS(SVGNS, tag);
      e.dataset.item = String(id);
      return e;
    };
    const fillC = (v, def) => (v === undefined ? def : (v === '' || v == null ? 'none' : (tkColor(v) || 'none')));
    const width = o.width != null && it.type !== 'text' ? Number(o.width) : 1;
    const dash = this.dashArray(o.dash, width);
    switch (it.type) {
      case 'line': {
        if (!el || el.tagName !== 'g') { el = make('g'); }
        el.textContent = '';
        const path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('d', this.linePath(c, !!o.smooth && o.smooth !== '0' && o.smooth !== 'false', false));
        path.setAttribute('fill', 'none');
        const stroke = fillC(o.fill, '#000');
        path.setAttribute('stroke', stroke);
        path.setAttribute('stroke-width', String(Math.max(width, 0.5)));
        path.setAttribute('stroke-linecap', { butt: 'butt', projecting: 'square', round: 'round' }[o.capstyle] || 'butt');
        path.setAttribute('stroke-linejoin', { round: 'round', bevel: 'bevel', miter: 'miter' }[o.joinstyle] || 'round');
        if (dash) path.setAttribute('stroke-dasharray', dash);
        el.append(path);
        if (o.arrow && o.arrow !== 'none' && c.length >= 4) {
          const shape = Array.isArray(o.arrowshape) ? o.arrowshape.map(Number) : [8, 10, 3];
          const heads = [];
          if (o.arrow === 'last' || o.arrow === 'both') heads.push([c[c.length - 4], c[c.length - 3], c[c.length - 2], c[c.length - 1]]);
          if (o.arrow === 'first' || o.arrow === 'both') heads.push([c[2], c[3], c[0], c[1]]);
          for (const [x1, y1, x2, y2] of heads) {
            const ang = Math.atan2(y2 - y1, x2 - x1);
            const [d1, d2, d3] = shape;
            const bx = x2 - d2 * Math.cos(ang), by = y2 - d2 * Math.sin(ang);
            const sx = x2 - d1 * Math.cos(ang), sy = y2 - d1 * Math.sin(ang);
            const px = -Math.sin(ang) * (d3 + width / 2), py = Math.cos(ang) * (d3 + width / 2);
            const poly = document.createElementNS(SVGNS, 'polygon');
            poly.setAttribute('points', `${x2},${y2} ${bx + px},${by + py} ${sx},${sy} ${bx - px},${by - py}`);
            poly.setAttribute('fill', stroke);
            el.append(poly);
          }
        }
        break;
      }
      case 'rectangle': case 'oval': {
        const tag = it.type === 'rectangle' ? 'rect' : 'ellipse';
        if (!el || el.tagName !== tag) el = make(tag);
        const [x1, y1, x2, y2] = c.length >= 4 ? c : [0, 0, 0, 0];
        const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), hh = Math.abs(y2 - y1);
        if (tag === 'rect') {
          el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('width', w); el.setAttribute('height', hh);
        } else {
          el.setAttribute('cx', x + w / 2); el.setAttribute('cy', y + hh / 2); el.setAttribute('rx', w / 2); el.setAttribute('ry', hh / 2);
        }
        el.setAttribute('fill', fillC(o.fill, 'none'));
        const outline = fillC(o.outline, '#000');
        el.setAttribute('stroke', width > 0 ? outline : 'none');
        el.setAttribute('stroke-width', String(width));
        if (dash) el.setAttribute('stroke-dasharray', dash); else el.removeAttribute('stroke-dasharray');
        break;
      }
      case 'polygon': {
        if (!el || el.tagName !== 'path') el = make('path');
        el.setAttribute('d', this.linePath(c, !!o.smooth && o.smooth !== '0', true));
        el.setAttribute('fill', fillC(o.fill, '#000'));
        el.setAttribute('fill-rule', 'evenodd');
        const outline = fillC(o.outline, 'none');
        el.setAttribute('stroke', outline);
        el.setAttribute('stroke-width', String(o.width != null ? width : 1));
        el.setAttribute('stroke-linejoin', 'round');
        if (dash) el.setAttribute('stroke-dasharray', dash);
        break;
      }
      case 'arc': {
        if (!el || el.tagName !== 'path') el = make('path');
        const [x1, y1, x2, y2] = c;
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
        const start = (o.start ?? 0) * Math.PI / 180;
        const extent = (o.extent ?? 90) * Math.PI / 180;
        const end = start + extent;
        const p = (a) => [cx + rx * Math.cos(a), cy - ry * Math.sin(a)];
        const [sx, sy] = p(start);
        const [ex, ey] = p(end);
        const large = Math.abs(extent) > Math.PI ? 1 : 0;
        const sweep = extent > 0 ? 0 : 1;
        const style = o.style || 'pieslice';
        let d;
        if (Math.abs(extent) >= 2 * Math.PI - 1e-6) {
          d = `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
        } else {
          d = `M ${sx} ${sy} A ${rx} ${ry} 0 ${large} ${sweep} ${ex} ${ey}`;
          if (style === 'pieslice') d += ` L ${cx} ${cy} Z`;
          else if (style === 'chord') d += ' Z';
        }
        el.setAttribute('d', d);
        el.setAttribute('fill', style === 'arc' ? 'none' : fillC(o.fill, 'none'));
        el.setAttribute('stroke', fillC(o.outline, '#000'));
        el.setAttribute('stroke-width', String(width));
        break;
      }
      case 'text': {
        if (!el || el.tagName !== 'text') el = make('text');
        el.textContent = '';
        const font = tkFontCss(o.font || null);
        el.setAttribute('style', `font:${font}`);
        el.setAttribute('fill', fillC(o.fill, '#000'));
        const a = anc(o.anchor);
        const lines = String(o.text ?? '').split('\n');
        const px = parseFloat(/(\d+(\.\d+)?)px/.exec(font)?.[1] || '13');
        const lh = px * 1.2;
        const ta = a.includes('w') ? 'start' : a.includes('e') ? 'end' : 'middle';
        el.setAttribute('text-anchor', o.justify === 'center' && lines.length > 1 ? 'middle' : ta);
        const total = lh * lines.length;
        let y0 = c[1] - total / 2 + px * 0.8;
        if (a.includes('n')) y0 = c[1] + px * 0.85;
        if (a.includes('s')) y0 = c[1] - total + px * 0.85;
        lines.forEach((ln, i) => {
          const ts = document.createElementNS(SVGNS, 'tspan');
          ts.setAttribute('x', c[0]);
          ts.setAttribute('y', y0 + i * lh);
          ts.textContent = ln || ' ';
          el.append(ts);
        });
        el.setAttribute('xml:space', 'preserve');
        if (o.angle) el.setAttribute('transform', `rotate(${-o.angle} ${c[0]} ${c[1]})`);
        break;
      }
      case 'image': {
        if (!el || el.tagName !== 'image') el = make('image');
        const img = this.images.get(o.image);
        if (img) {
          const a = anc(o.anchor);
          let x = c[0] - img.w / 2, y = c[1] - img.h / 2;
          if (a.includes('w')) x = c[0];
          if (a.includes('e')) x = c[0] - img.w;
          if (a.includes('n')) y = c[1];
          if (a.includes('s')) y = c[1] - img.h;
          el.setAttribute('href', img.url);
          el.setAttribute('x', x); el.setAttribute('y', y);
          el.setAttribute('width', img.w); el.setAttribute('height', img.h);
          el.setAttribute('preserveAspectRatio', 'none');
        }
        break;
      }
      case 'window': {
        it.windowId = o.window;
        if (!el) el = make('g');
        this.layoutCanvasWindows(node);
        break;
      }
      default:
        if (!el) el = make('g');
    }
    el.style.display = o.state === 'hidden' ? 'none' : '';
    if (!it.el) node.svg.append(el);
    else if (it.el !== el) it.el.replaceWith(el);
    it.el = el;
  }

  dashArray(dash, width) {
    if (dash == null || dash === '' || (Array.isArray(dash) && !dash.length)) return null;
    if (Array.isArray(dash)) return dash.join(' ');
    if (typeof dash === 'number') return `${dash} ${dash}`;
    const map = { '.': [2, 4], '-': [6, 4], '-.': [6, 4, 2, 4], '-..': [6, 4, 2, 4, 2, 4], ',': [4, 4], '_': [8, 4] };
    const s = String(dash).trim();
    if (map[s]) return map[s].map(v => v * Math.max(1, width / 2)).join(' ');
    if (/^[\d\s]+$/.test(s)) return s;
    return '4 4';
  }

  linePath(c, smooth, closed) {
    if (c.length < 4) return '';
    const pts = [];
    for (let i = 0; i + 1 < c.length; i += 2) pts.push([c[i], c[i + 1]]);
    if (!smooth || pts.length < 3) {
      return 'M ' + pts.map(p => p.join(' ')).join(' L ') + (closed ? ' Z' : '');
    }
    // quadratische B-Spline wie Tk (durch Mittelpunkte)
    if (closed) {
      const n = pts.length;
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let d = `M ${mid(pts[n - 1], pts[0]).join(' ')}`;
      for (let i = 0; i < n; i++) d += ` Q ${pts[i].join(' ')} ${mid(pts[i], pts[(i + 1) % n]).join(' ')}`;
      return d + ' Z';
    }
    let d = `M ${pts[0].join(' ')}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const m = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
      d += i === pts.length - 2 ? ` Q ${pts[i].join(' ')} ${pts[i + 1].join(' ')}` : ` Q ${pts[i].join(' ')} ${m.join(' ')}`;
    }
    return d;
  }

  cvCoords(wid, id, coords) {
    const node = this.nodes.get(wid);
    const it = node?.items.get(id);
    if (!it) return;
    it.coords = coords;
    this.cvRender(node, id);
  }

  cvMove(wid, ids, dx, dy) {
    const node = this.nodes.get(wid);
    if (!node) return;
    for (const id of ids) {
      const it = node.items.get(id);
      if (!it) continue;
      it.coords = it.coords.map((v, i) => v + (i % 2 === 0 ? dx : dy));
      if (it.type === 'window') { this.layoutCanvasWindows(node); continue; }
      // schneller Weg fuer einfache Formen
      const el = it.el;
      if (el && (it.type === 'rectangle' || it.type === 'oval' || it.type === 'image')) {
        if (it.type === 'rectangle' || it.type === 'image') {
          el.setAttribute('x', parseFloat(el.getAttribute('x')) + dx);
          el.setAttribute('y', parseFloat(el.getAttribute('y')) + dy);
        } else {
          el.setAttribute('cx', parseFloat(el.getAttribute('cx')) + dx);
          el.setAttribute('cy', parseFloat(el.getAttribute('cy')) + dy);
        }
      } else this.cvRender(node, id);
    }
  }

  cvDelete(wid, ids) {
    const node = this.nodes.get(wid);
    if (!node) return;
    for (const id of ids) {
      const it = node.items.get(id);
      if (!it) continue;
      it.el?.remove();
      if (it.type === 'window') {
        const child = this.nodes.get(it.windowId);
        if (child) child.el.style.display = 'none';
      }
      node.items.delete(id);
    }
    node.itemOrder = node.itemOrder.filter(i => node.items.has(i));
  }

  cvConfig(wid, ids, opts, tags) {
    const node = this.nodes.get(wid);
    if (!node) return;
    for (const id of ids) {
      const it = node.items.get(id);
      if (!it) continue;
      Object.assign(it.opts, opts);
      if (tags) it.tags = tags;
      this.cvRender(node, id);
    }
  }

  cvOrder(wid, order) {
    const node = this.nodes.get(wid);
    if (!node) return;
    node.itemOrder = order;
    for (const id of order) {
      const it = node.items.get(id);
      if (it?.el) node.svg.append(it.el);
    }
  }

  layoutCanvasWindows(node) {
    const svgW = node.geom ? node.geom[2] : (node.opts.width ?? 378);
    const svgH = node.geom ? node.geom[3] : (node.opts.height ?? 265);
    node.svg.setAttribute('width', svgW);
    node.svg.setAttribute('height', svgH);
    node.svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
    for (const it of node.items.values()) {
      if (it.type !== 'window') continue;
      const child = this.nodes.get(it.opts.window);
      if (!child) continue;
      if (child.el.parentElement !== node.host) node.host.append(child.el);
      const r = this.computeReq(child);
      const w = it.opts.width || r.w, hh = it.opts.height || r.h;
      const a = anc(it.opts.anchor);
      let x = it.coords[0] - w / 2, y = it.coords[1] - hh / 2;
      if (a.includes('w')) x = it.coords[0];
      if (a.includes('e')) x = it.coords[0] - w;
      if (a.includes('n')) y = it.coords[1];
      if (a.includes('s')) y = it.coords[1] - hh;
      child.el.style.display = it.opts.state === 'hidden' ? 'none' : '';
      this.place(child, x, y, w, hh);
    }
  }

  // ========================================================= Zeiger/Tasten
  wantsType(wid, type) {
    const node = this.nodes.get(wid);
    const tags = [wid];
    if (node) {
      tags.push(`class:${node.cls}`);
      const top = this.topOf(node);
      if (top && top.wid !== wid) tags.push(top.wid);
    }
    tags.push('all');
    for (const t of tags) {
      const s = this.bindTypes.get(t);
      if (s && s.has(type)) return true;
    }
    return false;
  }

  topOf(node) {
    let n = node;
    while (n && n.parent) n = n.parent;
    return n;
  }

  refreshPointerStyle() {
    for (const n of this.nodes.values()) {
      if (n.cls !== 'Canvas' && n.cls !== 'Frame' && n.cls !== 'Label' && !this.windows.has(n.wid)) continue;
      const drag = this.wantsType(n.wid, 'drag') || this.wantsType(n.wid, 'move') || (n.itemTypes && (n.itemTypes.has('drag') || n.itemTypes.has('move')));
      n.el.classList.toggle('no-scroll', !!drag);
    }
  }

  localXY(node, e) {
    const win = this.windowOf(node);
    const s = win?.scale || 1;
    const r = node.el.getBoundingClientRect();
    const wr = win?.content.getBoundingClientRect() || r;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s, X: (e.clientX - wr.left) / s, Y: (e.clientY - wr.top) / s };
  }

  sendWidgetEvent(node, t, extra) {
    const typeKey = t === 'down' && extra.dbl ? 'dbl' : t;
    const want = this.wantsType(node.wid, typeKey) || (t === 'down' && this.wantsType(node.wid, 'down'));
    if (!want && t !== 'focus') return;
    this.sendEvent({ k: 'ev', w: node.wid, t, ...extra });
  }

  attachPointer(content) {
    let pressed = null;
    let lastDown = { t: 0, x: 0, y: 0, wid: null };
    const findNode = (target) => {
      const el = target.closest?.('[data-wid]');
      return el ? (this.nodes.get(el.dataset.wid) || null) : null;
    };
    const itemOf = (target, node) => {
      if (!node || node.cls !== 'Canvas') return null;
      const it = target.closest?.('[data-item]');
      return it ? +it.dataset.item : null;
    };
    const base = (node, e, extra = {}) => {
      const p = this.localXY(node, e);
      const state = [];
      if (e.shiftKey) state.push('Shift');
      if (e.ctrlKey) state.push('Control');
      if (e.altKey) state.push('Alt');
      if (e.metaKey) state.push('Meta');
      return { ...p, state, ...extra };
    };
    const send = (node, t, e, extra = {}) => {
      if (!node) return;
      const item = itemOf(e.target, node);
      const itemWants = item != null && node.itemTypes && (node.itemTypes.has(t) || (t === 'move' && node.itemTypes.has('drag')) || (t === 'down' && extra.dbl && node.itemTypes.has('dbl')));
      const typeKey = t === 'move' && pressed ? 'drag' : t;
      const wants = this.wantsType(node.wid, t) || this.wantsType(node.wid, typeKey) || (extra.dbl && this.wantsType(node.wid, 'dbl'));
      if (!wants && !itemWants) return;
      const ev = { k: 'ev', w: node.wid, t, ...base(node, e, extra) };
      if (item != null) ev.item = item;
      if (pressed && t === 'move') ev.state.push('B1');
      this.sendEvent(ev);
    };
    content.addEventListener('pointerdown', (e) => {
      const node = findNode(e.target);
      if (!node) return;
      const isField = e.target.closest('input, textarea, select, [contenteditable="true"]');
      pressed = node;
      if (!isField && node.el.classList.contains('no-scroll')) {
        try { node.el.setPointerCapture(e.pointerId); } catch (er) { /* egal */ }
      }
      const now = performance.now();
      const dbl = now - lastDown.t < 350 && lastDown.wid === node.wid && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 20;
      lastDown = { t: now, x: e.clientX, y: e.clientY, wid: node.wid };
      const num = e.button === 2 ? 3 : e.button === 1 ? 2 : 1;
      send(node, 'down', e, { num, dbl });
      if (num === 3 || (e.pointerType === 'mouse' && e.button === 2)) send(node, 'down', e, { num: 3 });
    });
    content.addEventListener('pointermove', (e) => {
      const node = pressed || findNode(e.target);
      if (!node) return;
      send(node, 'move', e);
    });
    const up = (e) => {
      const node = pressed || findNode(e.target);
      pressed = null;
      if (!node) return;
      send(node, 'up', e, { num: e.button === 2 ? 3 : 1 });
    };
    content.addEventListener('pointerup', up);
    content.addEventListener('pointercancel', up);
    content.addEventListener('contextmenu', (e) => {
      const node = findNode(e.target);
      if (node && this.wantsType(node.wid, 'down')) e.preventDefault();
    });
    content.addEventListener('pointerover', (e) => {
      const node = findNode(e.target);
      if (node && e.pointerType === 'mouse') send(node, 'enter', e);
    });
    content.addEventListener('pointerout', (e) => {
      const node = findNode(e.target);
      if (node && e.pointerType === 'mouse') send(node, 'leave', e);
    });
    content.addEventListener('wheel', (e) => {
      const node = findNode(e.target);
      if (node && this.wantsType(node.wid, 'wheel')) {
        e.preventDefault();
        this.sendEvent({ k: 'ev', w: node.wid, t: 'wheel', delta: -Math.sign(e.deltaY) * 120, ...base(node, e) });
      }
    }, { passive: false });
  }

  inputKey(node, e, t) {
    const info = keyInfo(e);
    if (this.wantsType(node.wid, t)) this.sendEvent({ k: 'ev', w: node.wid, t, ...info });
  }

  focusWidget(wid) {
    const n = this.nodes.get(wid);
    if (n?.inputEl && n.inputEl.focus) { this.focusedWid = wid; return; }
    const q = this.qnodes.get(wid);
    if (q?.inputEl) { q.inputEl.focus?.(); return; }
    if (n) this.focusedWid = wid;
  }

  // Tasten ohne Eingabefeld (Hardware-Tastatur, Tastenfeld, Tastatur-Knopf)
  onDocKey(e, t) {
    if (!this.visible) return;
    if (e.target && e.target !== this.keyCatcher && e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (e.target === this.keyCatcher) return;
    if (document.querySelector('.modal-backdrop')) return;
    this.routeKey(e, t);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  }

  routeKey(e, t) {
    const info = keyInfo(e);
    this.deliverKey(info, t);
  }

  routeKeysym(sym, t) {
    const chars = { space: ' ', Return: '\r', Escape: '\x1b' };
    this.deliverKey({ keysym: sym, char: chars[sym] || '', keycode: KEYCODES[sym] || 0, state: [] }, t);
  }

  deliverKey(info, t) {
    const win = this.windows.get(this.active);
    if (!win) return;
    if (win.kind === 'qt') {
      const target = this.qtKeyTarget(win);
      if (target) this.sendEvent({ k: 'qt', w: target, e: 'key', t: t === 'key' ? 'press' : 'release', keysym: info.keysym, char: info.char, mods: info.state });
      return;
    }
    let wid = this.focusedWid && this.nodes.has(this.focusedWid) && this.windowOf(this.nodes.get(this.focusedWid)) === win ? this.focusedWid : win.id;
    if (!this.wantsType(wid, t)) wid = win.id;
    if (!this.wantsType(wid, t)) return;
    this.sendEvent({ k: 'ev', w: wid, t, ...info });
  }

  measure(payload) {
    if (!colorCtx) colorCtx = document.createElement('canvas').getContext('2d');
    colorCtx.font = payload.qfont ? qtFontCss(payload.qfont) : tkFontCss(payload.font);
    return colorCtx.measureText(payload.text || '').width;
  }

  rgb(color) {
    const c = tkColor(color) || 'black';
    return cssToRgb(c);
  }

  // ================================================================ Dialoge
  dialog(p) {
    return new Promise((resolve) => {
      const back = h('div', { class: 'modal-backdrop gui-dialog-backdrop' });
      const box = h('div', { class: 'modal gui-dialog', role: 'dialog' });
      const done = (v) => { back.classList.remove('show'); setTimeout(() => back.remove(), 150); resolve(v); };
      const iconName = { error: 'warn', warning: 'warn', question: 'info', info: 'info' }[p.icon] || 'info';
      if (p.title) box.append(h('div', { class: 'modal-title' }, h('span', { class: `dlg-icon ${p.icon || 'info'}`, html: icon(iconName) }), h('span', { text: p.title })));
      const body = h('div', { class: 'modal-body' });
      const actions = h('div', { class: 'modal-actions' });
      const btn = (label, value, primary) => {
        const b = h('button', { class: `btn ${primary ? 'primary' : ''}`, type: 'button', text: label });
        b.addEventListener('click', () => done(typeof value === 'function' ? value() : value));
        actions.append(b);
        return b;
      };
      if (p.type === 'message') {
        if (p.message) body.append(h('p', { class: 'dlg-msg', text: p.message }));
        if (p.detail) body.append(h('p', { class: 'dlg-detail', text: p.detail }));
        const btns = p.buttons || ['ok'];
        const codes = btns.every(b => MSG_LABELS[b]);
        btns.forEach((b, i) => btn(codes ? MSG_LABELS[b] : b, b, i === 0));
      } else if (p.type === 'input') {
        if (p.prompt) body.append(h('label', { class: 'field-label', text: p.prompt }));
        let field;
        if (p.items) {
          field = h('select', { class: 'field' });
          for (const it of p.items) field.append(h('option', { value: it, text: it }));
          field.value = p.initial || p.items[0] || '';
        } else {
          field = h('input', { class: 'field', type: p.show ? 'password' : 'text', value: p.initial || '', autocapitalize: 'off', autocorrect: 'off' });
          if (p.kind === 'int' || p.kind === 'float') field.setAttribute('inputmode', p.kind === 'int' ? 'numeric' : 'decimal');
        }
        body.append(field);
        if (p.min != null || p.max != null) body.append(h('div', { class: 'field-hint', text: `Bereich: ${p.min ?? '−∞'} bis ${p.max ?? '∞'}` }));
        btn('Abbrechen', null, false);
        btn('OK', () => field.value.replace(',', p.kind === 'float' ? '.' : ','), true);
        field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(p.kind === 'float' ? field.value.replace(',', '.') : field.value); } });
        setTimeout(() => field.focus(), 60);
      } else if (p.type === 'color') {
        const field = h('input', { type: 'color', class: 'color-field', value: tkColor(p.initial) && /^#[0-9a-f]{6}$/i.test(tkColor(p.initial)) ? tkColor(p.initial) : '#3366cc' });
        body.append(field);
        btn('Abbrechen', null, false);
        btn('OK', () => field.value, true);
      } else if (p.type === 'file') {
        this.fileDialog(p, body, btn, done);
      }
      box.append(body, actions);
      back.append(box);
      document.body.append(back);
      requestAnimationFrame(() => back.classList.add('show'));
    });
  }

  fileDialog(p, body, btn, done) {
    const files = (this.fileProvider?.() || []);
    const pats = (p.filetypes || []).flatMap(([, ps]) => ps).filter(x => x && x !== '*' && x !== '*.*');
    const match = (path) => !pats.length || pats.some(pt => new RegExp('^' + pt.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i').test(path.split('/').pop()));
    if (p.mode === 'save') {
      body.append(h('label', { class: 'field-label', text: 'Dateiname im Projekt' }));
      let name = p.initialfile || '';
      if (!name && p.defaultextension) name = `neu${p.defaultextension}`;
      const field = h('input', { class: 'field', type: 'text', value: name, autocapitalize: 'off', autocorrect: 'off' });
      body.append(field);
      const list = h('div', { class: 'file-pick' });
      for (const f of files.filter(f => f.type === 'file' && match(f.path)).slice(0, 50)) {
        const b = h('button', { class: 'file-pick-item', type: 'button', text: f.path });
        b.addEventListener('click', () => { field.value = f.path; });
        list.append(b);
      }
      if (list.children.length) body.append(h('div', { class: 'field-hint', text: 'Vorhandene Dateien:' }), list);
      btn('Abbrechen', null, false);
      btn('Sichern', () => {
        let v = field.value.trim();
        if (!v) return null;
        if (p.defaultextension && !/\.[^/]+$/.test(v)) v += p.defaultextension;
        return v;
      }, true);
      setTimeout(() => field.focus(), 60);
      return;
    }
    if (p.mode === 'dir') {
      const dirs = files.filter(f => f.type === 'dir');
      body.append(h('div', { class: 'field-hint', text: 'Ordner im Projekt wählen' }));
      const list = h('div', { class: 'file-pick' });
      const rootBtn = h('button', { class: 'file-pick-item', type: 'button', text: '(Projektordner)' });
      rootBtn.addEventListener('click', () => done('.'));
      list.append(rootBtn);
      for (const d of dirs) {
        const b = h('button', { class: 'file-pick-item', type: 'button', text: d.path + '/' });
        b.addEventListener('click', () => done(d.path));
        list.append(b);
      }
      body.append(list);
      btn('Abbrechen', null, false);
      return;
    }
    const multi = p.mode === 'openmany';
    const chosen = new Set();
    const shown = files.filter(f => f.type === 'file' && match(f.path));
    if (!shown.length) body.append(h('p', { class: 'dlg-detail', text: 'Keine passenden Dateien im Projekt. Dateien lassen sich im Dateien-Bereich importieren.' }));
    const list = h('div', { class: 'file-pick' });
    for (const f of shown) {
      const b = h('button', { class: 'file-pick-item', type: 'button', text: f.path });
      b.addEventListener('click', () => {
        if (!multi) { done(f.path); return; }
        if (chosen.has(f.path)) chosen.delete(f.path); else chosen.add(f.path);
        b.classList.toggle('on', chosen.has(f.path));
      });
      list.append(b);
    }
    body.append(list);
    btn('Abbrechen', null, false);
    if (multi) btn('Öffnen', () => [...chosen], true);
  }

  // ==================================================================== Qt
  qtNew(id, kind, parentId, opts) {
    const el = this.qtCreateElement(id, kind, opts);
    el.dataset.qid = id;
    el.classList.add('qw', `q-${kind}`);
    const node = { id, kind, el, parent: parentId, opts: { ...opts }, layout: null, size: null, pos: null };
    this.qnodes.set(id, node);
    if (parentId && this.qnodes.has(parentId)) {
      const p = this.qnodes.get(parentId);
      // Ohne Layout: absolut positioniert im Eltern-Widget
      if (!p.layout && p.kind !== 'TabWidget' && p.kind !== 'Stacked' && p.kind !== 'ScrollArea' && p.kind !== 'Splitter' && p.kind !== 'MainWindow' && kind !== 'Menu' && kind !== 'MenuBar' && kind !== 'StatusBar' && kind !== 'ToolBar') {
        (p.childHost || p.el).append(el);
        el.classList.add('q-abs');
      }
    }
    this.qtApplyOpts(node, opts);
  }

  qtCreateElement(id, kind, opts) {
    const send = (e, extra = {}) => this.sendEvent({ k: 'qt', w: id, e, ...extra });
    switch (kind) {
      case 'Label': return h('div', { class: 'q-label' }, h('span', { class: 'q-text' }));
      case 'PushButton': {
        const b = h('button', { type: 'button' }, h('span', { class: 'q-text' }));
        b.addEventListener('click', () => send('clicked'));
        return b;
      }
      case 'CheckBox': case 'RadioButton': {
        const el = h('label', { class: 'q-check' });
        const input = h('input', { type: kind === 'CheckBox' ? 'checkbox' : 'radio' });
        input.addEventListener('click', (e) => { e.preventDefault(); send('clicked'); });
        el.append(input, h('span', { class: 'q-text' }));
        return el;
      }
      case 'LineEdit': {
        const input = h('input', { type: 'text', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
        input.addEventListener('input', () => send('text', { v: input.value }));
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') send('return');
          this.qtKeyFromInput(id, e, 'press');
        });
        input.addEventListener('blur', () => send('blur'));
        return h('div', { class: 'q-lineedit' }, input);
      }
      case 'TextEdit': {
        const ta = h('textarea', { autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
        ta.addEventListener('input', () => send('text', { v: ta.value }));
        const rich = h('div', { class: 'q-rich', hidden: true });
        return h('div', { class: 'q-textedit' }, ta, rich);
      }
      case 'ComboBox': {
        const sel = h('select');
        sel.addEventListener('change', () => send('index', { v: sel.selectedIndex }));
        return h('div', { class: 'q-combo' }, sel);
      }
      case 'SpinBox': {
        const input = h('input', { type: 'text', inputmode: 'decimal' });
        const commit = () => send('value', { v: input.value.replace(',', '.').replace(/[^\d.\-]/g, '') });
        input.addEventListener('change', commit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
        const up = h('button', { type: 'button', class: 'spin-btn', text: '▲', tabindex: '-1' });
        const down = h('button', { type: 'button', class: 'spin-btn', text: '▼', tabindex: '-1' });
        const step = (d) => {
          const n = this.qnodes.get(id);
          const v = (parseFloat(n.opts.value) || 0) + d * (n.opts.step || 1);
          send('value', { v: Math.max(n.opts.min ?? -Infinity, Math.min(n.opts.max ?? Infinity, v)) });
        };
        up.addEventListener('click', () => step(1));
        down.addEventListener('click', () => step(-1));
        return h('div', { class: 'q-spin' }, input, h('div', { class: 'spin-btns' }, up, down));
      }
      case 'Slider': {
        const input = h('input', { type: 'range' });
        input.addEventListener('input', () => send('value', { v: input.value }));
        input.addEventListener('change', () => send('release'));
        return h('div', { class: 'q-slider' }, input);
      }
      case 'ProgressBar': return h('div', { class: 'q-progress' }, h('div', { class: 'q-progress-bar' }), h('span', { class: 'q-progress-text' }));
      case 'ListWidget': {
        const el = h('div', { class: 'q-list', tabindex: '0' });
        el.addEventListener('click', (e) => {
          const it = e.target.closest('.q-li');
          if (!it) return;
          if (e.target.matches('input[type=checkbox]')) { send('check', { r: +it.dataset.i, v: e.target.checked }); return; }
          send('row', { v: +it.dataset.i });
        });
        el.addEventListener('dblclick', (e) => {
          const it = e.target.closest('.q-li');
          if (it) send('dbl', { v: +it.dataset.i });
        });
        return el;
      }
      case 'TableWidget': {
        const el = h('div', { class: 'q-table' });
        return el;
      }
      case 'GroupBox': {
        const el = h('div', { class: 'q-group' }, h('div', { class: 'q-legend' }));
        return el;
      }
      case 'TabWidget': {
        const el = h('div', { class: 'q-tabs' }, h('div', { class: 'q-tabbar' }), h('div', { class: 'q-tabpanel' }));
        return el;
      }
      case 'Stacked': return h('div', { class: 'q-stacked' });
      case 'ScrollArea': return h('div', { class: 'q-scroll' });
      case 'Splitter': return h('div', { class: 'q-splitter' });
      case 'MainWindow': {
        const el = h('div', { class: 'q-main' });
        return el;
      }
      case 'MenuBar': return h('div', { class: 'q-menubar' });
      case 'StatusBar': return h('div', { class: 'q-statusbar' }, h('span', { class: 'q-text' }));
      case 'ToolBar': return h('div', { class: 'q-toolbar' });
      case 'Menu': { const el = h('div'); el.hidden = true; return el; }
      case 'Frame': return h('div', { class: 'q-frame' });
      default: return h('div');
    }
  }

  qtApplyOpts(node, opts) {
    const el = node.el;
    const kind = node.kind;
    Object.assign(node.opts, opts);
    const o = node.opts;
    const textEl = el.querySelector(':scope > .q-text') || el.querySelector(':scope > span.q-text');
    if (opts.text !== undefined) {
      if (kind === 'LineEdit') { const i = el.querySelector('input'); if (i.value !== opts.text) i.value = opts.text; }
      else if (kind === 'TextEdit') { const ta = el.querySelector('textarea'); ta.hidden = false; el.querySelector('.q-rich').hidden = true; if (ta.value !== opts.text) ta.value = opts.text; }
      else if (kind === 'Label' && (o.fmt === 1 || (o.fmt !== 0 && /<[a-z][\s\S]*>/i.test(opts.text)))) { textEl.innerHTML = this.sanitize(opts.text); }
      else if (textEl) textEl.textContent = String(opts.text).replace(/&(?!&)/g, '');
    }
    if (opts.html !== undefined && kind === 'TextEdit') {
      const ta = el.querySelector('textarea');
      const rich = el.querySelector('.q-rich');
      if (opts.html == null) { ta.hidden = false; rich.hidden = true; }
      else { ta.hidden = true; rich.hidden = false; rich.innerHTML = this.sanitize(opts.html); }
    }
    if (opts.scroll) {
      requestAnimationFrame(() => {
        const s = el.querySelector('textarea:not([hidden]), .q-rich:not([hidden])') || el;
        s.scrollTop = s.scrollHeight;
      });
    }
    if (opts.placeholder !== undefined) el.querySelector('input, textarea')?.setAttribute('placeholder', opts.placeholder);
    if (opts.readonly !== undefined) { const i = el.querySelector('input, textarea'); if (i) i.readOnly = !!opts.readonly; }
    if (opts.echo !== undefined) { const i = el.querySelector('input'); if (i) i.type = opts.echo === 2 || opts.echo === 3 ? 'password' : 'text'; }
    if (opts.maxlen !== undefined) el.querySelector('input')?.setAttribute('maxlength', opts.maxlen);
    if (opts.inputmode !== undefined) el.querySelector('input')?.setAttribute('inputmode', opts.inputmode);
    if (opts.align !== undefined) this.qtAlign(node, opts.align);
    if (opts.wrap !== undefined) el.classList.toggle('wrap', !!opts.wrap);
    if (opts.checked !== undefined) { const i = el.querySelector('input'); if (i) i.checked = !!opts.checked; el.classList.toggle('checked', !!opts.checked); }
    if (opts.checkable !== undefined) el.classList.toggle('checkable', !!opts.checkable);
    if (opts.enabled !== undefined) {
      el.classList.toggle('disabled', !opts.enabled);
      el.querySelectorAll('input, button, select, textarea').forEach(i => { i.disabled = !opts.enabled; });
      if (el.tagName === 'BUTTON') el.disabled = !opts.enabled;
    }
    if (opts.visible !== undefined) el.style.display = opts.visible ? '' : 'none';
    if (opts.tooltip !== undefined) el.title = opts.tooltip;
    if (opts.font !== undefined) el.style.font = qtFontCss(opts.font);
    if (opts.css !== undefined) this.qtStyleSheet(node, opts.css);
    if (opts.flat !== undefined) el.classList.toggle('flat', !!opts.flat);
    if (opts.size !== undefined) node.size = opts.size;
    if (opts.pos !== undefined) node.pos = opts.pos;
    if (opts.fixed !== undefined) { el.style.width = `${opts.fixed[0]}px`; el.style.height = `${opts.fixed[1]}px`; el.style.flex = '0 0 auto'; node.fixed = true; }
    if (opts.fixedW !== undefined) { el.style.width = `${opts.fixedW}px`; el.style.minWidth = el.style.maxWidth = `${opts.fixedW}px`; node.fixedW = true; }
    if (opts.fixedH !== undefined) { el.style.height = `${opts.fixedH}px`; el.style.minHeight = el.style.maxHeight = `${opts.fixedH}px`; node.fixedH = true; }
    if (opts.minW !== undefined) el.style.minWidth = `${opts.minW}px`;
    if (opts.minH !== undefined) el.style.minHeight = `${opts.minH}px`;
    if (opts.maxW !== undefined && opts.maxW < 16777215) el.style.maxWidth = `${opts.maxW}px`;
    if (opts.maxH !== undefined && opts.maxH < 16777215) el.style.maxHeight = `${opts.maxH}px`;
    if (opts.grow !== undefined) node.grow = opts.grow;
    if (opts.margins !== undefined) el.style.padding = opts.margins.map(m => `${m}px`).join(' ').replace(/^(\S+) (\S+) (\S+) (\S+)$/, '$2 $3 $4 $1');
    if (opts.pixmap !== undefined) {
      if (textEl) {
        textEl.textContent = '';
        if (opts.pixmap) {
          const img = this.images.get(opts.pixmap.name);
          if (img) {
            const im = this.imgElement(img);
            im.width = opts.pixmap.w || img.w;
            im.height = opts.pixmap.h || img.h;
            if (o.scaled) { im.style.width = '100%'; im.style.height = '100%'; im.style.objectFit = 'fill'; }
            textEl.append(im);
          } else if (opts.pixmap.fill) {
            textEl.append(h('span', { style: { display: 'inline-block', width: `${opts.pixmap.w}px`, height: `${opts.pixmap.h}px`, background: opts.pixmap.fill } }));
          }
        }
      }
    }
    if (opts.icon !== undefined && kind === 'PushButton') {
      el.querySelector('.q-icon')?.remove();
      if (opts.icon) { const img = this.images.get(opts.icon.name); if (img) { const im = this.imgElement(img); im.className = 'q-icon'; im.width = 18; im.height = 18; el.prepend(im); } }
    }
    if (opts.lcd) el.classList.add('lcd');
    if (opts.title !== undefined && kind === 'GroupBox') { const lg = el.querySelector('.q-legend'); lg.textContent = opts.title; lg.hidden = !opts.title; }
    // Werte
    if (kind === 'Slider') {
      const input = el.querySelector('input');
      if (o.min !== undefined) input.min = o.min;
      if (o.max !== undefined) input.max = o.max;
      if (o.step !== undefined) input.step = o.step;
      if (opts.value !== undefined) input.value = opts.value;
      el.classList.toggle('vertical', o.orient === 2);
    }
    if (kind === 'SpinBox') {
      const input = el.querySelector('input');
      if (o.value !== undefined && document.activeElement !== input) {
        const v = typeof o.value === 'number' && o.decimals ? o.value.toFixed(o.decimals) : String(o.value);
        input.value = `${o.prefix || ''}${v}${o.suffix || ''}`;
      }
    }
    if (kind === 'ProgressBar') {
      const min = o.min ?? 0, max = o.max ?? 100, v = o.value ?? 0;
      const pct = max > min ? (v - min) / (max - min) : 0;
      el.querySelector('.q-progress-bar').style.width = `${Math.max(0, Math.min(1, pct)) * 100}%`;
      el.classList.toggle('busy', max === min);
      const fmt = (o.format || '%p%').replace('%p', Math.round(pct * 100)).replace('%v', v).replace('%m', max);
      el.querySelector('.q-progress-text').textContent = o.textVisible === false ? '' : fmt;
    }
    if (kind === 'ComboBox' && (opts.items !== undefined || opts.index !== undefined)) {
      const sel = el.querySelector('select');
      if (opts.items !== undefined) {
        sel.textContent = '';
        for (const it of o.items || []) sel.append(h('option', { text: it }));
      }
      sel.selectedIndex = o.index ?? -1;
    }
    if (kind === 'ListWidget' && (opts.items !== undefined || opts.row !== undefined)) this.qtRenderList(node);
    if (kind === 'TableWidget' && (opts.cells !== undefined || opts.rows !== undefined)) this.qtRenderTable(node);
    if (kind === 'TabWidget' && (opts.tabs !== undefined || opts.index !== undefined)) this.qtRenderTabs(node);
    if (kind === 'Stacked' && (opts.pages !== undefined || opts.index !== undefined)) this.qtRenderStacked(node);
    if (kind === 'ScrollArea' && opts.inner) { const c = this.qnodes.get(opts.inner); if (c) { el.textContent = ''; el.append(c.el); c.el.classList.remove('q-abs'); } }
    if (kind === 'Splitter' && (opts.parts !== undefined || opts.orient !== undefined)) {
      el.classList.toggle('vertical', o.orient === 2);
      for (const pid of o.parts || []) { const c = this.qnodes.get(pid); if (c && c.el.parentElement !== el) { el.append(c.el); c.el.classList.remove('q-abs'); } }
      (o.parts || []).forEach((pid, i) => { const c = this.qnodes.get(pid); if (c) c.el.style.flex = o.sizes ? `${o.sizes[i] || 1} 1 0` : '1 1 0'; });
    }
    if (kind === 'StatusBar' && opts.text !== undefined) el.querySelector('.q-text').textContent = opts.text;
    if (node.pos && el.classList.contains('q-abs')) { el.style.left = `${node.pos[0]}px`; el.style.top = `${node.pos[1]}px`; }
    if (node.size && el.classList.contains('q-abs')) { el.style.width = `${node.size[0]}px`; el.style.height = `${node.size[1]}px`; }
    if (opts.size && this.windows.has(node.id)) this.scheduleLayout();
    if (opts.stretch) el.classList.add('stretch-last');
    if (opts.alternate !== undefined) el.classList.toggle('alternate', !!opts.alternate);
    if (opts.editable !== undefined && kind === 'TableWidget') { node.editable = !!opts.editable; this.qtRenderTable(node); }
    this.scheduleLayout();
  }

  sanitize(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html);
    tpl.content.querySelectorAll('script, iframe, object, embed, link, meta, style').forEach(n => n.remove());
    tpl.content.querySelectorAll('*').forEach(n => {
      for (const a of [...n.attributes]) if (/^on/i.test(a.name) || /javascript:/i.test(a.value)) n.removeAttribute(a.name);
    });
    return tpl.innerHTML;
  }

  qtAlign(node, a) {
    const el = node.el;
    const hz = a & 0x1 ? 'flex-start' : a & 0x2 ? 'flex-end' : a & 0x4 ? 'center' : null;
    const vt = a & 0x20 ? 'flex-start' : a & 0x40 ? 'flex-end' : a & 0x80 ? 'center' : null;
    if (node.kind === 'Label') {
      if (hz) { el.style.justifyContent = hz; el.style.textAlign = hz === 'center' ? 'center' : hz === 'flex-end' ? 'right' : 'left'; }
      if (vt) el.style.alignItems = vt;
    } else if (node.kind === 'LineEdit') {
      el.querySelector('input').style.textAlign = hz === 'center' ? 'center' : hz === 'flex-end' ? 'right' : 'left';
    }
  }

  qtStyleSheet(node, css) {
    // Einfache Deklarationen direkt anwenden, Selektoren auf diesen Typ beachten
    let decls = String(css);
    const blocks = [...decls.matchAll(/([^{}]*)\{([^}]*)\}/g)];
    if (blocks.length) {
      decls = blocks.filter(m => !m[1].trim() || /Q\w+|\*|#/.test(m[1]) && !/:(hover|pressed|checked|disabled|focus)/.test(m[1])).map(m => m[2]).join(';');
    }
    const el = node.el;
    const target = node.kind === 'LineEdit' || node.kind === 'TextEdit' ? el.querySelector('input, textarea') : el;
    for (const d of decls.split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      const prop = d.slice(0, i).trim().toLowerCase();
      const val = d.slice(i + 1).trim().replace(/!important/, '');
      if (!prop) continue;
      try {
        if (prop === 'qproperty-alignment') continue;
        target.style.setProperty(prop, val);
        if (prop === 'background' || prop === 'background-color') el.classList.add('styled-bg');
      } catch (e) { /* unbekannt */ }
    }
  }

  qtRenderList(node) {
    const el = node.el;
    el.textContent = '';
    (node.opts.items || []).forEach((it, i) => {
      const row = h('div', { class: `q-li${i === node.opts.row ? ' sel' : ''}`, dataset: { i: String(i) } });
      if (it.c !== null && it.c !== undefined) row.append(h('input', { type: 'checkbox', checked: it.c || null }));
      row.append(document.createTextNode(it.t));
      if (it.fg) row.style.color = it.fg;
      if (it.bg) row.style.background = it.bg;
      el.append(row);
    });
    if (node.opts.scroll) el.scrollTop = el.scrollHeight;
  }

  qtRenderTable(node) {
    const o = node.opts;
    const el = node.el;
    el.textContent = '';
    const table = h('table');
    const rows = o.rows || 0, cols = o.cols || 0;
    const head = h('tr', {}, h('th', { class: 'corner' }));
    for (let c = 0; c < cols; c++) head.append(h('th', { text: o.hlabels?.[c] ?? String(c + 1) }));
    table.append(h('thead', {}, head));
    const body = h('tbody');
    for (let r = 0; r < rows; r++) {
      const tr = h('tr', {}, h('th', { text: o.vlabels?.[r] ?? String(r + 1) }));
      for (let c = 0; c < cols; c++) {
        const cell = o.cells?.[`${r},${c}`];
        const td = h('td', { text: cell?.t ?? '' });
        if (cell?.fg) td.style.color = cell.fg;
        if (cell?.bg) td.style.background = cell.bg;
        td.addEventListener('click', () => {
          el.querySelectorAll('td.sel').forEach(x => x.classList.remove('sel'));
          td.classList.add('sel');
          this.sendEvent({ k: 'qt', w: node.id, e: 'cell', r, c });
        });
        td.addEventListener('dblclick', () => {
          this.sendEvent({ k: 'qt', w: node.id, e: 'dbl', r, c });
          if (node.editable === false || cell?.ro) return;
          td.contentEditable = 'true';
          td.focus();
          const finish = () => {
            td.contentEditable = 'false';
            this.sendEvent({ k: 'qt', w: node.id, e: 'edit', r, c, v: td.textContent });
          };
          td.addEventListener('blur', finish, { once: true });
          td.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); td.blur(); } });
        });
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);
    el.append(table);
  }

  qtRenderTabs(node) {
    const bar = node.el.querySelector('.q-tabbar');
    const panel = node.el.querySelector('.q-tabpanel');
    bar.textContent = '';
    (node.opts.tabs || []).forEach(([wid, label], i) => {
      const b = h('button', { class: `q-tab${i === node.opts.index ? ' on' : ''}`, type: 'button', text: String(label).replace(/&/g, '') });
      b.addEventListener('click', () => this.sendEvent({ k: 'qt', w: node.id, e: 'tab', v: i }));
      bar.append(b);
      const c = this.qnodes.get(wid);
      if (c) {
        if (c.el.parentElement !== panel) panel.append(c.el);
        c.el.classList.remove('q-abs');
        c.el.style.display = i === node.opts.index ? '' : 'none';
      }
    });
  }

  qtRenderStacked(node) {
    (node.opts.pages || []).forEach((wid, i) => {
      const c = this.qnodes.get(wid);
      if (!c) return;
      if (c.el.parentElement !== node.el) node.el.append(c.el);
      c.el.classList.remove('q-abs');
      c.el.style.display = i === node.opts.index ? '' : 'none';
    });
  }

  qtConfig(id, opts) {
    const node = this.qnodes.get(id);
    if (node) this.qtApplyOpts(node, opts);
  }

  qtNewLayout(id, kind) {
    const el = h('div', { class: `ql ql-${kind.toLowerCase()}` });
    this.qnodes.set(id, { id, kind, el, isLayout: true, items: [], opts: {} });
  }

  qtLayoutAdd(lid, kind, cid, opts) {
    const lay = this.qnodes.get(lid);
    if (!lay) return;
    let child;
    if (kind === 'w' || kind === 'l') {
      const c = this.qnodes.get(cid);
      if (!c) return;
      child = c.el;
      c.el.classList.remove('q-abs');
      c.el.style.left = c.el.style.top = '';
      c.layoutOpts = opts;
      c.inLayout = lay;
    } else if (kind === 'stretch') {
      child = h('div', { class: 'ql-stretch' });
      child.style.flex = `${opts.stretch || 1} 1 0`;
      if (opts.size) child.style.minWidth = child.style.minHeight = `${opts.size}px`;
    } else if (kind === 'space') {
      child = h('div', { class: 'ql-space' });
      child.style.flex = `0 0 ${opts.size || 0}px`;
    }
    if (!child) return;
    if (lay.kind === 'Grid' || lay.kind === 'Form') {
      child.style.gridRow = `${(opts.row ?? 0) + 1} / span ${opts.rowspan || 1}`;
      child.style.gridColumn = `${(opts.col ?? 0) + 1} / span ${opts.colspan || 1}`;
    } else if (opts.stretch && kind !== 'stretch' && kind !== 'space') {
      child.style.flexGrow = opts.stretch;
      child.dataset.stretch = opts.stretch;
    }
    if (opts.align && kind === 'w') {
      const a = opts.align;
      const hz = a & 0x1 ? 'start' : a & 0x2 ? 'end' : a & 0x4 ? 'center' : null;
      const vt = a & 0x20 ? 'start' : a & 0x40 ? 'end' : a & 0x80 ? 'center' : null;
      if (lay.kind === 'VBox') { if (hz) child.style.alignSelf = hz; }
      else if (lay.kind === 'HBox') { if (vt) child.style.alignSelf = vt; }
      else { if (hz) child.style.justifySelf = hz; if (vt) child.style.alignSelf = vt; }
    }
    if (opts.index != null && opts.index < lay.el.children.length) lay.el.insertBefore(child, lay.el.children[opts.index]);
    else lay.el.append(child);
    lay.items.push({ kind, id: cid, el: child, opts });
    this.qtLayoutGrowth(lay);
  }

  qtGrows(item, vertical, depth = 0) {
    // Waechst ein Layout-Eintrag in die Richtung? (Qt-Groessenregeln, vereinfacht)
    const EXPAND_BOTH = ['TextEdit', 'ListWidget', 'TableWidget', 'TabWidget', 'Stacked', 'ScrollArea', 'Splitter'];
    const EXPAND_H = ['LineEdit', 'ComboBox', 'Slider', 'ProgressBar', 'SpinBox', 'GroupBox', ...EXPAND_BOTH];
    if (depth > 30) return false;
    if (item.kind === 'stretch') return true;
    if (item.kind === 'space') return false;
    if (item.kind === 'l') {
      const lay = this.qnodes.get(item.id);
      return !!lay && lay.items.some(i => {
        if (i.kind === 'stretch') return (lay.kind === 'VBox') === vertical || lay.kind === 'Grid';
        return this.qtGrows(i, vertical, depth + 1);
      });
    }
    const c = this.qnodes.get(item.id);
    if (!c) return false;
    if (c.fixed || (vertical ? c.fixedH : c.fixedW)) return false;
    if (c.grow) return !!(vertical ? c.grow[1] : c.grow[0]);
    if (this.qtEvents.get(c.id)?.has('paintEvent')) return true;
    if (c.kind === 'Slider') return vertical ? c.opts.orient === 2 : c.opts.orient !== 2;
    if (EXPAND_BOTH.includes(c.kind)) return true;
    if (!vertical && EXPAND_H.includes(c.kind)) return true;
    if (c.kind === 'Widget' || c.kind === 'Frame' || c.kind === 'GroupBox' || c.kind === 'MainWindow') {
      if (c.layout) return this.qtGrows({ kind: 'l', id: c.layout.id }, vertical, depth + 1);
      return !c.size;
    }
    return false;
  }

  qtLayoutGrowth(lay) {
    const isV = lay.kind === 'VBox';
    const isH = lay.kind === 'HBox';
    if (isV || isH) {
      const items = lay.items.filter(i => i.kind === 'w' || i.kind === 'l');
      const anyStretch = lay.items.some(i => (i.opts.stretch || 0) > 0 && i.kind !== 'stretch') || lay.items.some(i => i.kind === 'stretch');
      const explicit = lay.items.some(i => (i.opts.stretch || 0) > 0 && i.kind !== 'stretch');
      const grows = items.map(it => this.qtGrows(it, isV));
      const anyExpanding = grows.some(Boolean);
      items.forEach((it, idx) => {
        const c = this.qnodes.get(it.id);
        let g;
        if (it.el.dataset.stretch) g = +it.el.dataset.stretch;
        else if (explicit) g = 0;
        else if (anyExpanding) g = grows[idx] ? 1 : 0;
        else if (anyStretch) g = 0;
        else g = isV && c && c.kind === 'Label' ? 1 : (isH && c && c.kind === 'Label' ? 1 : 0);
        it.el.style.flexGrow = String(g);
        it.el.style.flexShrink = '1';
        it.el.style.flexBasis = 'auto';
        if (isH && c && ['PushButton', 'LineEdit', 'ComboBox', 'SpinBox', 'CheckBox', 'RadioButton'].includes(c.kind) && !it.opts.align) it.el.style.alignSelf = 'center';
        if (isV && c && !this.qtGrows(it, false) && ['PushButton'].includes(c.kind) && !it.opts.align) it.el.style.alignSelf = '';
      });
    } else if (lay.kind === 'Grid' || lay.kind === 'Form') {
      const colGrow = {};
      for (const it of lay.items) {
        if (it.kind !== 'w' && it.kind !== 'l') continue;
        if ((it.opts.colspan || 1) > 1) continue;
        if (this.qtGrows(it, false)) colGrow[it.opts.col ?? 0] = true;
      }
      const ncol = Math.max(1, ...lay.items.map(i => (i.opts.col ?? 0) + (i.opts.colspan || 1)));
      const stretch = lay.opts.colstretch || {};
      const anyStretch = Object.values(stretch).some(v => v > 0);
      const tpl = [];
      for (let c = 0; c < ncol; c++) {
        if (anyStretch) tpl.push(stretch[c] > 0 ? `minmax(min-content, ${stretch[c]}fr)` : 'auto');
        else tpl.push(colGrow[c] ? 'minmax(min-content, 1fr)' : 'auto');
      }
      lay.el.style.gridTemplateColumns = tpl.join(' ');
      const rstretch = lay.opts.rowstretch || {};
      const nrow = Math.max(1, ...lay.items.map(i => (i.opts.row ?? 0) + (i.opts.rowspan || 1)));
      const rowGrow = {};
      for (const it of lay.items) {
        if ((it.kind === 'w' || it.kind === 'l') && (it.opts.rowspan || 1) === 1 && this.qtGrows(it, true)) rowGrow[it.opts.row ?? 0] = true;
      }
      const anyR = Object.values(rstretch).some(v => v > 0);
      const rt = [];
      for (let r = 0; r < nrow; r++) {
        if (anyR) rt.push(rstretch[r] > 0 ? `minmax(min-content, ${rstretch[r]}fr)` : 'auto');
        else rt.push(rowGrow[r] ? 'minmax(min-content, 1fr)' : 'auto');
      }
      lay.el.style.gridTemplateRows = rt.join(' ');
    }
  }

  qtLayoutConfig(lid, opts) {
    const lay = this.qnodes.get(lid);
    if (!lay) return;
    if (opts.spacing !== undefined) lay.el.style.gap = `${opts.spacing}px`;
    if (opts.hspacing !== undefined) lay.el.style.columnGap = `${opts.hspacing}px`;
    if (opts.vspacing !== undefined) lay.el.style.rowGap = `${opts.vspacing}px`;
    if (opts.margins !== undefined) { const [l, t, r, b] = opts.margins; lay.el.style.padding = `${t}px ${r}px ${b}px ${l}px`; lay.customMargins = true; }
    if (opts.align !== undefined) {
      const a = opts.align;
      if (a & 0x20) lay.el.style.justifyContent = 'flex-start';
      if (a & 0x80 && lay.kind === 'VBox') lay.el.style.justifyContent = 'center';
      if (a & 0x4 && lay.kind === 'HBox') lay.el.style.justifyContent = 'center';
    }
    if (opts.colstretch) { lay.opts.colstretch = { ...(lay.opts.colstretch || {}), [opts.colstretch[0]]: opts.colstretch[1] }; this.qtLayoutGrowth(lay); }
    if (opts.rowstretch) { lay.opts.rowstretch = { ...(lay.opts.rowstretch || {}), [opts.rowstretch[0]]: opts.rowstretch[1] }; this.qtLayoutGrowth(lay); }
    if (opts.colmin) { /* ignoriert */ }
  }

  qtSetLayout(wid, lid) {
    const w = this.qnodes.get(wid);
    const lay = this.qnodes.get(lid);
    if (!w || !lay) return;
    w.layout = lay;
    lay.owner = w;
    const host = w.kind === 'GroupBox' ? w.el : (w.childHost || w.el);
    host.append(lay.el);
    lay.el.classList.add('ql-root');
    if (!lay.customMargins) lay.el.classList.add('ql-margins');
    w.el.classList.add('has-layout');
  }

  qtReparent(id, parentId) {
    const n = this.qnodes.get(id);
    const p = parentId ? this.qnodes.get(parentId) : null;
    if (!n) return;
    n.parent = parentId;
    if (p && !p.layout && !n.inLayout) { (p.childHost || p.el).append(n.el); n.el.classList.add('q-abs'); }
  }

  qtCentral(mid, cid) {
    const m = this.qnodes.get(mid);
    const c = this.qnodes.get(cid);
    if (!m || !c) return;
    if (!m.centralHost) {
      m.centralHost = h('div', { class: 'q-central' });
      m.el.append(m.centralHost);
    }
    m.centralHost.textContent = '';
    c.el.classList.remove('q-abs');
    m.centralHost.append(c.el);
    this.qtOrderMain(m);
  }

  qtSetMenubar(mid, bid) {
    const m = this.qnodes.get(mid);
    const b = this.qnodes.get(bid);
    if (!m || !b) return;
    m.menubar = b;
    m.el.prepend(b.el);
    b.el.classList.remove('q-abs');
  }

  qtMenubar(bid, menus) {
    const b = this.qnodes.get(bid);
    if (!b) return;
    b.el.textContent = '';
    for (const m of menus) {
      const btn = h('button', { class: 'mb-item', type: 'button', text: m.title });
      btn.addEventListener('click', async () => {
        if (m.direct) { this.sendEvent({ k: 'act', w: m.direct }); return; }
        const conv = (items) => items.map(a => a.sep ? { sep: true } : { label: a.text, disabled: !a.enabled, checked: a.checkable ? a.checked : undefined, accel: a.shortcut, value: a.id, sub: a.sub ? true : null, subItems: a.sub });
        let items = conv(m.items || []);
        let anchor = btn;
        while (true) {
          const v = await this.showPopup(items, anchor);
          if (v == null) return;
          const it = items.find(i => i.value === v);
          if (it?.subItems) { items = conv(it.subItems); continue; }
          this.sendEvent({ k: 'act', w: v });
          return;
        }
      });
      b.el.append(btn);
    }
    this.scheduleLayout();
  }

  qtSetStatusbar(mid, sid) {
    const m = this.qnodes.get(mid);
    const s = this.qnodes.get(sid);
    if (!m || !s) return;
    m.statusbar = s;
    s.el.classList.remove('q-abs');
    m.el.append(s.el);
    this.qtOrderMain(m);
  }

  qtAddToolbar(mid, tid) {
    const m = this.qnodes.get(mid);
    const t = this.qnodes.get(tid);
    if (!m || !t) return;
    t.el.classList.remove('q-abs');
    if (m.centralHost) m.el.insertBefore(t.el, m.centralHost); else m.el.append(t.el);
  }

  qtOrderMain(m) {
    if (m.menubar) m.el.prepend(m.menubar.el);
    if (m.statusbar) m.el.append(m.statusbar.el);
  }

  qtWindow(id, info) {
    const node = this.qnodes.get(id);
    if (!node) return;
    let win = this.windows.get(id);
    if (!win) {
      win = this.createWindow(id, 'qt', info.title);
      win.content.append(node.el);
      node.el.classList.remove('q-abs');
      node.el.classList.add('q-top');
      node.win = win;
    } else {
      win.withdrawn = false;
      win.title = info.title || win.title;
      win.titleEl.textContent = win.title;
      this.active = id;
      this.renderTabs();
      this.show(id);
    }
    if (info.size) node.size = info.size;
    this.scheduleLayout();
  }

  qtWm(id, what, value) {
    const win = this.windows.get(id);
    if (what === 'title') {
      if (win) { win.title = value; win.titleEl.textContent = value; this.renderTabs(); }
      const n = this.qnodes.get(id);
      if (n) n.title = value;
    } else if (what === 'hide' && win) {
      win.withdrawn = true;
      this.renderTabs();
      this.onWindowsChanged?.(this.windowCount, this.visible);
    } else if (what === 'maximize' && win) {
      win.zoomed = true;
      this.scheduleLayout();
    } else if (what === 'opacity' && win) {
      win.frame.style.opacity = value;
    }
  }

  layoutQtWindow(win) {
    const node = this.qnodes.get(win.id);
    if (!node) return;
    for (const q of this.qnodes.values()) if (q.isLayout && q.el.isConnected && win.content.contains(q.el)) this.qtLayoutGrowth(q);
    const frameHidden = win.frame.hidden;
    if (frameHidden) { win.frame.hidden = false; win.frame.style.visibility = 'hidden'; win.frame.style.position = 'absolute'; }
    const el = node.el;
    const avail = this.stageSize();
    let W, H;
    if (node.size) {
      [W, H] = node.size;
    } else {
      el.style.width = 'max-content';
      el.style.height = 'auto';
      W = Math.max(160, Math.ceil(el.offsetWidth));
      H = Math.max(60, Math.ceil(el.offsetHeight));
    }
    if (win.zoomed) { W = avail.w; H = Math.max(H, avail.h - 40); }
    el.style.width = `${W}px`;
    el.style.height = `${H}px`;
    win.content.style.width = `${W}px`;
    win.content.style.height = `${H}px`;
    win.w = W; win.h = H;
    this.applyScale(win, W, H);
    // Zeichenflaechen anpassen
    for (const q of this.qnodes.values()) if (q.canvas) this.qtSizeCanvas(q);
    if (frameHidden) { win.frame.hidden = true; win.frame.style.visibility = ''; win.frame.style.position = ''; }
  }

  qtGeometry(onlyChanged) {
    const out = {};
    if (!this.qgeom) this.qgeom = {};
    for (const [id, q] of this.qnodes) {
      if (q.isLayout) continue;
      const win = this.windowOfQt(q);
      if (!win) continue;
      const s = win.scale || 1;
      const r = q.el.getBoundingClientRect();
      const wr = win.content.getBoundingClientRect();
      const pr = q.el.parentElement?.closest('[data-qid]')?.getBoundingClientRect() || wr;
      const val = [(r.left - pr.left) / s, (r.top - pr.top) / s, r.width / s, r.height / s, (r.left - wr.left) / s, (r.top - wr.top) / s].map(v => Math.round(v));
      const old = this.qgeom[id];
      const changed = !old || old.some((v, i) => v !== val[i]);
      this.qgeom[id] = val;
      if (!onlyChanged || (changed && (this.qtEvents.get(id)?.size))) out[id] = val;
    }
    return out;
  }

  windowOfQt(q) {
    let el = q.el;
    const fr = el.closest('.win-frame');
    return fr ? this.windows.get(fr.dataset.win) : null;
  }

  qtKeyTarget(win) {
    // fokussiertes Widget mit keyPressEvent, sonst das Fenster
    for (const [id, set] of this.qtEvents) {
      const q = this.qnodes.get(id);
      if (q && set.has('keyPressEvent') && this.windowOfQt(q) === win && q.el.contains(document.activeElement)) return id;
    }
    for (const [id, set] of this.qtEvents) {
      const q = this.qnodes.get(id);
      if (q && set.has('keyPressEvent') && this.windowOfQt(q) === win) return id;
    }
    return win.id;
  }

  qtKeyFromInput(id, e, t) {
    const set = this.qtEvents.get(id);
    if (!set?.has('keyPressEvent')) return;
    const info = keyInfo(e);
    this.sendEvent({ k: 'qt', w: id, e: 'key', t, keysym: info.keysym, char: info.char, mods: info.state });
  }

  qtAttachEvents(id) {
    const q = this.qnodes.get(id);
    if (!q || q.eventsAttached) {
      if (q) this.qtEnsureCanvas(q);
      return;
    }
    const set = this.qtEvents.get(id);
    if (!set || !set.size) return;
    q.eventsAttached = true;
    this.qtEnsureCanvas(q);
    const el = q.el;
    const send = (e, t, extra = {}) => {
      const win = this.windowOfQt(q);
      const s = win?.scale || 1;
      const r = el.getBoundingClientRect();
      const wr = win?.content.getBoundingClientRect() || r;
      const mods = [];
      if (e.shiftKey) mods.push('Shift');
      if (e.ctrlKey) mods.push('Control');
      if (e.altKey) mods.push('Alt');
      if (e.metaKey) mods.push('Meta');
      this.sendEvent({ k: 'qt', w: id, e: 'mouse', t, x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s, X: (e.clientX - wr.left) / s, Y: (e.clientY - wr.top) / s, b: e.button === 2 ? 3 : e.button === 1 ? 2 : 1, mods, ...extra });
    };
    let down = false;
    let lastDown = 0;
    el.addEventListener('pointerdown', (e) => {
      const cur = this.qtEvents.get(id) || new Set();
      if (e.target.closest('input, textarea, select, button') && e.target.closest('[data-qid]') !== el) return;
      down = true;
      if (cur.has('mouseMoveEvent')) { try { el.setPointerCapture(e.pointerId); } catch (er) { /* egal */ } }
      const now = performance.now();
      if (cur.has('mousePressEvent')) send(e, 'press', { down: true });
      if (now - lastDown < 350 && cur.has('mouseDoubleClickEvent')) send(e, 'dbl', { down: true });
      lastDown = now;
    });
    el.addEventListener('pointermove', (e) => {
      const cur = this.qtEvents.get(id) || new Set();
      if (!cur.has('mouseMoveEvent')) return;
      if (!down && !q.opts.tracking && e.pointerType !== 'mouse') return;
      send(e, 'move', { down });
    });
    const up = (e) => {
      if (!down) return;
      down = false;
      const cur = this.qtEvents.get(id) || new Set();
      if (cur.has('mouseReleaseEvent')) send(e, 'release', { down: false });
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerenter', (e) => { if ((this.qtEvents.get(id) || new Set()).has('enterEvent')) this.sendEvent({ k: 'qt', w: id, e: 'enter' }); });
    el.addEventListener('pointerleave', (e) => { if ((this.qtEvents.get(id) || new Set()).has('leaveEvent')) this.sendEvent({ k: 'qt', w: id, e: 'leave' }); });
    el.addEventListener('wheel', (e) => {
      if (!(this.qtEvents.get(id) || new Set()).has('wheelEvent')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      this.sendEvent({ k: 'qt', w: id, e: 'wheel', x: e.clientX - r.left, y: e.clientY - r.top, delta: -Math.sign(e.deltaY) * 120 });
    }, { passive: false });
    if (set.has('mouseMoveEvent') || set.has('mousePressEvent')) el.classList.add('no-scroll');
  }

  qtEnsureCanvas(q) {
    const set = this.qtEvents.get(q.id);
    if (!set?.has('paintEvent') || q.canvas) return;
    q.canvas = document.createElement('canvas');
    q.canvas.className = 'q-paint';
    q.el.prepend(q.canvas);
    q.el.classList.add('has-paint');
    if (!q.el.style.minHeight && !q.layout) q.el.style.minHeight = '120px';
    if (!q.el.style.minWidth && !q.layout) q.el.style.minWidth = '120px';
  }

  qtSizeCanvas(q) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = q.el.clientWidth, hh = q.el.clientHeight;
    const pw = Math.round(w * dpr), ph = Math.round(hh * dpr);
    if (q.canvas.width !== pw || q.canvas.height !== ph) {
      q.canvas.width = pw;
      q.canvas.height = ph;
      q.canvas.style.width = `${w}px`;
      q.canvas.style.height = `${hh}px`;
      if (q.lastPaint) this.qtReplay(q, q.lastPaint);
    }
  }

  qtPaint(id, cmds) {
    const q = this.qnodes.get(id);
    if (!q) return;
    this.qtEnsureCanvas(q);
    if (!q.canvas) return;
    q.lastPaint = cmds;
    this.qtSizeCanvas(q);
    this.qtReplay(q, cmds);
  }

  qtReplay(q, cmds) {
    const ctx = q.canvas.getContext('2d');
    const dpr = q.canvas.width / Math.max(1, q.el.clientWidth || 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, q.canvas.width, q.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let pen = { c: '#000', w: 1, s: 1 };
    let brush = null;
    let font = '13px -apple-system, system-ui, sans-serif';
    const applyPen = () => {
      if (!pen) return;
      ctx.strokeStyle = pen.c;
      ctx.lineWidth = Math.max(pen.w || 1, 0.5);
      ctx.lineCap = pen.cap || 'square';
      ctx.lineJoin = pen.join || 'bevel';
      const dashes = { 2: [6, 3], 3: [1.5, 3], 4: [6, 3, 1.5, 3], 5: [6, 3, 1.5, 3, 1.5, 3] }[pen.s];
      ctx.setLineDash(dashes ? dashes.map(d => d * Math.max(1, pen.w)) : []);
    };
    const fillStroke = () => {
      if (brush) { ctx.fillStyle = brush; ctx.fill(); }
      if (pen) { applyPen(); ctx.stroke(); }
    };
    const stack = [];
    for (const c of cmds) {
      const [op, ...a] = c;
      switch (op) {
        case 'reset': pen = { c: '#000', w: 1, s: 1 }; brush = null; break;
        case 'pen': pen = a[0]; break;
        case 'brush': brush = a[0]; break;
        case 'font': font = qtFontCss(a[0]); break;
        case 'alpha': ctx.globalAlpha = a[0]; break;
        case 'save': ctx.save(); stack.push([pen, brush, font]); break;
        case 'restore': ctx.restore(); [pen, brush, font] = stack.pop() || [pen, brush, font]; break;
        case 'translate': ctx.translate(a[0], a[1]); break;
        case 'rotate': ctx.rotate(a[0] * Math.PI / 180); break;
        case 'scale': ctx.scale(a[0], a[1]); break;
        case 'identity': ctx.setTransform(dpr, 0, 0, dpr, 0, 0); break;
        case 'clip': ctx.beginPath(); ctx.rect(a[0], a[1], a[2], a[3]); ctx.clip(); break;
        case 'line': if (pen) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[2], a[3]); applyPen(); ctx.stroke(); } break;
        case 'rect': ctx.beginPath(); ctx.rect(a[0], a[1], a[2], a[3]); fillStroke(); break;
        case 'rrect': ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(a[0], a[1], a[2], a[3], a[4]); else ctx.rect(a[0], a[1], a[2], a[3]); fillStroke(); break;
        case 'fill': ctx.fillStyle = a[4] || '#000'; ctx.fillRect(a[0], a[1], a[2], a[3]); break;
        case 'clear': ctx.clearRect(a[0], a[1], a[2], a[3]); break;
        case 'ellipse': ctx.beginPath(); ctx.ellipse(a[0] + a[2] / 2, a[1] + a[3] / 2, Math.abs(a[2] / 2), Math.abs(a[3] / 2), 0, 0, Math.PI * 2); fillStroke(); break;
        case 'arc': {
          const [x, y, w, hh, start, span, kind] = a;
          ctx.beginPath();
          const cx = x + w / 2, cy = y + hh / 2;
          const s0 = -start * Math.PI / 180, s1 = -(start + span) * Math.PI / 180;
          if (kind === 'pie') ctx.moveTo(cx, cy);
          ctx.ellipse(cx, cy, Math.abs(w / 2), Math.abs(hh / 2), 0, s0, s1, span > 0);
          if (kind === 'pie' || kind === 'chord') { ctx.closePath(); fillStroke(); } else if (pen) { applyPen(); ctx.stroke(); }
          break;
        }
        case 'poly': {
          const pts = a[0];
          if (pts.length < 4) break;
          ctx.beginPath();
          ctx.moveTo(pts[0], pts[1]);
          for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
          if (a[1]) { ctx.closePath(); fillStroke(); } else if (pen) { applyPen(); ctx.stroke(); }
          break;
        }
        case 'point': if (pen) { ctx.fillStyle = pen.c; const w = Math.max(1, pen.w); ctx.fillRect(a[0] - w / 2, a[1] - w / 2, w, w); } break;
        case 'text': ctx.font = font; ctx.fillStyle = pen?.c || '#000'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillText(a[2], a[0], a[1]); break;
        case 'textr': {
          const [x, y, w, hh, flags, text] = a;
          ctx.font = font;
          ctx.fillStyle = pen?.c || '#000';
          ctx.textAlign = flags & 0x4 ? 'center' : flags & 0x2 ? 'right' : 'left';
          ctx.textBaseline = flags & 0x80 ? 'middle' : flags & 0x40 ? 'bottom' : 'top';
          const tx = flags & 0x4 ? x + w / 2 : flags & 0x2 ? x + w : x;
          const ty = flags & 0x80 ? y + hh / 2 : flags & 0x40 ? y + hh : y;
          const lines = String(text).split('\n');
          const lh = parseFloat(/(\d+(\.\d+)?)px/.exec(font)?.[1] || 13) * 1.25;
          lines.forEach((ln, i) => ctx.fillText(ln, tx, ty + (i - (flags & 0x80 ? (lines.length - 1) / 2 : 0)) * lh));
          break;
        }
        case 'path': {
          ctx.beginPath();
          for (const p of a[0]) {
            const [k, ...v] = p;
            if (k === 'M') ctx.moveTo(v[0], v[1]);
            else if (k === 'L') ctx.lineTo(v[0], v[1]);
            else if (k === 'Q') ctx.quadraticCurveTo(v[0], v[1], v[2], v[3]);
            else if (k === 'C') ctx.bezierCurveTo(v[0], v[1], v[2], v[3], v[4], v[5]);
            else if (k === 'Z') ctx.closePath();
            else if (k === 'R') ctx.rect(v[0], v[1], v[2], v[3]);
            else if (k === 'E') ctx.ellipse(v[0] + v[2] / 2, v[1] + v[3] / 2, Math.abs(v[2] / 2), Math.abs(v[3] / 2), 0, 0, Math.PI * 2);
          }
          fillStroke();
          break;
        }
        case 'img': {
          const img = this.images.get(a[0]);
          if (!img) break;
          let im = img.el;
          if (!im) { im = new Image(); im.src = img.url; img.el = im; im.onload = () => this.qtReplay(q, q.lastPaint); }
          if (im.complete) ctx.drawImage(im, a[1], a[2], a[3], a[4]);
          break;
        }
        default: break;
      }
    }
  }
}
