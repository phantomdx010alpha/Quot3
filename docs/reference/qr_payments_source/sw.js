// MB QR Pay — Service Worker
const CACHE_NAME = "mb-qr-v7";

// Install: cache core assets, skip waiting so new SW activates immediately
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(["./index.html", "./manifest.json"])
        .then(() => Promise.allSettled(
          ["https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"]
            .map(url => fetch(url).then(res => cache.put(url, res)).catch(() => {}))
        ))
    ).then(() => self.skipWaiting()) // <-- take over immediately, no waiting
  );
});

// Activate: wipe old caches, claim all tabs immediately
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim()) // <-- control all open tabs right away
      .then(() => {
        // Tell all open tabs to reload so they get the fresh version
        self.clients.matchAll({ type: "window" }).then(clients => {
          clients.forEach(client => client.navigate(client.url));
        });
      })
  );
});

// Fetch: network-first for HTML (always fresh), cache-first for everything else
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Bypass external navigations (WhatsApp links etc.)
  if (event.request.mode === "navigate" && url.hostname !== self.location.hostname) return;

  // Network-first for the main HTML page so updates always come through
  if (event.request.mode === "navigate" || url.pathname.endsWith("index.html")) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Cache-first for everything else (fonts, qrcode lib, etc.)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === "navigate") return caches.match("./index.html");
      });
    })
  );
});
