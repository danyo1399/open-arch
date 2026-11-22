/**
 * The service worker that makes the installed app work offline. The build (vite.config.ts) writes it
 * to dist/sw.js with two constants in front: VERSION, a hash of the build, and FILES, every file in it.
 *
 * Opening the app loads the latest version when online and the cached one when offline. Other files
 * come from the cache, which holds one build at a time. A new build's worker waits until every tab of
 * the old one is closed before it replaces the old cache, so an open tab never loses its files.
 *
 * Until then, a tab opened online runs the new build while the old worker serves it. The new build's
 * files are in the new worker's cache, so they're looked for there too: a file the tab loads later,
 * like the notes' formatted view, still loads after the host has replaced the new build with a newer
 * one. A built file's name says what's in it, so a name found in any build's cache is the same file.
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
  event.respondWith(cached(request).then((found) => found ?? fetch(request)));
});

/**
 * The file from this build's cache, or else from another build's. Ignores Vary: the build's script and
 * style tags are crossorigin, so they send an Origin header that the cached copies were fetched without,
 * and a host may answer with "Vary: Origin".
 */
async function cached(request) {
  const others = (await caches.keys()).filter((key) => key.startsWith("open-arch-") && key !== CACHE);
  for (const key of [CACHE, ...others]) {
    const found = await (await caches.open(key)).match(request, { ignoreVary: true });
    if (found) return found;
  }
  return undefined;
}
