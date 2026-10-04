/* Chasiq — offline shell cache. Bump CACHE on each release. */
const CACHE = 'chasiq-v13';
const ASSETS = ['./', './index.html', './assets/styles.css', './assets/app.js', './assets/catalog.js', './assets/history.js', './assets/catalog-c1.js', './assets/catalog-c2.js', './assets/catalog-c3.js', './assets/catalog-c4.js', './assets/catalog-c5.js', './assets/catalog-c6.js', './assets/catalog-c7.js', './assets/catalog-c8.js', './assets/catalog-c9.js', './assets/catalog-c10.js', './assets/catalog-c11.js', './assets/catalog-c12.js', './assets/catalog-c13.js', './assets/catalog-c14.js', './assets/catalog-c15.js', './assets/catalog-c16.js', './assets/catalog-c17.js', './assets/catalog-c18.js', './assets/catalog-c19.js', './assets/catalog-c20.js', './assets/catalog-c21.js', './assets/catalog-c22.js', './assets/catalog-c23.js', './assets/catalog-c24.js', './assets/catalog-c25.js', './assets/catalog-c26.js', './assets/catalog-c27.js', './assets/catalog-c28.js', './assets/catalog-c29.js', './assets/catalog-c30.js', './assets/catalog-c31.js', './assets/catalog-c32.js', './assets/catalog-c33.js', './assets/catalog-c34.js', './assets/catalog-c35.js', './assets/catalog-c36.js', './assets/catalog-c37.js', './assets/catalog-c38.js', './assets/catalog-c39.js', './assets/catalog-c40.js', './assets/catalog-c41.js', './assets/catalog-c42.js', './assets/catalog-c43.js', './assets/catalog-c44.js', './assets/catalog-c45.js', './assets/catalog-c46.js', './assets/catalog-c47.js', './assets/catalog-c48.js', './assets/catalog-c49.js', './assets/catalog-c50.js', './assets/catalog-c51.js', './assets/catalog-c52.js', './assets/catalog-c53.js', './assets/catalog-c54.js', './assets/catalog-c55.js', './assets/catalog-c56.js', './assets/catalog-c57.js', './assets/catalog-c58.js', './assets/catalog-c59.js', './assets/catalog-c60.js', './assets/catalog-c61.js', './assets/catalog-c62.js', './assets/catalog-c63.js', './assets/catalog-c64.js', './assets/catalog-c65.js', './assets/catalog-c66.js', './assets/catalog-c67.js', './assets/catalog-c68.js', './assets/catalog-c69.js', './assets/catalog-c70.js', './assets/catalog-c71.js', './assets/catalog-c72.js', './assets/catalog-c73.js', './assets/catalog-c74.js', './assets/catalog-c75.js', './assets/catalog-c76.js', './assets/catalog-c77.js', './assets/catalog-c78.js', './assets/catalog-c79.js', './assets/catalog-c80.js', './assets/catalog-c81.js', './assets/catalog-c82.js', './assets/catalog-c83.js'];

self.addEventListener('install', e => {
  // allSettled: one flaky asset must never kill the whole update (addAll
  // rejects entirely if a single file fails, leaving phones stuck forever).
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.allSettled(ASSETS.map(u => c.add(u).catch(()=>null)))
  ).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isPage = e.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');
  if (isPage) {
    // Pages: network-first so the app shell never goes stale; fall back to cache offline.
    e.respondWith(
      fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }
  // Versioned assets: cache-first.
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
