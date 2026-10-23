// Caches the app shell and the latest feeds.json. Audio is never cached (iOS range-request issues).
const VERSION = "v2";
const SHELL = `shell-${VERSION}`;
const DATA = "data";
const FILES = ["./", "index.html", "style.css", "app.js", "bible.js", "manifest.json", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never touch audio or any cross-origin request (artwork, enclosures).
  if (url.origin !== location.origin) return;
  if (req.headers.has("range") || /\.(mp3|m4a|aac|wav|ogg)$/i.test(url.pathname)) return;

  // feeds.json: network first, fall back to last copy.
  if (url.pathname.endsWith("/feeds.json") || url.pathname.endsWith("feeds.json")) {
    e.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA).then((c) => c.put("feeds.json", copy));
          return res;
        })
        .catch(() => caches.open(DATA).then((c) => c.match("feeds.json")))
    );
    return;
  }

  // App shell: cache first, refresh in background.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
