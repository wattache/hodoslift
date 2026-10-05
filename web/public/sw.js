// Service worker Eitri — cache des ASSETS same-origin uniquement.
//
// Politique : network-first avec repli cache (démarrage rapide + tolérance
// hors-ligne sur les fichiers statiques). Tout ce qui est cross-origin —
// l'API brokkr (Cloud Run / localhost), l'auth Google, Storage — n'est JAMAIS
// mis en cache : la fraîcheur des données est le travail de TanStack Query,
// pas du service worker.
//
// CACHE_NAME est patché à chaque build par scripts/version-sw.mjs : le nouveau
// SW purge alors les caches des anciens déploiements (event `activate`).
const CACHE_NAME = 'eitri-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([
      '/',
      '/marque/favicon.svg',
      '/marque/symbole.svg',
      '/manifest.json',
    ]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // Cross-origin (API, auth, Storage…) : on laisse passer, jamais de cache.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // ⚠️ Une page HTML servie à la place d'un script ne se garde jamais :
        // hors ligne, le worker la resservirait comme script, et l'écran planterait.
        const html = (response.headers.get('content-type') || '').includes('text/html');
        const attenduHtml = request.destination === 'document' || request.destination === '';
        if (response.ok && (attenduHtml || !html)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ─── NOTIFICATIONS PUSH (28/09) ──────────────────────────────────────────────
// brokkr pousse `{titre, corps, url}` quand le coach génère une semaine. Le
// worker n'affiche que ce qu'il reçoit : aucune donnée n'est lue ici.
self.addEventListener('push', (event) => {
  let contenu = { titre: 'Hodos', corps: '', url: '/' };
  try { contenu = { ...contenu, ...event.data.json() }; } catch { /* un texte nu : le titre suffit */ }
  event.waitUntil(self.registration.showNotification(contenu.titre, {
    body: contenu.corps,
    icon: '/marque/symbole.svg',
    badge: '/marque/symbole.svg',
    data: { url: contenu.url },
    // Une seule notification « nouvelle semaine » à la fois : la suivante remplace.
    tag: 'nouvelle-semaine',
  }));
});

// Toucher la notification ouvre l'app sur la page visée — ou y ramène l'onglet déjà ouvert.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenetres) => {
      const ouverte = fenetres.find((f) => f.url.startsWith(self.location.origin));
      if (ouverte) return ouverte.navigate(url).then((f) => f && f.focus());
      return self.clients.openWindow(url);
    })
  );
});
