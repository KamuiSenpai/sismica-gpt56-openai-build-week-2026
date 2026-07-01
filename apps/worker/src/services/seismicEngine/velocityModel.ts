// Modelo de velocidad simplificado (medio homogeneo) para el motor experimental.
//
// La localizacion real de SeisComP usa un modelo de capas (IASP91). Aqui usamos una
// velocidad P aparente constante: es fisicamente consistente porque el motor GENERA los
// tiempos de llegada con el MISMO modelo con el que luego INVIERTE, de modo que la
// triangulacion (busqueda en malla) recupera el epicentro. El valor absoluto de la
// velocidad no afecta esa recuperacion; solo etiqueta el resultado como estimado.

export const EARTH_RADIUS_KM = 6371;

// Velocidad P aparente (km/s). ~8 km/s aproxima la refractada Pn en distancias regionales.
export const VP_KMPS = 8.0;

// Relacion Vp/Vs tipica de la corteza; se usa solo para la representacion S en el mapa.
export const VP_VS_RATIO = 1.73;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

// Normaliza una longitud a [-180, 180].
export function normalizeLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

// Distancia sobre la superficie (gran circulo) en km.
export function surfaceDistanceKm(latA: number, lonA: number, latB: number, lonB: number): number {
  const dLat = toRadians(latB - latA);
  const dLon = toRadians(lonB - lonA);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Distancia hipocentral (incluye la profundidad) desde una estacion en superficie
// hasta el hipocentro en km.
export function hypocentralDistanceKm(surfaceKm: number, depthKm: number): number {
  return Math.sqrt(surfaceKm * surfaceKm + depthKm * depthKm);
}

// Tiempo de viaje de la onda P (s) para una distancia superficial y una profundidad dadas.
export function pTravelTimeSeconds(surfaceKm: number, depthKm: number): number {
  return hypocentralDistanceKm(surfaceKm, depthKm) / VP_KMPS;
}

// Azimut inicial (grados, 0-360) desde el punto A hacia el punto B.
export function initialBearingDeg(latA: number, lonA: number, latB: number, lonB: number): number {
  const phiA = toRadians(latA);
  const phiB = toRadians(latB);
  const dLon = toRadians(lonB - lonA);
  const y = Math.sin(dLon) * Math.cos(phiB);
  const x = Math.cos(phiA) * Math.sin(phiB) - Math.sin(phiA) * Math.cos(phiB) * Math.cos(dLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

// Mayor hueco azimutal (grados) entre estaciones vistas desde el epicentro. Un gap
// pequeno indica buena cobertura alrededor del evento.
export function azimuthalGapDeg(azimuths: number[]): number {
  if (azimuths.length === 0) return 360;
  const sorted = [...azimuths].map((a) => ((a % 360) + 360) % 360).sort((left, right) => left - right);
  let maxGap = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    maxGap = Math.max(maxGap, sorted[index] - sorted[index - 1]);
  }
  // Hueco que envuelve de la ultima a la primera estacion (cruzando 360 -> 0).
  const wrapGap = 360 - sorted[sorted.length - 1] + sorted[0];
  return Math.max(maxGap, wrapGap);
}
