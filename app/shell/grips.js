// Grips (0.31.0): a thin line between two columns you drag to give one of them more room; a double click puts it
// back. Used by the library (contents | page | side panel) and by the page editor (writing | preview). The sizes stay
// on this device (ENTE: "ich möchte die Ansichten selbst in der Größe skalieren, so wie ich es gerade brauche").
//
//   const g = grip({ label, start: () => width, move: (start, dx) => …, done: () => save(), reset: () => … });
//   parent.append(g);   // its place comes from the stylesheet (.grip-…)
//
// start() gives the size when the drag begins, move() gets it again together with how far the pointer went.
import { h } from '../services/ui.js';

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

export function grip({ label = '', cls = '', start, move, done, reset }) {
  const el = h('div', { class: `grip ${cls}`, role: 'separator', 'aria-orientation': 'vertical', 'aria-label': label, title: label });
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const v0 = start();
    try { el.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
    document.body.classList.add('gripping');
    el.classList.add('on');
    const onMove = (ev) => move(v0, ev.clientX - x0);
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('gripping');
      el.classList.remove('on');
      done?.();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });
  el.addEventListener('dblclick', () => { reset?.(); done?.(); });
  return el;
}
