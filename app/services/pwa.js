// Installation, offline cache and updates through the service worker (sw.js).
const state = { supported: 'serviceWorker' in navigator, ready: false, version: null, waiting: null };
const listeners = new Set();
let registration = null;
let reloading = false;

const emit = () => { for (const fn of listeners) fn({ ...state }); };

export function pwaState() {
  return { ...state };
}

export function onPwaChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function askVersion() {
  navigator.serviceWorker.controller?.postMessage({ type: 'version' });
}

function setWaiting(worker) {
  state.waiting = worker;
  emit();
}

export async function registerPWA() {
  if (!state.supported) return;
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'version') {
      state.version = e.data.version;
      state.ready = true;
      emit();
    }
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
    else askVersion();
  });
  try {
    registration = await navigator.serviceWorker.register('./sw.js');
  } catch (err) {
    console.warn('Service worker not registered', err);
    return;
  }
  if (registration.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(worker);
    });
  });
  await navigator.serviceWorker.ready;
  askVersion();
}

// Returns 'ready', 'none' or 'unavailable'.
export async function checkForUpdate() {
  if (!registration) return 'unavailable';
  try {
    await registration.update();
  } catch {
    return 'none';
  }
  const pending = registration.installing || registration.waiting;
  if (!pending) return 'none';
  if (pending.state !== 'installed') {
    await new Promise((resolve) => pending.addEventListener('statechange', () => {
      if (pending.state === 'installed' || pending.state === 'redundant') resolve();
    }));
  }
  if (pending.state === 'redundant') return 'none';
  setWaiting(pending);
  return 'ready';
}

export function applyUpdate() {
  if (!state.waiting) return;
  reloading = true;
  state.waiting.postMessage({ type: 'skipWaiting' });
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function platform() {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return 'ios';
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua)) return 'mac';
  return 'other';
}
