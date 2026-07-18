const TILE_CACHE_NAME = "sismica-map-tiles-v2";
const DATA_CACHE_NAME = "sismica-map-data-v1";
const CACHE_PREFIX = "sismica-map-";
const MAX_TILE_ENTRIES = 800;
const MAX_MESSAGE_URLS = 160;
const PREFETCH_CONCURRENCY = 6;
const PRECACHE_MESSAGE = "PRECACHE_MAP_TILES";
const STATIC_MAP_PATHS = [
  "/data/countries.geojson",
  "/data/map-labels-es.json",
  "/data/plate-boundaries-typed.geojson",
  "/data/gem_active_faults.geojson",
  "/data/volcanoes.geojson"
];

let tileWritesSinceTrim = 0;

function isCartoTile(url) {
  return (
    /^[a-d]\.basemaps\.cartocdn\.com$/.test(url.hostname) &&
    /^\/rastertiles\/dark_nolabels\/\d+\/\d+\/\d+\.png$/.test(url.pathname)
  );
}

function isStaticMapData(url) {
  return url.origin === self.location.origin && STATIC_MAP_PATHS.includes(url.pathname);
}

function isCacheable(response) {
  return response.ok || response.type === "opaque";
}

async function trimTileCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_TILE_ENTRIES;
  if (overflow <= 0) return;

  await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
}

async function storeTile(cache, request, response) {
  await cache.put(request, response);
  tileWritesSinceTrim += 1;
  if (tileWritesSinceTrim >= 25) {
    tileWritesSinceTrim = 0;
    await trimTileCache(cache);
  }
}

async function cacheFirstTile(request, event) {
  const cache = await caches.open(TILE_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) {
    event.waitUntil(storeTile(cache, request, response.clone()));
  }
  return response;
}

async function refreshStaticMapData(request, cache) {
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidateMapData(request, event) {
  const cache = await caches.open(DATA_CACHE_NAME);
  const cached = await cache.match(request);
  const refresh = refreshStaticMapData(request, cache);

  if (cached) {
    event.waitUntil(refresh.catch(() => undefined));
    return cached;
  }

  return refresh;
}

async function precacheStaticMapData() {
  const cache = await caches.open(DATA_CACHE_NAME);
  await Promise.allSettled(
    STATIC_MAP_PATHS.map(async (path) => {
      const response = await fetch(path, { cache: "reload" });
      if (response.ok) await cache.put(path, response);
    })
  );
}

async function precacheTileUrls(rawUrls) {
  const urls = [...new Set(rawUrls)]
    .map((value) => {
      try {
        return new URL(value);
      } catch {
        return null;
      }
    })
    .filter((url) => url && isCartoTile(url))
    .slice(0, MAX_MESSAGE_URLS);
  const cache = await caches.open(TILE_CACHE_NAME);
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const url = urls[cursor];
      cursor += 1;
      if (!url) continue;

      const request = new Request(url.href, { mode: "cors", credentials: "omit" });
      if (await cache.match(request)) continue;

      try {
        const response = await fetch(request);
        if (isCacheable(response)) await cache.put(request, response);
      } catch {
        // A failed background tile never blocks the live map.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PREFETCH_CONCURRENCY, urls.length) }, () => worker()));
  await trimTileCache(cache);
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(precacheStaticMapData());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter(
                (name) =>
                  name.startsWith(CACHE_PREFIX) && name !== TILE_CACHE_NAME && name !== DATA_CACHE_NAME
              )
              .map((name) => caches.delete(name))
          )
        ),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (isCartoTile(url)) {
    event.respondWith(cacheFirstTile(event.request, event));
  } else if (isStaticMapData(url)) {
    event.respondWith(staleWhileRevalidateMapData(event.request, event));
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== PRECACHE_MESSAGE || !Array.isArray(event.data.urls)) return;
  event.waitUntil(precacheTileUrls(event.data.urls));
});
