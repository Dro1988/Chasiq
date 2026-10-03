/* Chasiq — offline shell cache. Bump CACHE on each release. */
const CACHE = 'chasiq-v2';
const ASSETS = ['./', './index.html', './assets/styles.css', './assets/app.js', './assets/catalog.js', './assets/history.js', './assets/catalog-c1.js', './assets/catalog-c2.js', './assets/catalog-c3.js', './assets/catalog-c4.js', './assets/catalog-c5.js', './assets/catalog-c6.js', './assets/catalog-c7.js', './assets/catalog-c8.js', './assets/catalog-c9.js', './assets/catalog-c10.js', './assets/catalog-c11.js', './assets/catalog-c12.js', './assets/catalog-c13.js', './assets/catalog-c14.js', './assets/catalog-c15.js', './assets/catalog-c16.js', './assets/catalog-c17.js', './assets/catalog-c18.js', './assets/catalog-c19.js', './assets/catalog-c20.js', './assets/catalog-c21.js', './assets/catalog-c22.js', './assets/catalog-c23.js', './assets/catalog-c24.js', './assets/catalog-c25.js', './assets/catalog-c26.js', './assets/catalog-c27.js', './assets/catalog-c28.js', './assets/catalog-c29.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
