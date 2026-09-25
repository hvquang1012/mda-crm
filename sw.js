const CACHE = 'mda-progress-v5';
const SHELL = [
  './', './index.html', './crew.html', './client.html', './manifest.json',
  './config.js', './css/app.css', './assets/logo-minh-duc.png', './icon-192.png', './icon-512.png',
  './apple-touch-icon.png', './vendor/supabase-js@2.45.4.min.js',
  './vendor/fonts/plus-jakarta-sans-latin-wght-normal.woff2',
  './vendor/fonts/plus-jakarta-sans-latin-ext-wght-normal.woff2',
  './vendor/fonts/plus-jakarta-sans-vietnamese-wght-normal.woff2',
  ...['dashboard', 'approve', 'tasks', 'alert', 'report', 'history'].map(n => `./assets/icons/${n}.svg`)
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
  // Cùng tag (vd. báo cáo mới của 1 công trình) thì thay thông báo cũ, vẫn rung
  if (payload.tag) { options.tag = payload.tag; options.renotify = true; }
  e.waitUntil(self.registration.showNotification(title, options));
});

// Bấm thông báo: app đang mở thì chuyển tới đúng tab, chưa mở thì mở mới
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './index.html', self.registration.scope);
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (new URL(c.url).pathname === url.pathname && 'focus' in c) {
          c.postMessage({ type: 'open-tab', tab: url.hash.slice(1) });
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url.href);
    })
  );
});
