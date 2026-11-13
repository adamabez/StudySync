// StudySync - service worker: what makes StudySync installable as an app, and shows a
// friendly "You're offline" page instead of the browser's error when there's no connection.
//
// It deliberately caches nothing else: every page and API request still goes straight to
// the server, so students always see their real, current schedule (and logins just work).
// Served from /sw.js (routes/pages.js) so it covers the whole site. Bump VERSION when
// pages/offline.html or the files below change, so phones pick up the new copy.

const VERSION = "v1";
const CACHE = "studysync-offline-" + VERSION;
const OFFLINE_FILES = ["/offline", "/public/style.css", "/public/dark.css", "/public/theme.js", "/public/logo.png", "/public/logo-dark.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_FILES)).then(() => self.skipWaiting()));
});

// Remove older offline copies
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("studysync-offline-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  // Opening a page: the network as usual; the offline page only if that fails
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline")));
    return;
  }
  // The offline page's own styles and logo, when there's no network
  const url = new URL(request.url);
  if (url.origin === location.origin && OFFLINE_FILES.includes(url.pathname)) {
    event.respondWith(fetch(request).catch(() => caches.match(url.pathname)));
  }
});
