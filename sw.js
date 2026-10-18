/* Offline shell for the league. Bump CACHE when this file's logic changes; page assets update through their ?v= URLs.
   - Pages (navigations): network first, cached copy when offline or the network stalls.
   - Same-origin assets and Google Fonts: stale-while-revalidate, keyed by full URL so a new ?v= is a new entry.
   - Supabase and every non-GET request go straight to the network and are never cached. */
const CACHE = 'pp-shell-20261018-12';
const PAGES = ['index.html', 'predictions.html', 'dashboard.html', 'stats.html', 'archive.html', 'backup.html', 'admin.html', 'dummy.html'];
const EXTRA = ['manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const NETWORK_WAIT_MS = 4000;

const scopeUrl = path => new URL(path, self.registration.scope).href;
const isSupabase = url => /(^|\.)supabase\.(co|in|com)$/.test(url.hostname);

// The asset list comes from the pages themselves, so the shell always matches the ?v= URLs the HTML asks for.
async function precache() {
  const cache = await caches.open(CACHE);
  const assets = new Set(EXTRA.map(scopeUrl));
  await Promise.all(PAGES.map(async page => {
    try {
      const res = await fetch(scopeUrl(page), { cache: 'reload' });
      if (!res.ok) return;
      await cache.put(scopeUrl(page), res.clone());
      const html = await res.text();
      for (const [, ref] of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
        const url = new URL(ref, scopeUrl(page));
        if (url.origin === self.location.origin && !url.pathname.endsWith('.html')) assets.add(url.href);
        else if (url.hostname === 'fonts.googleapis.com' && url.pathname.startsWith('/css')) assets.add(url.href);
      }
    } catch {}
  }));
  await Promise.all([...assets].map(href => cache.add(new Request(href, { cache: 'reload' })).catch(() => {})));
}

self.addEventListener('install', event => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('pp-shell-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Older ?v= copies of the same file are dropped once a newer one is stored.
async function putVersioned(cache, request, response) {
  const url = new URL(request.url);
  await cache.put(request, response);
  if (!url.search || url.origin !== self.location.origin) return;
  const stale = await cache.keys();
  await Promise.all(stale.filter(old => {
    const o = new URL(old.url);
    return o.pathname === url.pathname && o.search !== url.search;
  }).map(old => cache.delete(old)));
}

async function pageResponse(request) {
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  const key = url.origin + url.pathname;
  const network = fetch(request).then(res => {
    if (res.ok && res.type === 'basic' && !res.redirected) cache.put(key, res.clone());
    return res;
  });
  network.catch(() => {});
  const cached = () => cache.match(key).then(hit => hit || cache.match(scopeUrl('index.html')));
  const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_WAIT_MS)).then(cached);
  try {
    // A stalled connection at the table falls back to the shell after a few seconds; a quick answer always wins.
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    return await network;
  } catch {
    const hit = await cached();
    if (hit) return hit;
    throw new Error('offline and not cached');
  }
}

async function assetResponse(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request);
  const network = fetch(event.request).then(async res => {
    if (res.ok || res.type === 'opaque') await putVersioned(cache, event.request, res.clone());
    return res;
  });
  if (hit) {
    event.waitUntil(network.catch(() => {}));
    return hit;
  }
  return network;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (isSupabase(url)) return;
  if (request.mode === 'navigate') {
    if (url.origin === self.location.origin) event.respondWith(pageResponse(request));
    return;
  }
  if (url.origin === self.location.origin || FONT_HOSTS.has(url.hostname)) event.respondWith(assetResponse(event));
});
