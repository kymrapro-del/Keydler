// Réécrit à la construction par `scripts/precache.mjs`, qui y met les noms
// réels des fichiers produits — ils portent une empreinte, donc ils ne peuvent
// pas être écrits à la main. Le nom du cache porte la même empreinte : sans
// cela, `activate` ne supprimait jamais rien et une entrée fautive survivait à
// tous les déploiements.
const CACHE = 'watch-log-dev'
const SHELL = ['/index.html', '/manifest.webmanifest', '/icons/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Sans ce contrôle, un hôte qui rend 404 sur une adresse profonde
          // voyait sa page d'erreur écrite PAR-DESSUS `/index.html` : le repli
          // hors ligne servait ensuite ce 404 pour toute navigation, y compris
          // la racine, et rien ne le rattrapait.
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put('/index.html', copy))
          }
          return response
        })
        .catch(() =>
          caches
            .match('/index.html')
            .then((hit) => hit ?? new Response('Offline', { status: 503 })),
        ),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})
