/* Chasiq — offline shell cache. Bump CACHE on each release. */
const CACHE = 'chasiq-v14';
const ASSETS = ['./', './index.html', './assets/styles.css', './assets/app.js', './assets/catalog.js', './assets/history.js', './assets/catalog-c1.js', './assets/catalog-c2.js', './assets/catalog-c3.js', './assets/catalog-c4.js', './assets/catalog-c5.js', './assets/catalog-c6.js', './assets/catalog-c7.js', './assets/catalog-c8.js', './assets/catalog-c9.js', './assets/catalog-c10.js', './assets/catalog-c11.js', './assets/catalog-c12.js', './assets/catalog-c13.js', './assets/catalog-c14.js', './assets/catalog-c15.js', './assets/catalog-c16.js', './assets/catalog-c17.js', './assets/catalog-c18.js', './assets/catalog-c19.js', './assets/catalog-c20.js', './assets/catalog-c21.js', './assets/catalog-c22.js', './assets/catalog-c23.js', './assets/catalog-c24.js', './assets/catalog-c25.js', './assets/catalog-c26.js', './assets/catalog-c27.js', './assets/catalog-c28.js', './assets/catalog-c29.js', './assets/catalog-c30.js', './assets/catalog-c31.js', './assets/catalog-c32.js', './assets/catalog-c33.js', './assets/catalog-c34.js', './assets/catalog-c35.js', './assets/catalog-c36.js', './assets/catalog-c37.js', './assets/catalog-c38.js', './assets/catalog-c39.js', './assets/catalog-c40.js', './assets/catalog-c41.js', './assets/catalog-c42.js', './assets/catalog-c43.js', './assets/catalog-c44.js', './assets/catalog-c45.js', './assets/catalog-c46.js', './assets/catalog-c47.js', './assets/catalog-c48.js', './assets/catalog-c49.js', './assets/catalog-c50.js', './assets/catalog-c51.js', './assets/catalog-c52.js', './assets/catalog-c53.js', './assets/catalog-c54.js', './assets/catalog-c55.js', './assets/catalog-c56.js', './assets/catalog-c57.js', './assets/catalog-c58.js', './assets/catalog-c59.js', './assets/catalog-c60.js', './assets/catalog-c61.js', './assets/catalog-c62.js', './assets/catalog-c63.js', './assets/catalog-c64.js', './assets/catalog-c65.js', './assets/catalog-c66.js', './assets/catalog-c67.js', './assets/catalog-c68.js', './assets/catalog-c69.js', './assets/catalog-c70.js', './assets/catalog-c71.js', './assets/catalog-c72.js', './assets/catalog-c73.js', './assets/catalog-c74.js', './assets/catalog-c75.js', './assets/catalog-c76.js', './assets/catalog-c77.js', './assets/catalog-c78.js', './assets/catalog-c79.js', './assets/catalog-c80.js', './assets/catalog-c81.js', './assets/catalog-c82.js', './assets/catalog-c83.js', './assets/hwr-c1.js', './assets/hwr-c2.js', './assets/hwr-c3.js', './assets/hwr-c4.js', './assets/hwr-c5.js', './assets/hwr-c6.js', './assets/hwr-c7.js', './assets/hwr-c8.js', './assets/hwr-c9.js', './assets/hwr-c10.js', './assets/hwr-c11.js', './assets/hwr-c12.js', './assets/hwr-c13.js', './assets/hwr-c14.js', './assets/hwr-c15.js', './assets/hwr-c16.js', './assets/hwr-c17.js', './assets/hwr-c18.js', './assets/hwr-c19.js', './assets/hwr-c20.js', './assets/hwr-c21.js', './assets/hwr-c22.js', './assets/hwr-c23.js', './assets/hwr-c24.js', './assets/hwr-c25.js', './assets/hwr-c26.js', './assets/hwr-c27.js', './assets/hwr-c28.js', './assets/hwr-c29.js', './assets/hwr-c30.js', './assets/hwr-c31.js', './assets/hwr-c32.js', './assets/hwr-c33.js', './assets/hwr-c34.js', './assets/hwr-c35.js', './assets/hwr-c36.js', './assets/hwr-c37.js', './assets/hwr-c38.js', './assets/hwr-c39.js', './assets/hwr-c40.js', './assets/hwr-c41.js', './assets/hwr-c42.js', './assets/hwr-c43.js', './assets/hwr-c44.js', './assets/hwr-c45.js', './assets/hwr-c46.js', './assets/hwr-c47.js', './assets/hwr-c48.js', './assets/hwr-c49.js', './assets/hwr-c50.js', './assets/hwr-c51.js', './assets/hwr-c52.js', './assets/hwr-c53.js', './assets/hwr-c54.js', './assets/hwr-c55.js', './assets/hwr-c56.js', './assets/hwr-c57.js', './assets/hwr-c58.js', './assets/hwr-c59.js', './assets/hwr-c60.js', './assets/hwr-c61.js', './assets/hwr-c62.js', './assets/hwr-c63.js', './assets/hwr-c64.js', './assets/hwr-c65.js', './assets/hwr-c66.js', './assets/hwr-c67.js', './assets/hwr-c68.js', './assets/hwr-c69.js', './assets/hwr-c70.js', './assets/hwr-c71.js', './assets/hwr-c72.js', './assets/hwr-c73.js', './assets/hwr-c74.js', './assets/hwr-c75.js', './assets/hwr-c76.js', './assets/hwr-c77.js', './assets/hwr-c78.js', './assets/hwr-c79.js', './assets/hwr-c80.js', './assets/hwr-c81.js', './assets/hwr-c82.js', './assets/hwr-c83.js', './assets/hwr-c84.js', './assets/hwr-c85.js', './assets/hwr-c86.js', './assets/hwr-c87.js', './assets/hwr-c88.js', './assets/hwr-c89.js', './assets/hwr-c90.js', './assets/hwr-c91.js', './assets/hwr-c92.js', './assets/hwr-c93.js', './assets/hwr-c94.js', './assets/hwr-c95.js', './assets/hwr-c96.js', './assets/hwr-c97.js', './assets/hwr-c98.js', './assets/hwr-c99.js', './assets/hwr-c100.js', './assets/hwr-c101.js', './assets/hwr-c102.js', './assets/hwr-c103.js', './assets/hwr-c104.js', './assets/hwr-c105.js', './assets/hwr-c106.js', './assets/hwr-c107.js', './assets/hwr-c108.js', './assets/hwr-c109.js', './assets/hwr-c110.js', './assets/hwr-c111.js', './assets/hwr-c112.js', './assets/hwr-c113.js', './assets/hwr-c114.js', './assets/hwr-c115.js', './assets/hwr-c116.js', './assets/hwr-c117.js', './assets/hwr-c118.js', './assets/hwr-c119.js'];

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
