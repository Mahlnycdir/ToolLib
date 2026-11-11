// Toollib in the Mac helper (0.14.4 part 2). The helper opens Toollib without a window (?helper=1) in a Chromium of its
// own, with your settings loaded once from your settings file. This module is its work there: every minute a sync
// (so it sees what other devices asked), then the runs of folders with crawl_on "mac": a queued one starts, commands
// (crawl_cmd, crawl_cmd_at) are carried out and answered with crawl_cmd_done. During a run Sync by itself uploads every
// two minutes. The PDF inbox comes in here too, without any window open.
// window.toollibBackground = { status(), wake() } is what the helper asks (GET /background, POST /background/wake).
import { loadPref, savePref } from './prefs.js';
import { pwaState } from './pwa.js';
import { allNodes, indexState, onIndexChange } from './search.js';
import { isConfigured, isSyncing, syncKnowledge, syncState } from './sync.js';
import { setHeldEvery } from './autosync.js';
import { commandDone, crawlDefaults, crawlRunning, loadCrawl, pauseCrawl, recrawl, resumeCrawl, runningCrawl, stopCrawl } from './crawl.js';

const EVERY = 60000;
export const isHelperMode = () => {
  try { if (new URLSearchParams(location.search).has('helper')) return true; } catch { /* no location */ }
  return loadPref('helper.mode', false) === true;
};

const DURING = 115000;
const last = { tick: 0, sync: 0, error: '', started: '', did: [] };
let busy = false;
let wakeAgain = false;   // woken while busy: once more right after
let soonTimer = 0;
const soon = () => { clearTimeout(soonTimer); soonTimer = setTimeout(() => tick({ force: true }), 4000); };

function indexReady() {
  if (indexState().ready && !indexState().building) return Promise.resolve();
  return new Promise((resolve) => { const off = onIndexChange((x) => { if (x.ready && !x.building) { off(); resolve(); } }); });
}

export const macFolders = () => allNodes().filter((d) => d.type === 'research' && !d.conflict && d.crawl?.on === 'mac');

// One command; false when it has to wait (another run is going).
async function obey(f, cmd) {
  const here = runningCrawl();
  const mine = here?.folder === f.path;
  if (cmd === 'pause') { if (mine) pauseCrawl(f.path); return true; }
  if (cmd === 'stop') { if (mine) stopCrawl(f.path); return true; }
  // "go on" while it runs: done already; while it is still ending after "pause": right after it ended
  if (here) {
    if (mine && here.ending) { soon(); return false; }
    return mine && cmd !== 'again' && cmd !== 'more';
  }
  const state = await loadCrawl(f.path);
  if (cmd === 'go') { if (state) await resumeCrawl(f.path); else await recrawl(f.path); return true; }
  if (cmd === 'more') { if (state) await resumeCrawl(f.path, { more: f.crawl.max || crawlDefaults().max }); else await recrawl(f.path); return true; }
  if (cmd === 'again') { await recrawl(f.path); return true; }
  return true;
}

// Commands first, then the oldest waiting run. True when something changed that other devices should see soon.
async function work() {
  let changed = false;
  const folders = macFolders();
  for (const f of folders) {
    const { cmd, cmdAt, cmdDone } = f.crawl;
    if (!cmd || !cmdAt || cmdAt === cmdDone || loadPref(`helper.done.${f.path}`, '') === cmdAt) continue;
    if (await obey(f, cmd)) {
      savePref(`helper.done.${f.path}`, cmdAt);
      await commandDone(f.path, cmdAt);
      last.did.push(`${cmd} ${f.path}`);
      changed = true;
    }
  }
  if (crawlRunning()) return changed;
  // the oldest waiting run starts; each folder only once per request (a run that broke off waits for "go on")
  const queued = folders.filter((f) => f.crawl.state === 'queued').sort((a, b) => (a.crawl.at || '').localeCompare(b.crawl.at || ''));
  for (const f of queued) {
    if (loadPref(`helper.started.${f.path}`, '') === (f.crawl.at || 'x')) continue;
    savePref(`helper.started.${f.path}`, f.crawl.at || 'x');
    await recrawl(f.path);
    last.started = f.path;
    last.did.push(`start ${f.path}`);
    return true;
  }
  return changed;
}

// force (a device woke the helper): sync now even during a run; otherwise during a run at most every two minutes,
// so a "pause" from your phone arrives soon without a commit every minute.
export async function tick({ force = false } = {}) {
  if (busy) { if (force) wakeAgain = true; return backgroundStatus(); }
  busy = true;
  try {
    if (!isConfigured()) { last.error = 'not-set-up'; return backgroundStatus(); }
    if (!isSyncing() && (!crawlRunning() || force || Date.now() - last.sync > DURING)) {
      const r = await syncKnowledge({ auto: true });
      if (r && !r.skipped) last.sync = Date.now();
      await indexReady();
    }
    // what it did (an answer, a run that started) goes up right away, so your devices see it with their next sync
    if (await work() && !isSyncing()) {
      const r = await syncKnowledge({ auto: true });
      if (r && !r.skipped) last.sync = Date.now();
    }
    last.error = '';
  } catch (e) {
    last.error = e?.code || e?.message || String(e);
    console.warn('Helper:', e);
  } finally {
    last.tick = Date.now();
    last.did = last.did.slice(-20);
    busy = false;
    if (wakeAgain) { wakeAgain = false; setTimeout(() => tick({ force: true }), 0); }
  }
  return backgroundStatus();
}

export function backgroundStatus() {
  const r = runningCrawl();
  return {
    mode: true, configured: isConfigured(), synced: syncState().last?.time || 0, syncError: syncState().error || '', lastSync: last.sync, lastTick: last.tick, error: last.error,
    running: r ? { folder: r.folder, title: r.title, pages: r.pages, queue: r.queue, status: r.status } : null,
    queued: macFolders().filter((f) => f.crawl.state === 'queued').length, did: last.did.slice(-5),
    version: pwaState().version || '',
  };
}

export function startBackground() {
  if (!isHelperMode()) return false;
  savePref('helper.mode', true);
  setHeldEvery(120000);
  window.toollibBackground = { status: backgroundStatus, wake: () => tick({ force: true }) };
  setInterval(() => { tick(); }, EVERY);
  window.addEventListener('online', () => tick());
  indexReady().then(() => setTimeout(tick, 3000));
  return true;
}
