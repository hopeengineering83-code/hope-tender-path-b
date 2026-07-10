// Temporary production stability service worker.
//
// The previous PWA worker cached navigation pages and static assets. After many
// rapid deployments this can serve stale Next.js chunks and trigger client-side
// Application Error pages even when the server returns valid HTML. This worker
// intentionally clears all old caches, does not intercept fetches, and lets the
// network/browser handle every request normally.

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", () => {
  // No event.respondWith: bypass service worker caching for all requests.
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
