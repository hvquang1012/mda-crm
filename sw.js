const CACHE = 'mda-progress-v2';
const SHELL = [
  './', './index.html', './crew.html', './client.html', './manifest.json',
  './config.js', './css/app.css', './assets/logo-minh-duc.png', './icon-192.png', './icon-512.png',
  './vendor/supabase-js@2.45.4.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first cho toàn bộ shell: luôn thử lấy bản mới nhất trước,
// chỉ rơi về cache khi mất mạng. Bản v1 dùng cache-first khiến máy đã
// cài PWA kẹt ở bản cũ vĩnh viễn sau mỗi lần deploy mới.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('supabase.co')) return; // không cache API/data — luôn cần mới nhất
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(cache => cache.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// ---- Web Push ----
self.addEventListener('push', (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (err) { payload = { title: 'Minh Đức Tiến độ', body: e.data ? e.data.text() : '' }; }
  const title = payload.title || 'Minh Đức Tiến độ';
  const options = {
    body: payload.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: payload.url || './index.html' }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './index.html';
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      for (const c of list) { if (c.url.includes(url) && 'focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
