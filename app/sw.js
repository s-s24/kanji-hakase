// オフライン対応: 本体とデータは最初に保存、筆順データは見た分だけ保存
const VERSION = 'kanji-v2';
const CORE = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icon.svg', 'icon-180.png', 'icon-512.png',
  'data/kanji.json', 'data/radicals.json', 'data/hw.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;
  // 保存済みがあれば即それを返し、裏で最新版に更新(次回起動時に反映)
  e.respondWith(
    caches.open(VERSION).then((cache) => cache.match(e.request, { ignoreSearch: true }).then((hit) => {
      const net = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; });
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    }))
  );
});
