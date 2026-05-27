/**
 * @file sw.js — Service Worker do Norte (PWA)
 * Estratégias:
 *  - Shell (HTML/CSS/JS): Cache First
 *  - Assets (fonts, imagens): Cache First com revalidação
 *  - API (/api/v1/*): Network First com fallback offline
 */

const CACHE_NAME    = 'norte-v1.0.0';
const OFFLINE_PAGE  = '/offline.html';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/auth.html',
  '/investments.html',
  '/reports.html',
  '/manifest.json',
];

// ── Install: pré-cacheia o shell ──────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: limpa caches antigos ────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: estratégia por rota ────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API → Network First
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Navegação → Network First com fallback para cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/') || caches.match(request))
    );
    return;
  }

  // Assets → Cache First
  event.respondWith(cacheFirst(request));
});

const cacheFirst = async (request) => {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
};

const networkFirst = async (request) => {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(
      JSON.stringify({ error: 'Sem conexão. Verifique sua internet.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// ── Push Notifications (futuro) ───────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Norte', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: data.tag || 'norte-notification',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});
