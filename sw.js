// TeraStockX service worker: makes the site installable and usable offline.
// Network first for everything, so code and data are always current when online;
// the cache is only a fallback (offline, or a failed request).
const CACHE = "tsx-v1";
const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "assets/css/style.css",
  "assets/js/app.js", "assets/js/scoring.js", "assets/js/charts.js", "assets/js/portfolio.js",
  "assets/js/i18n/index.js", "assets/js/i18n/en.js", "assets/js/i18n/hu.js", "assets/js/i18n/de.js", "assets/js/i18n/fr.js", "assets/js/i18n/es.js",
  "assets/img/logo.svg", "assets/img/hero.svg", "assets/img/icons/icon-192.png", "assets/img/icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok && (sameOrigin || res.type === "cors" || res.type === "opaque")) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") return (await cache.match("index.html")) || Response.error();
      throw err;
    }
  })());
});
