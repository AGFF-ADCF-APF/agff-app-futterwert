/* Futter v2 – Service Worker: App-Shell offline verfügbar. API-Daten (Server-Freigaben) werden nie gecacht. */
const VERSION = 'futter-v2-b1-21';
const SHELL = ['./', 'assets/boot.js?v=b1-21', 'assets/app.css?v=b1-21', 'assets/k3.js?v=b1-21', 'assets/model.js?v=b1-21', 'assets/crypto.js?v=b1-21', 'assets/foto.js?v=b1-21', 'assets/wheel.js?v=b1-21', 'assets/io.js?v=b1-21', 'assets/kurs.js?v=b1-21', 'assets/ocr.js?v=b1-21', 'assets/statistik.js?v=b1-21', 'assets/assistent.js?v=b1-21', 'assets/app.js?v=b1-21',
  'assets/bilder/stadien-page-1.webp', 'assets/bilder/knaulgras.webp', 'assets/bilder/rotklee.webp', 'assets/bilder/b2-stadien-1.webp', 'assets/bilder/wringprobe-1.webp',
  'assets/icon.svg', 'manifest.webmanifest', 'api/basis', 'assets/vendor/jspdf.umd.min.js', 'assets/vendor/qrcode.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('futter-v2') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  const rel = url.pathname.slice(scope.pathname.length);
  if (rel.startsWith('api/') && rel !== 'api/basis') return; // Server-Freigaben immer live
  // Netzwerk zuerst (aktuelle Version), bei Offline aus dem Cache
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: rel === '' || e.request.mode === 'navigate' })
    .then((r) => r || (e.request.mode === 'navigate' ? caches.match('./') : undefined))));
});
