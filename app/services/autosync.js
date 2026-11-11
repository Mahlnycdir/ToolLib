// Sync by itself (0.14.1.1): a few seconds after you changed something, when you come back to the app, when the network
// returns, and now and then while it is open. It only starts after a first sync you did yourself, never while you
// are typing, and after an error it waits five minutes (the status bar shows the error; the Sync button still works).
// The setting "sync.auto" (default on) is in Settings › Sync.
import { loadPref } from './prefs.js';
import { isConfigured, onSyncChange, syncKnowledge, syncState } from './sync.js';

const AFTER_CHANGE = 12000;
const EVERY = 180000;
const MIN_GAP = 45000;
const BACKOFF = 300000;
const TYPING = 6000;

export const autoOn = () => loadPref('sync.auto', true) !== false;

// While something writes many files (a run through a website, 0.14.3), Sync by itself waits: at most one sync in
// HELD_EVERY, and one right after it ends.
let HELD_EVERY = 300000;
const holds = new Set();
// The Toollib in the Mac helper (0.14.4) syncs more often during a run, so other devices see its progress sooner.
export function setHeldEvery(ms) { HELD_EVERY = Math.max(60000, Number(ms) || 300000); }
let kick = null;
export function holdAutoSync(reason, on) {
  if (on) holds.add(reason); else if (holds.delete(reason)) kick?.(AFTER_CHANGE);
}

export function startAutoSync({ onDone } = {}) {
  let timer = 0;
  let lastTry = 0;
  let failedAt = 0;
  let lastInput = 0;
  let lastPending = syncState().pending;
  document.addEventListener('input', () => { lastInput = Date.now(); }, true);

  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(attempt, ms); };
  kick = schedule;

  async function attempt() {
    if (!autoOn() || !isConfigured() || !navigator.onLine || document.hidden) return;
    const s = syncState();
    if (s.busy || !s.last) return;                                       // not while one runs; the first sync is yours
    if (failedAt && Date.now() - failedAt < BACKOFF) return;
    if (Date.now() - lastInput < TYPING) { schedule(TYPING); return; }   // do not move files under your hands
    if (holds.size && Date.now() - lastTry < HELD_EVERY) { schedule(HELD_EVERY - (Date.now() - lastTry)); return; }
    lastTry = Date.now();
    try {
      const r = await syncKnowledge({ auto: true });
      failedAt = 0;
      if (r && !r.skipped) onDone?.(r);
    } catch {
      failedAt = Date.now();
    }
  }

  onSyncChange((s) => {
    if (!s.busy && s.pending > lastPending) schedule(AFTER_CHANGE);
    lastPending = s.pending;
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastTry > MIN_GAP) schedule(1500); });
  window.addEventListener('online', () => { failedAt = 0; schedule(2000); });
  setInterval(() => { if (!document.hidden && Date.now() - lastTry > EVERY) attempt(); }, 60000);
  schedule(4000);
}
