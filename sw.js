const CACHE = 'rm-telha-termica-v1';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => caches.open(CACHE).then(c => c.add(JSPDF).catch(() => {})))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        try {
          if (res && res.status === 200 && new URL(req.url).origin === location.origin) {
            const cp = res.clone();
            caches.open(CACHE).then(c => c.put(req, cp));
          }
        } catch (_) {}
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
