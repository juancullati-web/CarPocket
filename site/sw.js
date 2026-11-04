"use strict";

// Le site reste à jour : on prend le réseau d'abord, et la copie seulement hors connexion.
const PAGES = "carpocket-pages-v1";
const IMAGES = "carpocket-images-v1";
const MAX_IMAGES = 400;
const CLIENT_LIBRARY = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => ![PAGES, IMAGES].includes(name)).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, key = request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const saved = await cache.match(key, { ignoreSearch: true });
    if (saved) return saved;
    if (request.mode === "navigate") {
      const page = await cache.match("./", { ignoreSearch: true });
      if (page) return page;
    }
    throw error;
  }
}

async function trimImages(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_IMAGES)).map((key) => cache.delete(key)));
}

async function cacheFirst(request) {
  const cache = await caches.open(IMAGES);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trimImages(cache);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Seule la bibliothèque de connexion, à version figée, est gardée hors du site.
  // Les comptes et les données privées ne passent jamais par ce cache.
  if (url.origin !== self.location.origin) {
    if (request.url.startsWith(CLIENT_LIBRARY)) event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith("/photos/") || url.pathname.startsWith("/avatars/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "./"));
    return;
  }
  // Sans le paramètre de requête, pour ne garder qu'une copie de chaque fichier.
  event.respondWith(networkFirst(request, url.origin + url.pathname));
});
