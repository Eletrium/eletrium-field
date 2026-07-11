// ============================================================
// Service Worker — Eletrium Field
// Cacheia o app inteiro (HTML/CSS/JS/manifest/ícones) na
// primeira visita, para que ele ABRA mesmo sem sinal nenhum.
// As CHAMADAS DE DADOS (fetch para o Apps Script) continuam
// precisando de rede — isso é tratado separadamente no
// index.html via fila no IndexedDB (enfileirarChamada).
// ============================================================

const CACHE_NAME = 'eletrium-field-v3';
const ARQUIVOS_PARA_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Instala e cacheia o app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARQUIVOS_PARA_CACHE))
  );
  self.skipWaiting();
});

// Limpa caches antigos quando uma nova versão do SW é ativada
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(
        nomes
          .filter((nome) => nome !== CACHE_NAME)
          .map((nome) => caches.delete(nome))
      )
    )
  );
  self.clients.claim();
});

// Estratégia: cache primeiro para os arquivos do app shell.
// Chamadas para o Apps Script (POST de dados) NUNCA são
// cacheadas — sempre vão direto para a rede, e se falharem,
// o próprio index.html cuida da fila offline.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nunca interceptar chamadas ao backend (Apps Script) —
  // essas precisam sempre ir para a rede ou falhar de verdade,
  // para que o index.html saiba que precisa enfileirar.
  if (url.hostname.includes('script.google.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((respostaCache) => {
      if (respostaCache) return respostaCache;
      return fetch(event.request).catch(() => {
        // Sem cache e sem rede: só falha silenciosamente
        // (o app shell já devia estar cacheado desde a instalação)
      });
    })
  );
});
