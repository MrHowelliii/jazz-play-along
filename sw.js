// Service worker: the app, the song library and the instruments are kept on the device, so Jazz Play-Along opens
// from the home screen and plays without a connection. The book PDFs (the "Original page" view) are large and are
// not kept: that view needs a connection.
const VERSION = 'play-along-v2';
const SHELL = ['./', 'index.html', 'player.js', 'notation.js', 'songform.js', 'studio.css', 'app/player.css', 'manifest.webmanifest',
  'icons/icon-192.png', 'songs.json', 'books.json', 'leads/462jazz.json', 'engine/worklet.js', 'engine/jazzband.wasm',
  'engine/packs/jbdrums.jbp', 'engine/packs/jbbass.jbp', 'engine/packs/jbpiano.jbp', 'engine/packs/jbguitar.jbp', 'engine/packs/jblead.jbp'];
const BINARY = /\.(wasm|jbp|png|woff2?)$|\/vendor\//;        // never change under the same name within a version

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || req.headers.has('range') || url.pathname.includes('/books/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const keep = (res) => { if (res.ok && res.status === 200) cache.put(req, res.clone()); return res; };
    if (BINARY.test(url.pathname)) return (await cache.match(req)) || keep(await fetch(req));
    try { return keep(await fetch(req)); }                    // pages, code and data: the newest when online
    catch (err) {
      const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' }) || (req.mode === 'navigate' && await cache.match('./'));
      if (hit) return hit;
      throw err;
    }
  })());
});
