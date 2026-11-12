// Kladde (0.21.0): handwritten notes with the thumb, as a tool of Toollib. The drawing comes from Kladde.html almost
// unchanged (the page above, freely zoomable; tools at thumb height; the writing magnifier at the bottom: the thumb
// writes into an enlarged field that moves as a frame across the page). New: the notes live in your knowledge
// (kladde-store.js, one .md and one .ink per note, by Sync on every device), texts in both languages, Toollib's
// light and dark, PDF and picture without anything from the net, and the handwriting read as LaTeX on the Mac.
// On the phone the command bar makes room while the magnifier is on (decided 01.11.).
import { h, toast, shareOrDownload, loadPref, savePref, copyText, openSheet, modal } from '../services/ui.js';
import { t, getLang } from '../i18n/i18n.js';
import {
  PAGE_W, SHEET_H, MM, GRID, MARGIN, clamp, bboxOf, hit, makeStroke, hitStroke, simplify, roughlyStraight, snapAngle,
  drawStroke, drawPaper, roundRect, contentTop, contentBottom, sheetCount, thumbnail, encodeInk,
} from '../services/ink.js';
import {
  inkNotes, createInkNote, loadInkNote, saveInk, deleteInkNote, setLatex, latexOf, askMac, lupeOf, rememberLupe,
  oldNotes, moveOldNotes, PAPERS,
} from '../services/kladde-store.js';
import { readInk, readerState } from '../services/ink-read.js';
import { isConfigured } from '../services/sync.js';
import { jpegPdf, canvasJpeg } from '../services/pdf-lite.js';
import { typeset, mathReady } from './math.js';

const SMOOTH = 0.45;         // Glättung: 0 = roh … 0.8 = sehr weich
const ZONE = 0.75;           // ab 75 % der Lupenbreite wird weitergerückt
const HOLD_MS = 500;         // so lange ruhen → Linie begradigen
const ERASER_R = 12;         // Radierer-Radius in Bildschirmpunkten
const LIGHT = { paper: '#ffffff', rule: 'rgba(46,96,176,0.22)', dot: 'rgba(46,96,176,0.45)', ink: { ink: '#15171b', blue: '#1f4fd1', red: '#d02b2b', green: '#178a4c' } };
const PREFS = 'kladde.prefs';
const thumbs = new Map();    // path → data URL, for this session

