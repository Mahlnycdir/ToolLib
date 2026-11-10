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

export function startAutoSync({ onDone } = {}) {
  let timer = 0;
  let lastTry = 0;
  let failedAt = 0;
  let lastInput = 0;
  let lastPending = syncState().pending;
  document.addEventListener('input', () => { lastInput = Date.now(); }, true);

  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(attempt, ms); };

  async function attempt() {
    if (!autoOn() || !isConfigured() || !navigator.onLine || document.hidden) return;
    const s = syncState();
    if (s.busy || !s.last) return;                                       // not while one runs; the first sync is yours
    if (failedAt && Date.now() - failedAt < BACKOFF) return;
    if (Date.now() - lastInput < TYPING) { schedule(TYPING); return; }   // do not move files under your hands
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
