import { useEffect, useSyncExternalStore } from "react";

import { type SeismicEvent } from "@sismica/shared";

import { countryCode } from "./presentation";

type Polygon = number[][][]; // [anillo][punto][lon, lat]; anillo 0 = exterior, resto = huecos
type CountryShape = { iso2: string; polygons: Polygon[] };

let shapes: CountryShape[] | null = null;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();
const cache = new Map<string, string | null>();

function emit(): void {
  for (const listener of listeners) listener();
}

function toPolygons(geometry: { type: string; coordinates: unknown }): Polygon[] {
  if (geometry.type === "Polygon") return [geometry.coordinates as Polygon];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as Polygon[];
  return [];
}

export function loadCountryShapes(): Promise<void> {
  if (!loadPromise) {
    loadPromise = fetch("/data/countries.geojson")
      .then((response) => response.json())
      .then(
        (geo: {
          features: { properties: { iso2: string }; geometry: { type: string; coordinates: unknown } }[];
        }) => {
          shapes = geo.features.map((feature) => ({
            iso2: feature.properties.iso2,
            polygons: toPolygons(feature.geometry)
          }));
          cache.clear();
          emit();
        }
      )
      .catch((error) => {
        console.warn("No se pudo cargar el dataset de paises.", error);
        shapes = [];
        emit();
      });
  }
  return loadPromise;
}

function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon: number, lat: number, polygon: Polygon): boolean {
  if (!polygon.length || !pointInRing(lon, lat, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h += 1) {
    if (pointInRing(lon, lat, polygon[h])) return false; // dentro de un hueco
  }
  return true;
}

// Pais en una coordenada (point-in-polygon). null si esta en el oceano o aun no cargo.
export function countryCodeAt(latitude: number, longitude: number): string | null {
  if (!shapes) return null;
  const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let found: string | null = null;
  for (const shape of shapes) {
    for (const polygon of shape.polygons) {
      if (pointInPolygon(longitude, latitude, polygon)) {
        found = shape.iso2;
        break;
      }
    }
    if (found) break;
  }
  cache.set(key, found);
  return found;
}

// Codigo de pais autoritativo: coordenadas primero (independiente del idioma de la
// fuente), con respaldo en la deduccion por fuente/texto (util para sismos mar adentro).
export function resolveCountryCode(event: SeismicEvent): string | null {
  return countryCodeAt(event.latitude, event.longitude) ?? countryCode(event);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): number {
  return shapes ? shapes.length : 0;
}

// Carga el dataset una vez y re-renderiza al estar listo.
export function useCountryGeocoder(): void {
  useEffect(() => {
    void loadCountryShapes();
  }, []);
  useSyncExternalStore(subscribe, getSnapshot);
}
