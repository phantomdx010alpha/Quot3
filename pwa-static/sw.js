// Quot3 phone service worker (Phase 174). Build step replaces the two placeholders; never edit the cache name by hand.
// The shell is precached so the app opens offline. Navigations fall back to the cached shell. Only same-origin GETs are
// handled: Supabase and every other origin go straight to the network. No bill data is ever cached here (that is IndexedDB).
const VERSION = '__QUOT3_VERSION__'
const CACHE = 'quot3-phone-' + VERSION
const PRECACHE = __QUOT3_PRECACHE__

self.addEventListener('install', (event) => {
  // No skipWaiting here: the page asks (message below) only when it is safe to swap code.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('quot3-phone-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')))
    return
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)))
})
