// Service worker: keeps the whole app in a cache so Toollib starts without a network, keeps Python in a cache of
// its own and carries input() from the Python worker to the page (the synchronous channel, from Kobra's sw.js).
// Raise VERSION with every release; the shell then offers "Reload" for the update.
const VERSION = '0.13.1';
const CACHE = `toollib-${VERSION}`;
// Python (vendor/pyodide) is big and changes only with a new Pyodide version, so its cache survives app updates.
// Keep PYODIDE equal to "pyodide" in vendor/pyodide/toollib-bundle.json.
const PYODIDE = '314.0.7';
const PY_CACHE = `toollib-python-${PYODIDE}`;

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
  './app/services/storage.js',
  './app/services/sync.js',
  './app/services/nodes.js',
  './app/services/search.js',
  './app/services/python.js',
  './app/services/python-worker.js',
  './app/services/toollib_snippets.py',
  './app/shell/shell.js',
  './app/shell/views.js',
  './app/shell/modules.js',
  './app/shell/node-view.js',
  './app/shell/console.js',
  './app/shell/run-panel.js',
  './app/shell/snippet-form.js',
  './app/shell/markdown.js',
  './app/shell/math.js',
  './app/shell/formulary.js',
  './app/shell/choice-box.js',
  './app/services/choices.js',
  './app/shell/styles.css',
  './vendor/git.js',
  './vendor/search.js',
  './vendor/py-bundle.json',
  // KaTeX (0.12.0): formulas, offline
  './vendor/katex/katex.js',
  './vendor/katex/katex.min.css',
  './vendor/katex/fonts/KaTeX_AMS-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2',
  './vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2',
  './vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Main-Bold.woff2',
  './vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2',
  './vendor/katex/fonts/KaTeX_Main-Italic.woff2',
  './vendor/katex/fonts/KaTeX_Main-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2',
  './vendor/katex/fonts/KaTeX_Math-Italic.woff2',
  './vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2',
  './vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2',
  './vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Script-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size1-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size2-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size3-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size4-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2',
  // Kobra (0.11.0): fast unverändert in kobra/, läuft unter Toollibs Service Worker
  './kobra/index.html',
  './kobra/styles.css',
  './kobra/worker.js',
  './kobra/vendor/vendor.js',
  './kobra/js/app.js',
  './kobra/js/editor.js',
  './kobra/js/git.js',
  './kobra/js/gui.js',
  './kobra/js/icons.js',
  './kobra/js/packages.js',
  './kobra/js/runner.js',
  './kobra/js/snippets.js',
  './kobra/js/spickzettel.js',
  './kobra/js/storage.js',
  './kobra/js/ui.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Only Toollib's own old caches are removed; Kobra's caches on the same domain stay untouched.
    for (const key of await caches.keys()) {
      if (key.startsWith('toollib-') && key !== CACHE && key !== PY_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// ------------------------------------------------------------------ synchronous channel (Kobra)
// The Python worker waits for input() with a synchronous request to __toollib__/sync/<token>/<id>; the page
// answers with a "sync-reply" message. Animations wait for events the same way at __toollib__/events/<token>.
const waiting = new Map();      // token/id -> { resolve, timer }
const values = new Map();       // token/id -> value (when the answer came before the request)
const queues = new Map();       // token -> [events]
const eventWaiters = new Map(); // token -> { resolve, timer }

const respondJson = (text, status = 200) => new Response(text, { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function waitForValue(key) {
  if (values.has(key)) {
    const v = values.get(key);
    values.delete(key);
    return Promise.resolve(respondJson(v));
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (waiting.get(key)?.resolve === resolve) waiting.delete(key);
      resolve(new Response(null, { status: 204 }));
    }, 25000);
    waiting.set(key, { resolve, timer });
  });
}

function waitForEvents(token, waitMs) {
  const q = queues.get(token);
  if (q && q.length) {
    queues.set(token, []);
    return Promise.resolve(respondJson(JSON.stringify(q)));
  }
  const prev = eventWaiters.get(token);
  if (prev) { clearTimeout(prev.timer); prev.resolve(respondJson('[]')); eventWaiters.delete(token); }
  if (!waitMs) return Promise.resolve(respondJson('[]'));
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (eventWaiters.get(token)?.resolve === resolve) eventWaiters.delete(token);
      resolve(respondJson('[]'));
    }, Math.min(waitMs, 25000));
    eventWaiters.set(token, { resolve, timer });
  });
}

function pushEvents(token, events) {
  const q = queues.get(token) || [];
  q.push(...events);
  queues.set(token, q);
  const w = eventWaiters.get(token);
  if (w) {
    eventWaiters.delete(token);
    clearTimeout(w.timer);
    setTimeout(() => {   // gather events that belong together
      const items = queues.get(token) || [];
      queues.set(token, []);
      w.resolve(respondJson(JSON.stringify(items)));
    }, 0);
  }
}

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'skipWaiting') self.skipWaiting();
  else if (msg.type === 'version') event.source?.postMessage({ type: 'version', version: VERSION });
  else if (msg.type === 'sync-reply') {
    const key = `${msg.token}/${msg.id}`;
    const w = waiting.get(key);
    if (w) { waiting.delete(key); clearTimeout(w.timer); w.resolve(respondJson(msg.value)); } else values.set(key, msg.value);
  } else if (msg.type === 'gui-events') pushEvents(msg.token, msg.events || []);
  else if (msg.type === 'clear-events') queues.set(msg.token, []);
});

// ------------------------------------------------------------------ requests
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope).pathname;

  // Kobra (kobra/) uses the same channel under its own name, kobra/__kobra__/
  const channel = url.pathname.startsWith(`${scope}__toollib__/`) ? `${scope}__toollib__/`
    : url.pathname.startsWith(`${scope}kobra/__kobra__/`) ? `${scope}kobra/__kobra__/` : null;
  if (channel) {
    const parts = url.pathname.slice(channel.length).split('/');
    if (parts[0] === 'ping') event.respondWith(new Response('pong', { headers: { 'Cache-Control': 'no-store' } }));
    else if (parts[0] === 'sync') event.respondWith(waitForValue(`${parts[1]}/${parts[2]}`));
    else if (parts[0] === 'events') event.respondWith(waitForEvents(parts[1], parseInt(url.searchParams.get('wait') || '0', 10)));
    else event.respondWith(new Response('not found', { status: 404 }));
    return;
  }
  if (req.method !== 'GET') return;

  // Python: from its cache, otherwise from the server, and then into the cache.
  if (url.pathname.startsWith(`${scope}vendor/pyodide/`)) {
    event.respondWith((async () => {
      const cache = await caches.open(PY_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
      return res;
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      const page = url.pathname.startsWith(`${scope}kobra/`) ? './kobra/index.html' : './index.html';
      return (await cache.match(page)) || fetch(req);
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