const ICONS = {
  pen: '<path d="M4 20l1.2-4.6L15.6 5a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/><path d="M13.5 7l3.5 3.5"/>',
  eraser: '<path d="M7.5 19.5l-3.7-3.7a1.6 1.6 0 0 1 0-2.3L13 4.3a1.6 1.6 0 0 1 2.3 0l4.4 4.4a1.6 1.6 0 0 1 0 2.3l-8.6 8.5z"/><path d="M8.6 8.7l6.7 6.7"/><path d="M11 19.5h9"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  lupe: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  zout: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5"/>',
  zin: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5M10.5 8v5"/>',
  left: '<path d="M14.5 6l-6 6 6 6"/>', right: '<path d="M9.5 6l6 6-6 6"/>',
  up: '<path d="M6 14.5l6-6 6 6"/>', down: '<path d="M6 9.5l6 6 6-6"/>',
  ret: '<path d="M19 5v6a3 3 0 0 1-3 3H6"/><path d="M10 10l-4 4 4 4"/>',
  more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
  book: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 3.5v17M12.5 8h3.5M12.5 11h3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 12.5h9l1-12.5"/>',
  doc: '<path d="M6.5 3.5h7.5l4 4v13h-11.5z"/><path d="M14 3.5v4h4"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 16l5-5 4 4 2.5-2.5 5.5 5.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  tex: '<path d="M4 7h7M7.5 7v10M13 7l7 10M20 7l-7 10"/>',
};
const ic = (name) => `<svg class="kl-ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

export function renderKladde(main, mod, { go }) {
  main.dataset.view = 'kladde';
  const app = main.closest('.app') || document.body;
  const prefs = { paper: 'grid', width: 2.6, color: 'ink', autoAdvance: true, hintSeen: false, ...(loadPref(PREFS, {}) || {}) };
  const savePrefs = () => savePref(PREFS, { paper: prefs.paper, width: prefs.width, color: prefs.color, autoAdvance: prefs.autoAdvance, hintSeen: prefs.hintSeen });
  const off = [];   // what to undo when the view goes
  const on = (el, ev, fn, opts) => { el.addEventListener(ev, fn, opts); off.push(() => el.removeEventListener(ev, fn, opts)); };

  // ───────── Oberfläche ─────────
  const tb = (name, label, extra = {}) => h('button', { type: 'button', class: 'kl-tb', 'aria-label': label, title: label, html: ic(name), ...extra });
  const lb = (name, label, data) => h('button', { type: 'button', class: 'kl-lb', 'aria-label': label, title: label, html: ic(name), dataset: data });
  const status = h('span', { class: 'kl-status', 'aria-live': 'polite', text: t('kladde.status.new') });
  const titleBtn = h('button', { type: 'button', class: 'kl-title', 'aria-label': t('kladde.rename') });
  const libBtn = h('button', { type: 'button', class: 'kl-libbtn', 'aria-label': t('kladde.allNotes'), html: ic('book') }, h('span', { text: t('kladde.notes') }));
  const menuBtn = tb('more', t('kladde.more'), { 'aria-haspopup': 'true' });
  const stage = h('div', { class: 'kl-stage' });
  const penBtn = tb('pen', t('kladde.pen'), { 'aria-pressed': 'true' });
  const eraserBtn = tb('eraser', t('kladde.eraser'), { 'aria-pressed': 'false' });
  const swatches = h('div', { class: 'kl-swatches' }, ...['ink', 'blue', 'red', 'green'].map((c) => h('button', { type: 'button', class: 'kl-sw', dataset: { color: c }, 'aria-label': t(`kladde.ink.${c}`), style: { '--c': `var(--kl-ink-${c})` } }, h('i'))));
  const undoBtn = tb('undo', t('kladde.undo'), { disabled: true });
  const redoBtn = tb('redo', t('kladde.redo'), { disabled: true });
  const lupeBtn = tb('lupe', t('kladde.lupe'), { 'aria-pressed': 'true' });
  const tools = h('nav', { class: 'kl-bar kl-tools', 'aria-label': t('kladde.tools') }, penBtn, eraserBtn, swatches, h('span', { class: 'kl-grow' }), undoBtn, redoBtn, lupeBtn);
  const readout = h('span', { class: 'kl-readout', title: t('kladde.readout') });
  const lupebar = h('div', { class: 'kl-bar kl-lupebar', 'aria-label': t('kladde.lupeBar') },
    lb('left', t('kladde.step.left'), { step: 'left' }), lb('up', t('kladde.step.up'), { step: 'up' }), lb('down', t('kladde.step.down'), { step: 'down' }),
    lb('right', t('kladde.step.right'), { step: 'right' }), lb('ret', t('kladde.step.newline'), { step: 'newline' }), readout,
    lb('zout', t('kladde.zoomOut'), { zoom: '1.25' }), lb('zin', t('kladde.zoomIn'), { zoom: '0.8' }));
  const hint = h('p', { class: 'kl-hint' }, h('b', { text: t('kladde.hint.title') }), h('span', { text: t('kladde.hint.text') }));
  const padEl = h('div', { class: 'kl-pad' }, hint);
  const scrim = h('div', { class: 'kl-scrim', hidden: true });
  const widthpop = h('div', { class: 'kl-pop kl-widthpop', hidden: true, role: 'dialog', 'aria-label': t('kladde.width') },
    ...[['1.8', 2, 'fine'], ['2.6', 3, 'medium'], ['4', 5, 'thick']].map(([w, px, k]) => h('button', { type: 'button', dataset: { w } }, h('i', { style: { height: `${px}px` } }), h('span', { text: t(`kladde.width.${k}`) }))));
  const rename = h('input', { class: 'kl-field', type: 'text', id: 'kl-rename', autocomplete: 'off', enterkeyhint: 'done', maxlength: '80' });
  const paperSeg = h('div', { class: 'kl-seg' }, ...PAPERS.map((p) => h('button', { type: 'button', dataset: { paper: p } }, h('span', { class: `kl-pv ${p}` }), h('span', { text: t(`kladde.paper.${p}`) }))));
  const auto = h('input', { type: 'checkbox', id: 'kl-auto' });
  const readBtn = h('button', { type: 'button', class: 'kl-act', id: 'kl-read', html: ic('tex') }, h('span', { text: t('kladde.read') }));
  const pdfBtn = h('button', { type: 'button', class: 'kl-act', id: 'kl-pdf', html: ic('doc') }, h('span', { text: t('kladde.pdf') }));
  const pngBtn = h('button', { type: 'button', class: 'kl-act', id: 'kl-png', html: ic('image') }, h('span', { text: t('kladde.png') }));
  const clearBtn = h('button', { type: 'button', class: 'kl-act danger', id: 'kl-clear', html: ic('trash') }, h('span', { text: t('kladde.clear') }));
  const menu = h('div', { class: 'kl-pop kl-menu', hidden: true, role: 'dialog', 'aria-label': t('kladde.settings') },
    h('div', { class: 'kl-sec' }, h('label', { class: 'kl-label', for: 'kl-rename', text: t('kladde.title') }), rename),
    h('div', { class: 'kl-sec' }, h('span', { class: 'kl-label', text: t('kladde.paper') }), paperSeg),
    h('label', { class: 'kl-switch', for: 'kl-auto' }, h('span', { text: t('kladde.auto') }), auto),
    h('div', { class: 'kl-actions' }, readBtn, pdfBtn, pngBtn, clearBtn));
  const libList = h('ul', { class: 'kl-lib-list' });
  const libCount = h('span', { class: 'kl-label' });
  const libEmpty = h('p', { class: 'kl-lib-empty', hidden: true, text: t('kladde.empty') });
  const libOld = h('div', { class: 'kl-lib-old', hidden: true });
  const libClose = tb('close', t('kladde.back'));
  const libNew = h('button', { type: 'button', class: 'kl-fab', id: 'kl-new', html: ic('plus') }, h('span', { text: t('kladde.new') }));
  const library = h('section', { class: 'kl-library', hidden: true, 'aria-label': t('kladde.allNotes') },
    h('div', { class: 'kl-lib-head' }, h('div', {}, h('h1', { text: t('module.kladde.name') }), libCount), libClose),
    libOld, libList, libEmpty,
    h('div', { class: 'kl-lib-foot' }, h('span', { class: 'kl-sync', text: t('kladde.where') }), libNew));
  const root = h('div', { class: 'kl' },
    h('header', { class: 'kl-bar kl-top' }, libBtn, titleBtn, status, menuBtn),
    stage, tools, lupebar, padEl, scrim, widthpop, menu, library);
  main.append(root);

  // ───────── Zustand ─────────
  let note = null;             // { path, title, created, paper, lupe, strokes, text }
  let live = null;             // Strich, der gerade entsteht
  let tool = 'pen';
  let lupeOn = true;
  let padAspect = 1.3;
  let pal = null;
  let dirty = false, saveT = 0, advanceT = 0, alive = true;
  let saving = Promise.resolve();
  const undoStack = [], redoStack = [];
  const locale = () => (getLang() === 'de' ? 'de-DE' : 'en-GB');

  function readPalette() {
    const cs = getComputedStyle(root);
    const g = (n) => cs.getPropertyValue(n).trim();
    pal = { desk: g('--kl-desk'), paper: g('--kl-paper'), rule: g('--kl-rule'), dot: g('--kl-dot'), lupe: g('--kl-lupe'), lupeSoft: g('--kl-lupe-soft'), fg2: g('--kl-fg-2'),
      ink: { ink: g('--kl-ink-ink'), blue: g('--kl-ink-blue'), red: g('--kl-ink-red'), green: g('--kl-ink-green') } };
  }

  // ───────── Zeichenfläche (Seite oder Lupen-Schreibfeld) ─────────
  let rafId = 0;
  const schedule = () => { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; if (alive) { page.render(); pad.render(); } }); };
  const invalidateOverlays = () => { page.invalidate(false); pad.invalidate(false); };
  const invalidateBases = () => { page.invalidate(true); pad.invalidate(true); };
  const coalesced = (e) => { const l = e.getCoalescedEvents ? e.getCoalescedEvents() : null; return l && l.length ? l : [e]; };
  const pageHeight = () => Math.max(SHEET_H, contentBottom(note.strokes) + 600, note.lupe.y + note.lupe.h + 600);

  class Surface {
    constructor(host, role) {
      this.host = host; this.role = role;
      this.base = document.createElement('canvas');   // Papier + fertige Striche
      this.over = document.createElement('canvas');   // Live-Strich, Lupenrahmen, Radierer
      this.base.setAttribute('aria-hidden', 'true');
      this.over.setAttribute('role', 'img');
      this.over.setAttribute('aria-label', role === 'page' ? t('kladde.page') : t('kladde.padLabel'));
      host.prepend(this.base, this.over);
      this.bctx = this.base.getContext('2d');
      this.octx = this.over.getContext('2d');
      this.w = 0; this.h = 0; this.dpr = 1; this.fitW = 0;
      this.s = 0.4; this.ox = 0; this.oy = 0;          // nur Seite: Bildschirm = (Seite − o) · s
      this.dirtyBase = true; this.dirtyOver = true;
      this.ptrs = new Map(); this.mode = 'idle';
      this.start = null; this.last = null; this.anchor = null; this.smooth = null;
      this.straight = false; this.holdT = 0; this.erased = []; this.eraser = null; this.pinch = null; this.rect = null;
      const o = this.over;
      o.addEventListener('pointerdown', (e) => this.down(e));
      o.addEventListener('pointermove', (e) => this.move(e));
      o.addEventListener('pointerup', (e) => this.up(e, false));
      o.addEventListener('pointercancel', (e) => this.up(e, true));
      o.addEventListener('lostpointercapture', (e) => { if (this.ptrs.has(e.pointerId)) this.up(e, true); });
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(host);
      off.push(() => this.ro.disconnect());
    }

    get vs() { return this.role === 'page' ? this.s : (this.w || 1) / note.lupe.w; }
    get vx() { return this.role === 'page' ? this.ox : note.lupe.x; }
    get vy() { return this.role === 'page' ? this.oy : note.lupe.y; }
    toPage(x, y) { const s = this.vs; return [x / s + this.vx, y / s + this.vy]; }
    local(e) { const r = this.rect || (this.rect = this.over.getBoundingClientRect()); return [e.clientX - r.left, e.clientY - r.top]; }
    invalidate(base = true) { if (base) this.dirtyBase = true; this.dirtyOver = true; schedule(); }

    resize() {
      if (!note) return;
      const r = this.host.getBoundingClientRect();
      const w = Math.round(r.width), hh = Math.round(r.height);
      this.rect = null;
      if (w < 2 || hh < 2) { this.w = 0; return; }
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      if (w !== this.w || hh !== this.h || dpr !== this.dpr) {
        this.w = w; this.h = hh; this.dpr = dpr;
        for (const cv of [this.base, this.over]) {
          cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
          cv.style.width = `${w}px`; cv.style.height = `${hh}px`;
        }
      }
      if (this.role === 'page') {
        if (Math.abs(w - this.fitW) > 0.5) this.fit();
        this.clampView();
        if (lupeOn) this.reveal();
      } else {
        padAspect = w / hh;
        note.lupe.h = note.lupe.w / padAspect;
        if (page) page.invalidate(false);
        updateReadout();
      }
      this.invalidate();
    }

    fit() {
      this.fitW = this.w;
      this.s = this.w / PAGE_W;
      this.ox = 0;
      this.oy = Math.max(0, note.lupe.y - 3 * GRID);
    }

    clampView() {
      if (this.role !== 'page' || !this.w) return;
      const vw = this.w / this.s, vh = this.h / this.s, ph = pageHeight();
      this.ox = vw >= PAGE_W ? (PAGE_W - vw) / 2 : clamp(this.ox, 0, PAGE_W - vw);
      this.oy = vh >= ph ? 0 : clamp(this.oy, 0, ph - vh);
    }

    // Seite so schieben, dass der Lupenrahmen sichtbar bleibt
    reveal() {
      if (this.role !== 'page' || !this.w || !lupeOn) return;
      const L = note.lupe, s = this.s, m = 24 / s;
      const vx0 = this.ox, vy0 = this.oy, vw = this.w / s, vh = this.h / s;
      let ox = this.ox, oy = this.oy;
      if (L.y + L.h + m > vy0 + vh) oy = L.y + L.h + m - vh;
      if (L.y - m < vy0) oy = L.y - m;
      if (L.x + L.w + m > vx0 + vw) ox = L.x + L.w + m - vw;
      if (L.x - m < vx0) ox = L.x - m;
      if (ox !== this.ox || oy !== this.oy) { this.ox = ox; this.oy = oy; this.clampView(); this.invalidate(); }
    }

    render() {
      if (!this.w || !note) return;
      const d = this.dpr, s = this.vs, vx = this.vx, vy = this.vy, k = d * s;
      if (this.dirtyBase) {
        this.dirtyBase = false;
        const c = this.bctx;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.fillStyle = pal.desk;
        c.fillRect(0, 0, this.base.width, this.base.height);
        c.setTransform(k, 0, 0, k, -vx * k, -vy * k);
        const vis = { x0: vx, y0: vy, x1: vx + this.w / s, y1: vy + this.h / s };
        drawPaper(c, note.paper, vis, pageHeight(), 0.6 / s, pal);
        for (const st of note.strokes) if (hit(st.b, vis)) drawStroke(c, st, pal.ink);
      }
      if (this.dirtyOver) {
        this.dirtyOver = false;
        const c = this.octx;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, this.over.width, this.over.height);
        if (live) { c.setTransform(k, 0, 0, k, -vx * k, -vy * k); drawStroke(c, live, pal.ink, 0, true); }
        c.setTransform(d, 0, 0, d, 0, 0);
        if (this.role === 'page' && lupeOn) this.drawLupe(c);
        if (this.role === 'pad' && prefs.autoAdvance) this.drawZone(c);
        if (this.eraser) {
          c.strokeStyle = pal.fg2; c.lineWidth = 1;
          c.beginPath(); c.arc(this.eraser.x, this.eraser.y, ERASER_R, 0, Math.PI * 2); c.stroke();
        }
      }
    }

    // Neuer Strich direkt auf die Basis – spart das komplette Neuzeichnen
    addToBase(st) {
      if (this.dirtyBase || !this.w) return;
      const k = this.dpr * this.vs;
      this.bctx.setTransform(k, 0, 0, k, -this.vx * k, -this.vy * k);
      drawStroke(this.bctx, st, pal.ink);
    }

    drawLupe(c) {
      const L = note.lupe, s = this.s;
      const x = (L.x - this.ox) * s, y = (L.y - this.oy) * s, w = L.w * s, hh = L.h * s;
      c.fillStyle = pal.lupeSoft; c.strokeStyle = pal.lupe; c.lineWidth = 1.5;
      roundRect(c, x, y, w, hh, 4); c.fill(); c.stroke();
      if (prefs.autoAdvance) {
        const zx = x + w * ZONE;
        c.setLineDash([3, 3]); c.lineWidth = 1;
        c.beginPath(); c.moveTo(zx, y + 3); c.lineTo(zx, y + hh - 3); c.stroke();
        c.setLineDash([]);
      }
    }

    drawZone(c) {
      const x = Math.round(this.w * ZONE) + 0.5;
      c.fillStyle = pal.lupeSoft; c.fillRect(x, 0, this.w - x, this.h);
      c.strokeStyle = pal.lupe; c.globalAlpha = 0.55; c.lineWidth = 1; c.setLineDash([4, 4]);
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, this.h); c.stroke();
      c.setLineDash([]); c.globalAlpha = 1;
    }

    // ── Eingabe ──
    down(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      // Erster Finger einer neuen Berührung: verwaiste Pointer (ohne „up“) vergessen
      if (e.isPrimary && this.ptrs.size) { this.ptrs.clear(); this.mode = 'idle'; this.pinch = null; }
      try { this.over.setPointerCapture(e.pointerId); } catch { /* nicht nötig */ }
      this.rect = this.over.getBoundingClientRect();
      const [x, y] = this.local(e);
      this.ptrs.set(e.pointerId, { x, y });
      closePopovers();
      if (this.ptrs.size >= 2) {
        this.cancel();                                   // zweiter Finger = Navigation
        if (this.role === 'page') this.startPinch(); else this.mode = 'ignore';
        return;
      }
      if (this.mode !== 'idle') return;
      this.start = { x, y }; this.last = { x, y };
      if (this.role === 'page' && lupeOn) {
        // Mit Lupe ist die Seite zum Navigieren da: Rahmen ziehen, Seite schieben, Tippen setzt die Lupe
        const [px, py] = this.toPage(x, y), L = note.lupe, m = 14 / this.s;
        const inside = px >= L.x - m && px <= L.x + L.w + m && py >= L.y - m && py <= L.y + L.h + m;
        this.mode = inside ? 'lupe' : 'pan';
        return;
      }
      if (tool === 'eraser') { this.mode = 'erase'; this.erased = []; this.eraser = null; this.eraseAt(x, y); return; }
      this.beginStroke(x, y);
    }

    move(e) {
      if (!this.ptrs.has(e.pointerId)) return;
      e.preventDefault();
      const [x, y] = this.local(e);
      this.ptrs.set(e.pointerId, { x, y });
      switch (this.mode) {
        case 'pinch': this.updatePinch(); break;
        case 'draw': for (const ev of coalesced(e)) { const [cx, cy] = this.local(ev); this.addSample(cx, cy); } break;
        case 'erase': for (const ev of coalesced(e)) { const [cx, cy] = this.local(ev); this.eraseAt(cx, cy); } break;
        case 'lupe':
          moveLupe((x - this.last.x) / this.s, (y - this.last.y) / this.s);
          this.last = { x, y };
          break;
        case 'pan':
          this.ox -= (x - this.last.x) / this.s; this.oy -= (y - this.last.y) / this.s;
          this.last = { x, y };
          this.clampView(); this.invalidate();
          break;
        default:
      }
    }

    up(e, cancelled) {
      if (!this.ptrs.has(e.pointerId)) return;
      const [x, y] = this.local(e);
      this.ptrs.delete(e.pointerId);
      if (cancelled) this.cancel();
      else if (this.mode === 'draw') this.finishStroke(x, y);
      else if (this.mode === 'erase') this.finishErase();
      else if (this.mode === 'pan' && Math.hypot(x - this.start.x, y - this.start.y) < 8) {
        const [px, py] = this.toPage(x, y);
        placeLupe(px, py);
      }
      this.mode = this.ptrs.size ? 'ignore' : 'idle';
      if (!this.ptrs.size) this.pinch = null;
    }

    cancel() {
      clearTimeout(this.holdT);
      if (this.mode === 'draw' && live) { live = null; invalidateOverlays(); }
      if (this.mode === 'erase') this.finishErase();
      this.mode = 'ignore';
    }

    startPinch() {
      const [a, b] = [...this.ptrs.values()];
      this.pinch = { d0: Math.hypot(b.x - a.x, b.y - a.y) || 1, s0: this.s, anchor: this.toPage((a.x + b.x) / 2, (a.y + b.y) / 2) };
      this.mode = 'pinch';
    }

    updatePinch() {
      const [a, b] = [...this.ptrs.values()];
      if (!a || !b || !this.pinch) return;
      const fit = this.w / PAGE_W;
      this.s = clamp(this.pinch.s0 * Math.hypot(b.x - a.x, b.y - a.y) / this.pinch.d0, fit * 0.6, fit * 10);
      this.ox = this.pinch.anchor[0] - (a.x + b.x) / 2 / this.s;
      this.oy = this.pinch.anchor[1] - (a.y + b.y) / 2 / this.s;
      this.clampView(); this.invalidate();
    }

    // ── Schreiben ──
    beginStroke(x, y) {
      this.mode = 'draw';
      this.straight = false;
      this.anchor = { x, y };
      const [px, py] = this.toPage(x, y);
      this.smooth = [px, py];
      live = makeStroke([px, py], prefs.width, prefs.color);
      if (this.role === 'pad') { cancelAdvance(); hideHint(); }
      this.scheduleHold();
      invalidateOverlays();
    }

    addSample(x, y) {
      if (!live || Math.hypot(x - this.last.x, y - this.last.y) < 0.5) return;
      this.last = { x, y };
      if (Math.hypot(x - this.anchor.x, y - this.anchor.y) > 5) { this.anchor = { x, y }; this.scheduleHold(); }
      const [rx, ry] = this.toPage(x, y);
      if (this.straight) {
        // eingerastet: nur noch der Endpunkt folgt dem Finger
        const sx = live.pts[0], sy = live.pts[1];
        live.pts = [sx, sy, ...snapAngle(sx, sy, rx, ry)];
        live.b = bboxOf(live.pts, live.w);
      } else {
        // exponentielle Glättung filtert das Zittern des Daumens heraus
        const a = 1 - SMOOTH;
        this.smooth[0] += a * (rx - this.smooth[0]);
        this.smooth[1] += a * (ry - this.smooth[1]);
        live.pts.push(this.smooth[0], this.smooth[1]);
      }
      invalidateOverlays();
    }

    scheduleHold() {
      clearTimeout(this.holdT);
      if (this.mode === 'draw' && !this.straight) this.holdT = setTimeout(() => this.holdFired(), HOLD_MS);
    }

    holdFired() {
      if (this.mode !== 'draw' || this.straight || !live || live.pts.length < 6) return;
      const sx = live.pts[0], sy = live.pts[1];
      const [ex, ey] = this.toPage(this.last.x, this.last.y);
      if (Math.hypot(ex - sx, ey - sy) * this.vs < 28) return;
      if (!roughlyStraight([...live.pts, ex, ey], 4 / this.vs)) return;
      live.pts = [sx, sy, ...snapAngle(sx, sy, ex, ey)];
      live.b = bboxOf(live.pts, live.w);
      this.straight = true;
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch { /* kein Vibrieren */ } }
      invalidateOverlays();
    }

    finishStroke(x, y) {
      clearTimeout(this.holdT);
      const st = live;
      live = null;
      if (!st) return;
      if (!this.straight) {
        // Glättung hinkt minimal hinterher → bis zum echten Endpunkt ziehen
        const [rx, ry] = this.toPage(x, y), p = st.pts, n = p.length;
        if (Math.hypot(rx - p[n - 2], ry - p[n - 1]) * this.vs > 0.5) p.push(rx, ry);
        st.pts = simplify(p, Math.max(0.05, 0.25 / this.vs));
      }
      st.b = bboxOf(st.pts, st.w);
      addStrokes([st], true);
      if (this.role === 'pad') padStrokeEnded(st);
    }

    // ── Radieren (ganze Striche) ──
    eraseAt(x, y) {
      const pts = [];
      if (this.eraser) {
        const dx = x - this.eraser.x, dy = y - this.eraser.y;
        const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (ERASER_R * 0.8)));
        for (let i = 1; i <= n; i++) pts.push([this.eraser.x + dx * i / n, this.eraser.y + dy * i / n]);
      } else pts.push([x, y]);
      const r = ERASER_R / this.vs;
      const removed = [];
      for (const [ex, ey] of pts) {
        const [px, py] = this.toPage(ex, ey);
        const hits = note.strokes.filter((s) => hitStroke(s, px, py, r));
        if (hits.length) {
          const set = new Set(hits);
          note.strokes = note.strokes.filter((s) => !set.has(s));
          removed.push(...hits);
        }
      }
      if (removed.length) { this.erased.push(...removed); invalidateBases(); }
      this.eraser = { x, y };
      this.invalidate(false);
    }

    finishErase() {
      if (this.erased.length) { pushUndo({ t: 'remove', s: this.erased }); markDirty(); }
      this.erased = []; this.eraser = null;
      this.invalidate(false);
    }
  }

  // ───────── Striche & Rückgängig ─────────
  function addStrokes(list, record) {
    note.strokes.push(...list);
    for (const st of list) { page.addToBase(st); pad.addToBase(st); }
    if (record) pushUndo({ t: 'add', s: list });
    invalidateOverlays();
    markDirty();
  }
  function removeStrokes(list) {
    const set = new Set(list);
    note.strokes = note.strokes.filter((s) => !set.has(s));
    invalidateBases();
    markDirty();
  }
  function pushUndo(a) {
    undoStack.push(a);
    if (undoStack.length > 300) undoStack.shift();
    redoStack.length = 0;
    updateUndo();
  }
  function undo() {
    const a = undoStack.pop();
    if (!a) return;
    if (a.t === 'add') removeStrokes(a.s); else addStrokes(a.s, false);
    redoStack.push(a);
    updateUndo();
  }
  function redo() {
    const a = redoStack.pop();
    if (!a) return;
    if (a.t === 'add') addStrokes(a.s, false); else removeStrokes(a.s);
    undoStack.push(a);
    updateUndo();
  }
  function updateUndo() { undoBtn.disabled = !undoStack.length; redoBtn.disabled = !redoStack.length; }

  // ───────── Schreiblupe ─────────
  function setLupe(L, reveal = true) {
    L.w = clamp(L.w, 90, 520);
    L.h = L.w / padAspect;
    L.x = clamp(L.x, 0, PAGE_W - L.w);
    L.y = Math.max(0, L.y);
    note.lupe = L;
    pad.invalidate();
    page.invalidate(false);
    if (reveal) page.reveal();
    updateReadout();
    if (note.path) rememberLupe(note.path, L);
  }
  function moveLupe(dx, dy) { cancelAdvance(); const L = note.lupe; setLupe({ x: L.x + dx, y: L.y + dy, w: L.w, h: L.h }, false); }
  function placeLupe(px, py) { cancelAdvance(); const L = note.lupe; setLupe({ x: px - L.w * 0.1, y: py - L.h / 2, w: L.w, h: L.h }); }
  function stepLupe(dir) {
    cancelAdvance();
    if (dir === 'right') return advance();
    if (dir === 'newline') return newline();
    const L = { ...note.lupe };
    if (dir === 'left') L.x -= L.w * 0.5;
    if (dir === 'up') L.y -= GRID;
    if (dir === 'down') L.y += GRID;
    return setLupe(L);
  }
  function zoomLupe(f) {
    cancelAdvance();
    const L = { ...note.lupe }, mid = L.y + L.h / 2;
    L.w = clamp(L.w * f, 90, 520);
    L.h = L.w / padAspect;
    L.y = mid - L.h / 2;
    setLupe(L);
  }
  function advance() {
    const L = { ...note.lupe };
    if (L.x + L.w >= PAGE_W - 1) return newline();
    L.x += L.w * 0.55;
    return setLupe(L);
  }
  function newline() {
    const L = { ...note.lupe };
    L.x = MARGIN;
    L.y = Math.round((L.y + L.h) / GRID) * GRID;
    setLupe(L);
  }
  function cancelAdvance() { clearTimeout(advanceT); }
  // Endet ein Strich im rechten Viertel, rückt die Lupe kurz danach weiter – außer du setzt vorher schon den nächsten an.
  function padStrokeEnded(st) {
    if (!prefs.autoAdvance || !lupeOn) return;
    const L = note.lupe;
    if (st.b.x1 - st.w <= L.x + L.w * ZONE) return;
    cancelAdvance();
    advanceT = setTimeout(advance, 650);
  }
  function updateReadout() { const L = note.lupe; readout.textContent = `${Math.round(L.w * MM)} × ${Math.round(L.h * MM)} mm`; }
  function setLupeOn(v) {
    lupeOn = v;
    lupebar.hidden = !v;
    padEl.hidden = !v;
    lupeBtn.classList.toggle('on', v);
    lupeBtn.setAttribute('aria-pressed', String(v));
    app.dataset.kladdeLupe = v ? '1' : '';
    cancelAdvance();
    page.invalidate(false);
  }

  // ───────── Notizen öffnen & sichern ─────────
  const defaultTitle = (d) => t('kladde.defaultTitle', { date: `${d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}` });
  const freshNote = () => ({ path: '', title: defaultTitle(new Date()), created: Date.now(), paper: prefs.paper, lupe: { x: MARGIN, y: GRID * 2, w: 170, h: 170 / padAspect }, strokes: [], text: '' });

  function setNote(n) {
    note = n;
    live = null;
    undoStack.length = 0; redoStack.length = 0;
    dirty = false;
    updateUndo();
    note.lupe.h = note.lupe.w / padAspect;
    page.fitW = 0;
    page.resize();
    pad.resize();
    updateTitle();
    updateReadout();
    updateMenu();
    setStatus(n.path ? (n.inkRead === 'mac' ? t('kladde.waitsMac') : t('kladde.status.saved')) : t('kladde.status.new'));
    invalidateBases();
    savePref('kladde.last', n.path || '');
  }

  function markDirty() {
    dirty = true;
    clearTimeout(saveT);
    saveT = setTimeout(saveNow, 1200);
  }

  // One save after the other; a new note is written once it has strokes.
  function saveNow() {
    clearTimeout(saveT);
    if (!dirty) return saving;
    dirty = false;
    const n = note;
    if (!n.strokes.length && !n.path) return saving;
    const strokes = n.strokes.slice();
    if (encodeInk(strokes).length > 600000) toast(t('kladde.full'), 'info', 5000);
    saving = saving.then(async () => {
      if (alive) setStatus(t('kladde.status.saving'));
      try {
        if (!n.path) {
          n.path = await createInkNote({ title: n.title, paper: n.paper, strokes });
          rememberLupe(n.path, n.lupe);
          if (n === note) savePref('kladde.last', n.path);
        } else await saveInk(n.path, { title: n.title, paper: n.paper, strokes });
        thumbs.delete(n.path);
        if (alive && n === note) setStatus(t('kladde.status.saved'));
      } catch (e) {
        console.warn('Kladde:', e);
        if (alive) setStatus(t('kladde.status.notSaved'));
        dirty = true;
      }
    });
    return saving;
  }

  async function leaveNote() {
    cancelAdvance();
    if (!note) return;
    if (!note.strokes.length && note.path && !String(note.text || '').trim()) {
      clearTimeout(saveT); dirty = false;
      const p = note.path;
      await saving;
      await deleteInkNote(p).catch(() => {});   // leere Notizen nicht aufheben
      return;
    }
    await saveNow();
  }

  async function openNote(path) {
    if (note && path === note.path) { closeLibrary(); return; }
    await leaveNote();
    setStatus(t('kladde.status.loading'));
    let n;
    try { n = await loadInkNote(path); } catch { n = null; }
    if (!alive) return;
    if (!n) { toast(t('node.notFound'), 'error'); setNote(freshNote()); return; }
    const l = lupeOf(path) || { x: MARGIN, y: GRID * 2, w: 170 };
    setNote({ path, title: n.title || defaultTitle(new Date()), created: Date.parse(n.at) || Date.now(), paper: n.paper, lupe: { x: l.x, y: l.y, w: l.w || 170, h: 0 }, strokes: n.strokes, text: n.text, inkRead: n.inkRead });
    closeLibrary();
  }

  async function startNewNote() {
    await leaveNote();
    setNote(freshNote());
    closeLibrary();
  }

  // ───────── Export (PDF / Bild) ─────────
  const safeName = (s) => (s || 'Notiz').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'Notiz';

  async function exportPDF() {
    closePopovers();
    if (!note.strokes.length) { toast(t('kladde.emptyPage')); return; }
    toast(t('kladde.pdfMaking'), 'info', 20000);
    try {
      const pxW = 1654, k = pxW / PAGE_W, pxH = Math.round(SHEET_H * k);   // ≈ 200 dpi
      const cv = document.createElement('canvas');
      cv.width = pxW; cv.height = pxH;
      const c = cv.getContext('2d');
      const pages = [];
      for (let i = 0; i < sheetCount(note.strokes); i++) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.fillStyle = '#fff'; c.fillRect(0, 0, pxW, pxH);
        c.setTransform(k, 0, 0, k, 0, -i * SHEET_H * k);
        const vis = { x0: 0, y0: i * SHEET_H, x1: PAGE_W, y1: (i + 1) * SHEET_H };
        drawPaper(c, note.paper, vis, vis.y1, 0.9, LIGHT);
        for (const s of note.strokes) if (hit(s.b, vis)) drawStroke(c, s, LIGHT.ink);
        pages.push({ jpeg: await canvasJpeg(cv, 0.92), px: pxW, py: pxH });
      }
      await shareOrDownload(jpegPdf(pages, { title: note.title }), `${safeName(note.title)}.pdf`);
    } catch (e) {
      console.warn('Kladde:', e);
      toast(t('kladde.pdfFailed'), 'error');
    }
  }

  async function exportPNG() {
    closePopovers();
    if (!note.strokes.length) { toast(t('kladde.emptyPage')); return; }
    const top = Math.max(0, contentTop(note.strokes) - 40), bottom = contentBottom(note.strokes) + 40;
    const hh = bottom - top;
    let k = 2;
    if (PAGE_W * k * hh * k > 16e6) k = Math.sqrt(16e6 / (PAGE_W * hh));
    const cv = document.createElement('canvas');
    cv.width = Math.round(PAGE_W * k); cv.height = Math.round(hh * k);
    const c = cv.getContext('2d');
    c.setTransform(k, 0, 0, k, 0, -top * k);
    const vis = { x0: 0, y0: top, x1: PAGE_W, y1: bottom };
    drawPaper(c, note.paper, vis, bottom, 0.8, LIGHT);
    for (const s of note.strokes) if (hit(s.b, vis)) drawStroke(c, s, LIGHT.ink);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    if (!blob) { toast(t('kladde.pngFailed'), 'error'); return; }
    await shareOrDownload(blob, `${safeName(note.title)}.png`);
  }

  // ───────── Handschrift lesen ─────────
  async function readHandwriting() {
    closePopovers();
    if (!note.strokes.length) { toast(t('kladde.emptyPage')); return; }
    await saveNow();
    await saving;
    if (!alive || !note.path) return;
    const st = await readerState();
    if (!st.ok) { await cannotRead(st.reason); return; }
    toast(t('kladde.reading'), 'info', 30000);
    let results;
    try { results = await readInk(note.strokes); } catch (e) {
      console.warn('Kladde:', e);
      await cannotRead(e?.code === 'helper' ? 'unreachable' : 'not-installed');
      return;
    }
    toast(t('kladde.status.saved'), 'ok', 600);
    showReading(results);
  }

  async function cannotRead(reason) {
    const text = reason === 'no-helper' ? t('kladde.noHelper.none') : reason === 'unreachable' ? t('kladde.noHelper.away') : t('kladde.noHelper.install');
    const actions = [{ label: t('action.cancel'), value: null }];
    if (reason === 'unreachable' && isConfigured()) actions.push({ label: t('kladde.askMac'), kind: 'primary', value: 'mac' });
    if (reason === 'no-helper') actions.push({ label: t('kladde.toSettings'), kind: 'primary', value: 'settings' });
    const v = await modal({ title: t('kladde.noHelper.title'), body: h('p', { text }), actions });
    if (v === 'settings') go('#/settings/access');
    if (v === 'mac' && note.path) { await askMac(note.path); note.inkRead = 'mac'; setStatus(t('kladde.waitsMac')); toast(t('kladde.askedMac'), 'ok', 4000); }
  }

  async function showReading(results) {
    const box = h('div', { class: 'kl-reading' }, h('p', { class: 'muted small', text: t('kladde.readHint') }));
    const fields = [];
    if (!results.length) box.append(h('p', { class: 'muted', text: t('kladde.readNone') }));
    await mathReady().catch(() => {});
    results.forEach((r, i) => {
      const preview = h('div', { class: 'kl-tex' });
      const input = h('textarea', { class: 'field kl-tex-src', rows: '2', spellcheck: 'false', autocapitalize: 'off', 'aria-label': t('kladde.readLine', { n: i + 1 }) });
      input.value = r.latex;
      const draw = () => { preview.replaceChildren(); if (input.value.trim()) typeset(preview, input.value.trim(), true); else preview.append(h('span', { class: 'muted', text: t('kladde.readError') })); };
      input.addEventListener('input', draw);
      draw();
      fields.push(input);
      box.append(h('div', { class: 'kl-tex-row' }, h('span', { class: 'kl-label', text: t('kladde.readLine', { n: i + 1 }) }), preview, input));
    });
    const lines = () => fields.map((f) => f.value.trim()).filter(Boolean);
    const copy = h('button', { type: 'button', class: 'btn', id: 'kl-read-copy', text: t('kladde.readCopy') });
    const into = h('button', { type: 'button', class: 'btn primary', id: 'kl-read-into', text: t('kladde.readInto') });
    if (results.length) box.append(h('div', { class: 'btn-row kl-read-actions' }, copy, into));
    const sheet = openSheet(t('kladde.readTitle'), box);
    copy.addEventListener('click', () => copyText(lines().map((l) => `$$${l}$$`).join('\n')).then((ok) => ok && toast(t('node.copied'), 'ok')));
    into.addEventListener('click', async () => {
      const p = note.path;
      into.disabled = true;
      try {
        await setLatex(p, lines());
        if (note.path === p) { const n = await loadInkNote(p).catch(() => null); if (n) { note.text = n.text; note.inkRead = ''; } setStatus(t('kladde.status.saved')); }
        toast(t('kladde.readSaved'), 'ok');
        sheet.close();
      } catch (e) { console.warn('Kladde:', e); into.disabled = false; toast(t('kladde.status.notSaved'), 'error'); }
    });
  }

  // ───────── Oberfläche ─────────
  function setStatus(s) { status.textContent = s; }
  function hideHint() {
    if (prefs.hintSeen) return;
    hint.hidden = true;
    prefs.hintSeen = true; savePrefs();
  }
  function setTool(v) {
    tool = v;
    for (const [b, name] of [[penBtn, 'pen'], [eraserBtn, 'eraser']]) { b.classList.toggle('on', v === name); b.setAttribute('aria-pressed', String(v === name)); }
    updateSwatches();
  }
  function updateSwatches() {
    for (const b of swatches.children) {
      const sel = tool === 'pen' && b.dataset.color === prefs.color;
      b.classList.toggle('on', sel);
      b.setAttribute('aria-pressed', String(sel));
    }
  }
  function updateWidth() { for (const b of widthpop.children) b.classList.toggle('on', +b.dataset.w === prefs.width); }
  function updateTitle() { titleBtn.textContent = note.title; }
  function updateMenu() {
    rename.value = note.title;
    for (const b of paperSeg.children) b.classList.toggle('on', b.dataset.paper === note.paper);
    auto.checked = prefs.autoAdvance;
    disarmClear();
  }
  function openPop(el) { closePopovers(); el.hidden = false; scrim.hidden = false; }
  function closePopovers() {
    if (menu.hidden && widthpop.hidden) return;
    menu.hidden = true; widthpop.hidden = true; scrim.hidden = true;
    if (root.contains(document.activeElement)) document.activeElement.blur?.();
  }
  let clearArmed = false;
  function disarmClear() { clearArmed = false; clearBtn.classList.remove('armed'); clearBtn.querySelector('span').textContent = t('kladde.clear'); }

  function openLibrary() {
    closePopovers();
    saveNow();
    renderLibrary();
    library.hidden = false;
  }
  function closeLibrary() { library.hidden = true; }

  function renderLibrary() {
    const list = inkNotes();
    libList.replaceChildren();
    libCount.textContent = list.length === 1 ? t('kladde.count1') : t('kladde.count', { n: list.length });
    libEmpty.hidden = list.length > 0;
    const old = oldNotes();
    libOld.hidden = !old.length;
    if (old.length) {
      const take = h('button', { type: 'button', class: 'btn small primary', text: t('kladde.oldMove') });
      take.addEventListener('click', async () => {
        take.disabled = true;
        const moved = await moveOldNotes();
        toast(t('kladde.oldMoved', { n: moved.length }), 'ok');
        renderLibrary();
      });
      libOld.replaceChildren(h('span', { text: t('kladde.old', { n: old.length }) }), take);
    }
    for (const d of list) {
      const li = h('li', { class: 'kl-row' });
      const th = h('span', { class: 'kl-thumb' });
      const paint = (url) => { if (url) th.replaceChildren(h('i', { style: { '--m': `url("${url}")` } })); };
      if (thumbs.has(d.path)) paint(thumbs.get(d.path));
      else loadInkNote(d.path).then((n) => { const url = thumbnail(n.strokes, { w: 156, h: 112, color: '#000' }); thumbs.set(d.path, url); paint(url); }).catch(() => {});
      const when = d.at ? new Date(d.at) : null;
      const meta = h('span', { class: 'kl-row-meta', text: when && !Number.isNaN(when.getTime()) ? when.toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '' });
      if (d.inkRead === 'mac') meta.append(h('em', { text: ` · ${t('kladde.waitsMac')}` }));
      if (note && d.path === note.path) meta.append(h('em', { text: ` · ${t('kladde.open')}` }));
      const open = h('button', { type: 'button', class: 'kl-row-open' }, th, h('span', { class: 'kl-row-text' }, h('span', { class: 'kl-row-title', text: d.title || t('type.note') }), meta));
      open.addEventListener('click', () => openNote(d.path));
      const del = tb('trash', t('kladde.delete'));
      del.classList.add('kl-row-del');
      del.addEventListener('click', () => {
        const no = h('button', { type: 'button', class: 'kl-pill', text: t('kladde.keep') });
        const yes = h('button', { type: 'button', class: 'kl-pill danger', text: t('kladde.deleteYes') });
        const conf = h('div', { class: 'kl-row-confirm' }, h('span', { text: t('kladde.deleteAsk', { title: d.title || t('type.note') }) }), no, yes);
        no.addEventListener('click', () => conf.remove());
        yes.addEventListener('click', async () => {
          if (note && d.path === note.path) { clearTimeout(saveT); dirty = false; await saving; setNote(freshNote()); }
          await deleteInkNote(d.path).catch((e) => console.warn(e));
          thumbs.delete(d.path);
          toast(t('kladde.deleted'), 'ok');
          renderLibrary();
        });
        li.append(conf);
        yes.focus();
      });
      li.append(open, del);
      libList.append(li);
    }
  }

  // ───────── Verdrahtung ─────────
  readPalette();
  note = freshNote();
  const page = new Surface(stage, 'page');
  const pad = new Surface(padEl, 'pad');

  penBtn.addEventListener('click', () => {
    if (tool === 'pen') { if (widthpop.hidden) openPop(widthpop); else closePopovers(); } else setTool('pen');
  });
  eraserBtn.addEventListener('click', () => setTool('eraser'));
  for (const b of swatches.children) b.addEventListener('click', () => { prefs.color = b.dataset.color; savePrefs(); setTool('pen'); });
  for (const b of widthpop.children) b.addEventListener('click', () => { prefs.width = +b.dataset.w; savePrefs(); updateWidth(); setTool('pen'); closePopovers(); });
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  lupeBtn.addEventListener('click', () => setLupeOn(!lupeOn));
  for (const b of lupebar.querySelectorAll('[data-step]')) b.addEventListener('click', () => stepLupe(b.dataset.step));
  for (const b of lupebar.querySelectorAll('[data-zoom]')) b.addEventListener('click', () => zoomLupe(+b.dataset.zoom));
  menuBtn.addEventListener('click', () => { if (menu.hidden) { updateMenu(); openPop(menu); } else closePopovers(); });
  titleBtn.addEventListener('click', () => { updateMenu(); openPop(menu); rename.focus(); rename.select(); });
  scrim.addEventListener('click', closePopovers);
  rename.addEventListener('input', () => {
    note.title = rename.value.trim().slice(0, 80) || defaultTitle(new Date(note.created));
    updateTitle();
    if (note.strokes.length || note.path) markDirty();
  });
  rename.addEventListener('keydown', (e) => { if (e.key === 'Enter') closePopovers(); });
  for (const b of paperSeg.children) b.addEventListener('click', () => {
    note.paper = b.dataset.paper; prefs.paper = note.paper; savePrefs();
    invalidateBases(); updateMenu();
    if (note.strokes.length || note.path) markDirty();
  });
  auto.addEventListener('change', () => { prefs.autoAdvance = auto.checked; savePrefs(); cancelAdvance(); invalidateOverlays(); });
  readBtn.addEventListener('click', readHandwriting);
  pdfBtn.addEventListener('click', exportPDF);
  pngBtn.addEventListener('click', exportPNG);
  clearBtn.addEventListener('click', () => {
    if (!note.strokes.length) { closePopovers(); return; }
    if (!clearArmed) { clearArmed = true; clearBtn.classList.add('armed'); clearBtn.querySelector('span').textContent = t('kladde.clearSure'); return; }
    const all = note.strokes.slice();
    removeStrokes(all);
    pushUndo({ t: 'remove', s: all });
    closePopovers();
    toast(t('kladde.cleared'));
  });
  libBtn.addEventListener('click', openLibrary);
  libClose.addEventListener('click', closeLibrary);
  libNew.addEventListener('click', startNewNote);

  // Kein Scrollen, Zoomen oder Lupen-Menü des Browsers auf den Zeichenflächen
  for (const el of [stage, padEl]) {
    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  on(document, 'gesturestart', (e) => { if (root.contains(e.target)) e.preventDefault(); });
  on(document, 'keydown', (e) => {
    if (!root.isConnected || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redo(); else undo(); }
    else if (e.key === 'Escape' && (!menu.hidden || !widthpop.hidden || !library.hidden)) { e.stopPropagation(); closePopovers(); closeLibrary(); }
  }, true);
  on(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
  on(window, 'pagehide', () => saveNow());
  const themeWatch = new MutationObserver(() => { readPalette(); invalidateBases(); });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  off.push(() => themeWatch.disconnect());

  main.cleanup = () => {
    saveNow();
    leaveNote();
    alive = false;
    cancelAnimationFrame(rafId);
    cancelAdvance();
    for (const f of off) { try { f(); } catch { /* weg */ } }
    delete app.dataset.kladdeLupe;
  };

  // ───────── Start: sofort eine Seite, bereit zum Schreiben ─────────
  setTool('pen');
  updateWidth();
  updateUndo();
  updateTitle();
  updateReadout();
  updateMenu();
  setLupeOn(true);
  if (prefs.hintSeen) hint.hidden = true;
  const wanted = loadPref('kladde.open', '') || loadPref('kladde.last', '');
  savePref('kladde.open', '');
  if (wanted && inkNotes().some((d) => d.path === wanted)) openNote(wanted);
  else setNote(freshNote());
}
