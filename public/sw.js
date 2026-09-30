// Soma service worker: keeps the app shell (HTML/CSS/JS/icons) on the device so
// the dashboard opens fast and still opens offline.
//
// Never handled here (always straight to the network, never stored):
//   /api/*  (includes the /api/events SSE stream and private /api/photos/*),
//   /log, /entries, /submit, /sync  -- the same paths server.mjs proxies.
//
// Freshness: the page and its CSS/JS are fetched network-first (with a short
// timeout, falling back to the cached copy), so a new deploy shows up on the
// next open while online and the HTML never runs against stale scripts.
// Bump VERSION to force old caches to be dropped.

const VERSION = 'v2';
const SHELL_CACHE = `soma-shell-${VERSION}`;
const FONT_CACHE = `soma-fonts-${VERSION}`;
const NETWORK_TIMEOUT_MS = 3500;

const SHELL = [
  '/',
  '/styles.css', '/play.css', '/replay.css', '/photos.css', '/todos.css', '/auth.css', '/review.css', '/mobile.css',
  '/app.js', '/life.js', '/photos.js', '/todos.js', '/auth.js', '/status.js', '/review.js',
  '/manifest.webmanifest',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
  '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png', '/icons/favicon-32.png',
];

const PRIVATE_OR_LIVE = /^\/(api\/|log$|entries(\/|$)|submit$|sync(\/|$))/;
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // One missing file should not block installation.
    await Promise.all(SHELL.map((url) =>
      fetch(url, { cache: 'no-store' })
        .then((res) => (res.ok ? cache.put(url, res) : undefined))
        .catch(() => undefined)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, FONT_CACHE]);
    for (const key of await caches.keys()) {
      if (key.startsWith('soma-') && !keep.has(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (PRIVATE_OR_LIVE.test(url.pathname)) return; // network only, never cached
    if ((request.headers.get('accept') || '').includes('text/event-stream')) return;
    if (url.pathname === '/sw.js') return;

    if (request.mode === 'navigate') {
      // Any in-app URL renders the single page; cache it under '/'.
      event.respondWith(networkFirst(request, '/'));
      return;
    }
    const cacheKey = url.pathname; // ignore ?v= style query strings
    if (/\.(css|js|webmanifest)$/.test(url.pathname)) {
      event.respondWith(networkFirst(request, cacheKey));
      return;
    }
    if (/\.(png|svg|ico|webp|jpg|jpeg|woff2?)$/.test(url.pathname) && url.pathname.startsWith('/icons/')) {
      event.respondWith(staleWhileRevalidate(request, SHELL_CACHE, cacheKey));
    }
    return;
  }

  if (FONT_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE, request));
  }
});

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(SHELL_CACHE);
  const network = fetch(request).then((res) => {
    if (res.ok && res.type === 'basic') cache.put(cacheKey, res.clone());
    return res;
  });
  network.catch(() => undefined); // handled below; avoid unhandled rejection noise
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch {
    // offline: fall through to the cache
  }
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  return network; // nothing cached yet: keep waiting on the network
}

async function staleWhileRevalidate(request, cacheName, cacheKey) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(cacheKey);
  const network = fetch(request).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(cacheKey, res.clone());
    return res;
  }).catch(() => cached);
  return cached || network;
}
