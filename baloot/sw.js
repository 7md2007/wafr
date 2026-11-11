/* Baloot offline support. Scope = /baloot/ only (Wafr has its own worker at the root).
   App files: network first (updates show at once), cached copy when offline. AI calls are never cached. */
const C = 'baloot-v1';
const SHELL = ['./', './index.html', './config.js', './engine.js', './vision.js', './synth.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  '../fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2', '../fonts/ibm-plex-sans-arabic-arabic-500-normal.woff2',
  '../fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2', '../fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2',
  '../fonts/inter-latin-600-normal.woff2', '../fonts/inter-latin-700-normal.woff2'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('baloot-') && x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // AI server, camera uploads: straight to the network
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(req, cp)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(m => m || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
