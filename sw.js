// Service worker: keeps the whole app in a cache so Toollib starts without a network.
// Raise VERSION with every release; the shell then offers "Reload" for the update.
const VERSION = '0.3.0';
const CACHE = `toollib-${VERSION}`;

const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png',
  './app/main.js',
  './app/i18n/i18n.js',
  './app/i18n/strings.json',
  './app/services/prefs.js',
  './app/services/ui.js',
  './app/services/icons.js',
  './app/services/pwa.js',
  './app/shell/shell.js',
  './app/shell/views.js',
  './app/shell/modules.js',
  './app/shell/styles.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Only Toollib's own old caches are removed; Kobra's caches on the same domain stay untouched.
    for (const key of await caches.keys()) {
      if (key.startsWith('toollib-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'skipWaiting') self.skipWaiting();
  if (event.data?.type === 'version') event.source?.postMessage({ type: 'version', version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      return (await cache.match('./index.html')) || fetch(req);
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch {
      return Response.error();
    }
  })());
});
