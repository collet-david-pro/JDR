/*
 * JDR service worker (projet.md section 13.5).
 *
 * Built by build/sw-plugin.ts into the repository root `sw.js` (scope = base_path + '/').
 * The plugin prepends SW_VERSION and SW_PRECACHE; this file must not import anything.
 *
 * Strategy:
 * - hashed build files (assets/*): cache first (precached at install);
 * - signed asset files (/api/v1/files/...): cache first (URL stable for a day, immutable);
 * - any other /api/v1 request: never cached (network only);
 * - page navigations: network first, last good shell as offline fallback;
 * - install.php / update.php / cron.php: network only.
 * A new version waits until the page asks it to activate (message SKIP_WAITING): never a
 * forced reload during a running game session.
 */

declare const SW_VERSION: string;
declare const SW_PRECACHE: readonly string[];

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'jdr-';
const STATIC_CACHE = `${CACHE_PREFIX}static-${SW_VERSION}`;
const SHELL_CACHE = `${CACHE_PREFIX}shell`;
const FILES_CACHE = `${CACHE_PREFIX}files`;
const FILES_CACHE_MAX_ENTRIES = 300;
const SHELL_KEY = 'shell';

const scopeUrl = new URL(sw.registration.scope);
const scopePath = scopeUrl.pathname; // always ends with '/'

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(SW_PRECACHE.map((file) => scopePath + file))),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(`${CACHE_PREFIX}static-`) && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('message', (event) => {
  const data: unknown = event.data;
  if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'SKIP_WAITING') {
    void sw.skipWaiting();
  }
});

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopePath)) return;

  const kind = classify(url, request);
  switch (kind) {
    case 'static':
      event.respondWith(cacheFirst(request, STATIC_CACHE, false));
      return;
    case 'file':
      event.respondWith(cacheFirst(request, FILES_CACHE, true));
      return;
    case 'navigation':
      event.respondWith(networkFirstShell(request));
      return;
    case 'network':
      return;
  }
});

type RequestKind = 'static' | 'file' | 'navigation' | 'network';

function classify(url: URL, request: Request): RequestKind {
  const path = url.pathname.slice(scopePath.length); // relative to the scope, no leading '/'
  // Query routing mode: index.php?r=/api/v1/...
  const apiPath = path === 'index.php' ? (url.searchParams.get('r') ?? '') : `/${path}`;

  if (apiPath.startsWith('/api/v1/files/')) {
    // Range requests produce 206 responses that the Cache API cannot store.
    return request.headers.has('range') ? 'network' : 'file';
  }
  if (apiPath.startsWith('/api/')) return 'network';
  if (path.startsWith('assets/')) return 'static';
  if (path === 'install.php' || path === 'update.php' || path === 'cron.php') return 'network';
  if (request.mode === 'navigate') return 'navigation';
  return 'network';
}

/**
 * Cache first. A failing cache (storage error, eviction, private mode) never fails the request:
 * the network answer is returned and stored in the background.
 */
async function cacheFirst(request: Request, cacheName: string, trim: boolean): Promise<Response> {
  let cache: Cache | null;
  try {
    cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch {
    cache = null;
  }
  const response = await fetch(request);
  if (cache !== null && response.ok && response.status === 200) {
    const store = cache;
    const copy = response.clone();
    void (async () => {
      try {
        await store.put(request, copy);
        if (trim) await trimCache(store, FILES_CACHE_MAX_ENTRIES);
      } catch {
        // Not cached this time.
      }
    })();
  }
  return response;
}

async function trimCache(cache: Cache, maxEntries: number): Promise<void> {
  const keys = await cache.keys();
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i++) {
    const key = keys[i];
    if (key) await cache.delete(key);
  }
}

async function networkFirstShell(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    const type = response.headers.get('content-type') ?? '';
    if (response.ok && response.status === 200 && type.includes('text/html')) {
      await cache.put(SHELL_KEY, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(SHELL_KEY);
    if (cached) return cached;
    throw error;
  }
}
