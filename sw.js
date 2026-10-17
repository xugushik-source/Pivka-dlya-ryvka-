// Service worker: only the site's shell (pages, styles, scripts, icons) is kept for a weak connection.
// Catalog, prices, stock and orders come from Supabase (another origin) — never touched here, always fresh.
// Pages and scripts: network first (a new version shows at once), the cached copy only when offline.
const CACHE = 'pivka-shell-20261017b';
const SHELL = ['./', './index.html', './order.html', './config.js', './manifest.json', './assets/pwa/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;           // API, CDN, analytics: straight to the network
  if (!/\.(html|js|css|json|png|svg|webp|jpg)$/.test(url.pathname) && req.mode !== 'navigate' && url.pathname !== '/') return;
  if (/\.(mp4|mp3|m4a)$/.test(url.pathname)) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((r) => r || caches.match('./index.html'))));
});
