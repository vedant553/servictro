/**
 * ServiceOS service worker (audit PWA-02/03/04/05/07).
 *
 * Strategy per request class:
 *  - App shell navigations: network-first → cache → /offline fallback page.
 *  - Static build assets (/_next/static): cache-first, ONLY when the server
 *    marks them immutable (production builds do; dev/HMR assets do not — so
 *    the same worker is safe in both).
 *  - Technician job pack + sync status (GET /api/v1/mobile/...): network-first
 *    with a cache fallback — this is what makes assigned work readable after
 *    a browser restart in a dead zone. Mutations (POST/PATCH/DELETE) are
 *    NEVER intercepted or cached: they go through the durable localStorage
 *    queue in lib/offline-store instead.
 *  - Manifest/icons: precached at install.
 *
 * Durable sync (PWA-05): the page registers a Background Sync tag when
 * captures are queued; on the browser's 'sync' event (fired on reconnect,
 * including after the tab was closed) the worker messages every client,
 * which re-runs the push. A 'serviceos:push-complete' message lets the
 * worker learn the outcome for future diagnostics.
 *
 * Update policy: cache names are versioned; on activate, stale caches are
 * deleted and clients are claimed so registration takes effect immediately.
 */
const VERSION = 'v1';
const SHELL_CACHE = `serviceos-shell-${VERSION}`;
const STATIC_CACHE = `serviceos-static-${VERSION}`;
const API_CACHE = `serviceos-mobile-${VERSION}`;
const OFFLINE_URL = '/offline';

const PRECACHE_URLS = [OFFLINE_URL, '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon-512-maskable.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individual adds: one failing asset must not abort the whole install.
      await Promise.all(PRECACHE_URLS.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE, API_CACHE]);
      for (const name of await caches.keys()) {
        if (!keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/** GET-only mobile data endpoints that back offline job access. */
function isMobileDataPath(pathname) {
  return pathname === '/api/v1/mobile/job-packs' || pathname === '/api/v1/mobile/sync/status';
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // mutations: never intercepted

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Static build assets: cache-first when immutable (production only).
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/__nextjs')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok && (response.headers.get('cache-control') || '').includes('immutable')) {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(request, response.clone()).catch(() => undefined);
        }
        return response;
      })(),
    );
    return;
  }

  // Mobile data: network-first, cache fallback (stale pack beats no pack).
  if (isMobileDataPath(url.pathname)) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(API_CACHE);
            cache.put(request, response.clone()).catch(() => undefined);
          }
          return response;
        } catch (error) {
          const cached = await caches.match(request);
          if (cached) return cached;
          throw error;
        }
      })(),
    );
    return;
  }

  // Navigations: network-first → shell cache → offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          return response;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          return offline ?? new Response('ServiceOS is offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
      })(),
    );
  }
});

/* ------------------------------------------------------------------ */
/* Durable synchronization (PWA-05)                                     */
/* ------------------------------------------------------------------ */

self.addEventListener('sync', (event) => {
  if (event.tag !== 'serviceos-sync') return;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      for (const client of clients) {
        client.postMessage({ type: 'serviceos:trigger-sync', tag: event.tag });
      }
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  // Pages report push outcomes so the worker can log/extend diagnostics.
  if (data.type === 'serviceos:push-complete') {
    // Intentionally no storage of results — no sensitive sync data in SW.
  }
});
