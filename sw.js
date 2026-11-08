// Mantém o app abrindo sem internet. Atualizações entram na abertura seguinte.
const CACHE = 'inspecao-lp-v2';
const ARQUIVOS = [
  './',
  './index.html',
  './css/tokens.css',
  './css/base.css',
  './css/componentes.css',
  './css/telas.css',
  './icons/sprite.svg',
  './js/app.js',
  './js/db.js',
  './js/fotos.js',
  './js/icones.js',
  './js/relatorio.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ARQUIVOS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  evento.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const guardado = await cache.match(request, { ignoreSearch: true });
      const daRede = fetch(request)
        .then((resposta) => {
          if (resposta.ok) cache.put(request, resposta.clone());
          return resposta;
        })
        .catch(() => null);
      if (guardado) {
        evento.waitUntil(daRede);
        return guardado;
      }
      return (await daRede) || Response.error();
    }),
  );
});
