/* Soul Suite service worker.
 *
 * Hand-rolled (no next-pwa) because next-pwa's App Router story in Next 15 is
 * still rough. We don't need precaching of every chunk — the goal is just
 *   1. Make the app installable (browsers require an active SW for the install prompt).
 *   2. Survive a flaky network on already-visited pages (offline shell).
 *
 * Strategy:
 *  - /_next/static/*   → stale-while-revalidate (immutable hashed assets, safe to serve from cache).
 *  - /api/*            → network-only (auth, mutations, freshness matter).
 *  - public booking pages /[slug]/[mt]/* → network-only (invitees need fresh slots).
 *  - All other navigations → network-first with cache fallback (offline shell).
 *  - Other GETs        → stale-while-revalidate.
 *
 * Bump CACHE_VERSION whenever the strategy changes; old caches are pruned on activate.
 */

const CACHE_VERSION = "v1";
const RUNTIME_CACHE = `soul-suite-runtime-${CACHE_VERSION}`;
const PAGES_CACHE = `soul-suite-pages-${CACHE_VERSION}`;
const OFFLINE_URL = "/dashboard";

self.addEventListener("install", (event) => {
  // Take over as fast as possible so an updated SW doesn't wait for every tab to close.
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== RUNTIME_CACHE && k !== PAGES_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/fonts/");
}

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

function isAuthRoute(url) {
  return url.pathname.startsWith("/auth/");
}

function isPublicBooking(url) {
  // Public booking pages: /[slug]/[meetingTypeSlug]/...
  // Heuristic — anything not under /dashboard, /settings, /onboarding, /api, /auth, /support, /privacy, /terms, /tour, /poll, /invite, /request-access
  // and at least two path segments. The first segment is the host slug.
  const reservedTops = new Set([
    "dashboard",
    "settings",
    "onboarding",
    "api",
    "auth",
    "support",
    "privacy",
    "terms",
    "tour",
    "poll",
    "invite",
    "request-access",
    "_next",
    "icons",
    "fonts",
    "manifest.webmanifest",
    "sw.js",
    "favicon.ico",
    "apple-touch-icon.png",
  ]);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return false;
  return !reservedTops.has(parts[0]);
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200 && response.type === "basic") {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Fall back to the offline shell for navigations.
    if (request.mode === "navigate") {
      const shell = await cache.match(OFFLINE_URL);
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Cross-origin: leave it alone.
  if (url.origin !== self.location.origin) return;

  if (isApi(url) || isAuthRoute(url) || isPublicBooking(url)) {
    // Always network — no caching.
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGES_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});
