const CARTO_SUBDOMAINS = ["a", "b", "c", "d"] as const;
const MAX_MERCATOR_LATITUDE = 85.05112878;
const DEFAULT_AREA_ZOOM_LEVELS = [4, 6, 8] as const;
const MAP_CACHE_SERVICE_WORKER_URL = "/map-cache-sw.js";
const MAP_TILE_PRECACHE_MESSAGE = "PRECACHE_MAP_TILES";

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let overviewRequested = false;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function normalizeLongitude(longitude: number): number {
  return wrap(longitude + 180, 360) - 180;
}

function tileCoordinates(latitude: number, longitude: number, zoom: number): { x: number; y: number } {
  const tileCount = 2 ** zoom;
  const safeLatitude = clamp(latitude, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const latitudeRadians = (safeLatitude * Math.PI) / 180;
  const x = Math.floor(((normalizeLongitude(longitude) + 180) / 360) * tileCount);
  const y = Math.floor(((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * tileCount);

  return {
    x: wrap(x, tileCount),
    y: clamp(y, 0, tileCount - 1)
  };
}

function cartoTileUrls(zoom: number, x: number, y: number): [string, string] {
  const subdomain = CARTO_SUBDOMAINS[(x + y + zoom) % CARTO_SUBDOMAINS.length];
  const root = `https://${subdomain}.basemaps.cartocdn.com/rastertiles`;

  return [`${root}/dark_nolabels/${zoom}/${x}/${y}.png`, `${root}/dark_only_labels/${zoom}/${x}/${y}@2x.png`];
}

export function buildMapOverviewPrecacheUrls(maximumZoom = 2): string[] {
  const safeMaximumZoom = clamp(Math.trunc(maximumZoom), 0, 3);
  const urls: string[] = [];

  for (let zoom = 0; zoom <= safeMaximumZoom; zoom += 1) {
    const tileCount = 2 ** zoom;
    for (let x = 0; x < tileCount; x += 1) {
      for (let y = 0; y < tileCount; y += 1) {
        urls.push(...cartoTileUrls(zoom, x, y));
      }
    }
  }

  return urls;
}

export function buildMapAreaPrecacheUrls(
  latitude: number,
  longitude: number,
  zoomLevels: readonly number[] = DEFAULT_AREA_ZOOM_LEVELS,
  radius = 1
): string[] {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

  const safeRadius = clamp(Math.trunc(radius), 0, 2);
  const urls = new Set<string>();

  for (const candidateZoom of zoomLevels) {
    const zoom = clamp(Math.trunc(candidateZoom), 0, 20);
    const tileCount = 2 ** zoom;
    const center = tileCoordinates(latitude, longitude, zoom);

    for (let offsetX = -safeRadius; offsetX <= safeRadius; offsetX += 1) {
      for (let offsetY = -safeRadius; offsetY <= safeRadius; offsetY += 1) {
        const x = wrap(center.x + offsetX, tileCount);
        const y = clamp(center.y + offsetY, 0, tileCount - 1);
        urls.add(cartoTileUrls(zoom, x, y)[0]);
        urls.add(cartoTileUrls(zoom, x, y)[1]);
      }
    }
  }

  return [...urls];
}

function supportsServiceWorkers(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

function postPrecacheRequest(registration: ServiceWorkerRegistration, urls: string[]): void {
  if (urls.length === 0) return;
  registration.active?.postMessage({ type: MAP_TILE_PRECACHE_MESSAGE, urls });
}

export function registerMapCacheServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!supportsServiceWorkers()) return Promise.resolve(null);
  if (registrationPromise) return registrationPromise;

  registrationPromise = navigator.serviceWorker
    .register(MAP_CACHE_SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" })
    .then(() => navigator.serviceWorker.ready)
    .then((registration) => {
      if (!overviewRequested) {
        overviewRequested = true;
        postPrecacheRequest(registration, buildMapOverviewPrecacheUrls());
      }
      return registration;
    })
    .catch((error: unknown) => {
      console.warn("No se pudo activar la cache persistente del mapa.", error);
      return null;
    });

  return registrationPromise;
}

export async function precacheMapArea(latitude: number, longitude: number): Promise<void> {
  const urls = buildMapAreaPrecacheUrls(latitude, longitude);
  if (urls.length === 0) return;

  const registration = await registerMapCacheServiceWorker();
  if (registration) postPrecacheRequest(registration, urls);
}
