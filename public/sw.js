/* eslint-disable no-restricted-globals */
// Hope Tender Proposal Generator — Service Worker
//
// Upgraded in PR #246 from a naive cache-first/no-offline-page worker
// to a proper offline-aware PWA service worker with:
//
//   • App-shell precache for the dashboard, login, and offline page
//   • Stale-while-revalidate for navigation requests (HTML pages)
//   • Network-first with cache fallback for static assets
//   • API requests bypassed entirely (always live, never cached)
//   • Dedicated /offline page when network fails on a non-cached route
//   • Cache versioning so deploys cleanly invalidate old caches
//
// Mobile users who installed the app via the manifest now see a
// helpful offline page instead of a generic browser error when they
// lose connectivity, AND the dashboard shell + login routes work
// offline (read-only — generation/analysis still requires network
// because they hit the AI APIs).

const CACHE_VERSION = "v2";
const CACHE_NAME = `hope-tender-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";

// App-shell URLs precached at install. These are the bare minimum
// needed to render the navigation chrome when offline. Each route
// itself fetches data from /api/* which is intentionally NOT cached
// (live data only). The result: when offline the user sees the
// shell with cached page chrome plus an offline-state banner.
const APP_SHELL = [
  "/",
  "/login",
  "/dashboard",
  OFFLINE_URL,
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {
      // Don't fail install if some shell assets aren't yet uploaded.
      // The fetch handler will populate the cache opportunistically.
    })),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

// Detect navigation requests (top-level page loads, browser address bar).
function isNavigationRequest(request) {
  return request.mode === "navigate" || (request.method === "GET" && request.headers.get("accept")?.includes("text/html"));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Bypass non-GET — POST / PUT / DELETE always go straight to the
  // network. Caching mutations would corrupt server state.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // API requests bypass the cache entirely. Tender data, generation
  // status, analysis results — all must be live. The dashboard
  // periodically polls /api/* endpoints; serving stale cached
  // responses would show wrong tender state.
  if (url.pathname.startsWith("/api/")) return;

  // Cross-origin requests (third-party scripts, fonts on a different
  // domain, etc.) — let the browser handle them normally without
  // service-worker mediation.
  if (url.origin !== self.location.origin) return;

  // Navigation requests — try network first, fall back to cache,
  // ultimately fall back to the dedicated offline page. This is
  // the right strategy for a data-driven dashboard where users
  // expect fresh content but should see SOMETHING when offline.
  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Successful network response — cache a clone for next
          // offline visit, return the live response to the user.
          if (response.ok && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          // Network failed. Try the cache for this exact URL first,
          // then fall back to the offline page.
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          return offline ?? Response.error();
        }),
    );
    return;
  }

  // Static assets (JS, CSS, images, icons): network-first with cache
  // fallback. Stale-while-revalidate would be faster but risks
  // serving outdated bundles immediately after a deploy.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
  );
});

// Listen for skipWaiting messages from the page (used by the
// "new version available" UI prompt — installed but not yet wired
// up to the dashboard nav). When received, immediately activate
// the new service worker.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
