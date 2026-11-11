// Toollib in several windows (the research window opens on its own): a window that changed nodes tells the others,
// so their search and lists show the change without a reload. Files themselves are shared through IndexedDB.
const name = 'toollib';
let channel = null;
const listeners = new Set();

function open() {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(name);
  channel.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    for (const fn of listeners) { try { fn(msg); } catch (err) { console.warn(err); } }
  });
  return channel;
}

// Nodes changed in this window: { kind: 'nodes', paths }.
export function announce(paths) {
  try { open()?.postMessage({ kind: 'nodes', paths: [...paths] }); } catch { /* other windows read it when they draw again */ }
}

// Any other message ({ kind: 'crawl', … } since 0.14.3: how a run through a website goes, and commands for it).
export function post(msg) {
  try { open()?.postMessage(msg); } catch { /* other windows read the files when they draw again */ }
}

export function onAnnounce(fn) {
  open();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
