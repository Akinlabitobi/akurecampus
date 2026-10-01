// Service worker: makes the site installable and fast on weak connections.
//
//   - Pages: network first (so people always get the latest), falling back
//     to the last saved copy -- or the offline page -- when there's no
//     connection or the network takes longer than a few seconds.
//   - Built JS/CSS (/assets/*, content-hashed so they never change): saved
//     on first use and served from the device after that.
//   - Images, icons, fonts: served from the device, refreshed in the
//     background.
//   - /api/*: never touched. Form data, member details, photos and the
//     dashboard are private and always go straight to the server; forms
//     filled in offline are queued by the page itself (see src/offline-queue.js).
//
// Bump VERSION to force every installed copy to drop its saved files.
const VERSION = "v1";
const SHELL_CACHE = `ha-shell-${VERSION}`;
const RUNTIME_CACHE = `ha-runtime-${VERSION}`;
const RUNTIME_LIMIT = 80;
const NETWORK_TIMEOUT_MS = 4000;
const PRECACHE = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/logo-black.png",
  "/logo-white.png",
  "/icons/icon-192.png",
  "/icons/favicon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(PRECACHE);
    // Also save the JS/CSS the home page loads, so the app opens offline
    // straight after installing, not only after a second visit.
    const html = await (await cache.match("/")).text();
    const assets = [...new Set(html.match(/\/assets\/[^"']+\.(?:js|css)/g) || [])];
    await cache.addAll(assets);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, RUNTIME_CACHE];
    for (const key of await caches.keys()) {
      if (!keep.includes(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - RUNTIME_LIMIT))) await cache.delete(key);
}

async function pageResponse(request) {
  const url = new URL(request.url);
  const cache = await caches.open(SHELL_CACHE);
  // Every page of the main site is the same app, so any saved page (or
  // the saved home page) can render any view. The call centre is a
  // separate app and only falls back to its own saved copy.
  const fallback = async () => (await cache.match(url.pathname))
    || (!url.pathname.startsWith("/callcentre") && await cache.match("/"))
    || cache.match("/offline.html");
  const network = fetch(request).then(response => {
    if (response.ok) cache.put(url.pathname, response.clone());
    return response;
  });
  network.catch(() => {}); // handled below; avoids an unhandled-rejection warning
  const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  try {
    const winner = await Promise.race([network, timeout]);
    if (winner) return winner;
    // Slow network: use the saved copy if there is one, otherwise keep waiting.
    return (await cache.match(url.pathname)) || await network;
  } catch {
    return fallback();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const saved = await cache.match(request);
  const refresh = fetch(request).then(response => {
    if (response.ok || response.type === "opaque") {
      cache.put(request, response.clone()).then(() => trim(cache));
    }
    return response;
  }).catch(() => saved);
  return saved || refresh;
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/")) return;
    if (request.mode === "navigate") return event.respondWith(pageResponse(request));
    if (url.pathname.startsWith("/assets/")) return event.respondWith(cacheFirst(request));
    return event.respondWith(staleWhileRevalidate(request));
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request));
  }
});
