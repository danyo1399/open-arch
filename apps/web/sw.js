/**
 * The service worker that makes the installed app work offline. The build (vite.config.ts) writes it
 * to dist/sw.js with two constants in front: VERSION, a hash of the build, and FILES, every file in it.
 *
 * Opening the app loads the latest version when online and the cached one when offline. Other files
 * come from the cache, which holds one build at a time. A new build's worker waits until every tab of
 * the old one is closed before it replaces the old cache, so an open tab never loses its files.
 */
/* global VERSION, FILES */
const CACHE = `open-arch-${VERSION}`;
const APP = new URL("./", self.location.href).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      const old = keys.filter((key) => key.startsWith("open-arch-") && key !== CACHE);
      return Promise.all(old.map((key) => caches.delete(key)));
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then((cache) => cache.match(APP))));
    return;
  }
  // Ignore Vary: the build's script and style tags are crossorigin, so they send an Origin header that
  // the cached copies were fetched without, and a host may answer with "Vary: Origin".
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(request, { ignoreVary: true }))
      .then((cached) => cached ?? fetch(request)),
  );
});
