self.addEventListener('install', e => {
  e.waitUntil(
    caches.open('iot-dashboard-cache').then(cache => {
      return cache.addAll([
        '/',
        '/index.html',
        '/manifest.json',
        '/img/logo.jpeg',
        '/img/logo.jpeg'
      ]);
    })
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(response => response || fetch(e.request))
  );
});
