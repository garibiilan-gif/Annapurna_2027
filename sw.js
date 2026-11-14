// Offline cache: the app itself up front, map tiles as they are viewed.
const APP = "annapurna-app-v10";
const TILES = "annapurna-tiles-v1";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== APP && k !== TILES).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = e.request.url;
  if (e.request.method !== "GET") return;
  if (url.includes("tile.opentopomap.org") || url.includes("upload.wikimedia.org")) {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === "opaque") c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  // App files: network first so updates arrive, cache when offline.
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) caches.open(APP).then(c => c.put(e.request, res.clone()));
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
