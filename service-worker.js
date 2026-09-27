/*
 * Insulin Dose Calculator – service worker (makes the app work offline).
 *
 * IMPORTANT: whenever you change ANY file of the app (for example the
 * plan numbers in app.js), change CACHE_VERSION below (v1 → v2 → v3 …).
 * That is how the phone knows to download the new files.
 */
const CACHE_PREFIX = 'insulin-dose-calculator-';
const CACHE_VERSION = CACHE_PREFIX + 'v1';

const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // cache: 'reload' skips the browser cache so the newest files are stored
      .then(cache => cache.addAll(APP_FILES.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Offline first: answer from the saved copy, fall back to the network.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(cache =>
      cache.match(request, { ignoreSearch: true }).then(cached => {
        if (cached) return cached;
        return fetch(request).catch(() => {
          if (request.mode === 'navigate') return cache.match('./index.html');
          return Response.error();
        });
      })
    )
  );
});
