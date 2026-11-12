// Handwriting → LaTeX (0.21.0). The page is cut into lines (strokes whose heights overlap belong together), each
// line goes as a small black-on-white picture to the Mac helper (POST /ink/latex), which reads it with a small model
// (Texo / FormulaNet, 20 M parameters, on the Mac only). Nothing goes to any other server.
// Away from home the note can ask the Mac instead (ink_read: "mac"); Toollib in the helper reads it with its next
// sync and writes the result back (readWaitingNotes, from background.js).
import { GRID, drawStroke, inkBox } from './ink.js';
import { helperFetch, helperReady, hasHelper, researchSettings } from './research.js';
import { inkNotes, loadInkNote, setLatex } from './kladde-store.js';

// Lines: strokes sorted from the top; a stroke joins the line above if it starts less than GAP below its lowest
// point (numerator, fraction bar and denominator stay one line, exponents and indices too). Lines written with the
// magnifier lie a whole magnifier height apart.
const GAP = GRID * 0.6;
export function splitLines(strokes) {
  const list = strokes.filter((s) => s.pts.length).slice().sort((a, b) => a.b.y0 - b.b.y0);
  const lines = [];
  let cur = null;
  for (const s of list) {
    if (cur && s.b.y0 <= cur.y1 + GAP) { cur.items.push(s); cur.y1 = Math.max(cur.y1, s.b.y1); continue; }
    cur = { items: [s], y1: s.b.y1 };
    lines.push(cur);
  }
  return lines.map((L) => L.items);
}

// One line as a PNG (data URL without the prefix): black ink on white, a margin of half a box, at most 1024 px wide.
export function lineImage(strokes, { height = 96 } = {}) {
  const box = inkBox(strokes);
  if (!box) return '';
  const m = GRID * 0.5;
  const bw = box.x1 - box.x0 + 2 * m, bh = box.y1 - box.y0 + 2 * m;
  let k = height / Math.max(bh, GRID * 1.5);
  if (bw * k > 1024) k = 1024 / bw;
  const w = Math.max(16, Math.round(bw * k)), h = Math.max(16, Math.round(bh * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
  c.setTransform(k, 0, 0, k, (m - box.x0) * k, (m - box.y0) * k);
  const black = { ink: '#000', blue: '#000', red: '#000', green: '#000' };
  for (const s of strokes) drawStroke(c, s, black, 2.2 / k);
  return cv.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

// Can the helper read handwriting right now? { ok, reason: 'no-helper' | 'unreachable' | 'not-installed' }
export async function readerState(settings = researchSettings()) {
  if (!hasHelper(settings)) return { ok: false, reason: 'no-helper' };
  if (!(await helperReady(settings))) return { ok: false, reason: 'unreachable' };
  try {
    const res = await helperFetch('/ink/state', { settings });
    const j = await res.json();
    return j.installed ? { ok: true, loaded: !!j.loaded } : { ok: false, reason: 'not-installed' };
  } catch { return { ok: false, reason: 'not-installed' }; }
}

// Reads the lines of a page: [{ latex, error }] in the order of the lines.
export async function readInk(strokes, { signal, settings = researchSettings() } = {}) {
  const lines = splitLines(strokes);
  if (!lines.length) return [];
  const images = lines.map((l) => lineImage(l)).filter(Boolean).slice(0, 40);
  const res = await helperFetch('/ink/latex', { method: 'POST', json: { images }, signal, settings });
  const j = await res.json();
  const out = Array.isArray(j.results) ? j.results : [];
  return images.map((_, i) => ({ latex: String(out[i]?.latex || '').slice(0, 4000), error: String(out[i]?.error || '') }));
}

// In the Mac helper: every note that asked for it gets read; returns the paths that changed.
export async function readWaitingNotes() {
  const waiting = inkNotes().filter((d) => d.inkRead === 'mac');
  if (!waiting.length) return [];
  const st = await readerState();
  if (!st.ok) return [];
  const done = [];
  for (const d of waiting.slice(0, 10)) {
    try {
      const n = await loadInkNote(d.path);
      const lines = (await readInk(n.strokes)).map((r) => r.latex).filter(Boolean);
      await setLatex(d.path, lines);
      done.push(d.path);
    } catch (e) { console.warn('Kladde:', e); }
  }
  return done;
}
