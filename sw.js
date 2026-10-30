'use strict';

// Bump on every content change: a new version is what makes phones download the new files
const VERSION = 'prep-10';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'highlight.js',
  'manifest.json',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'sections/dotnet.js',
  'sections/databases.js',
  'sections/kafka.js',
  'sections/sysdesign.js',
  'sections/aspnet.js',
  'sections/testing.js',
  'sections/architecture.js',
  'sections/coding.js',
  'sections/personal.lock.js',
  'sections/redis.js'
];

self.addEventListener('install', event => {
  // `reload` skips the browser's own HTTP cache (GitHub Pages lets files be cached for ten minutes), or a new
  // version could be installed with the previous version's files
  event.waitUntil(caches.open(VERSION)
    .then(cache => cache.addAll(FILES.map(file => new Request(file, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim()));
});

// Everything is served from the cache, so the app opens with no signal at all; the network is
// only asked for what was never cached
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(hit => hit || fetch(event.request)));
});
