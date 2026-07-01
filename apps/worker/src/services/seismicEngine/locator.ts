import {
  azimuthalGapDeg,
  initialBearingDeg,
  normalizeLongitude,
  pTravelTimeSeconds,
  surfaceDistanceKm
} from "./velocityModel.js";

// Una llegada P observada en una estacion. `timeSeconds` es el instante de llegada
// (epoch en segundos); solo importan las diferencias entre estaciones.
export type PhasePick = {
  stationId: string;
  latitude: number;
  longitude: number;
  timeSeconds: number;
};

export type LocationEstimate = {
  latitude: number;
  longitude: number;
  depthKm: number;
  originTimeSeconds: number;
  rmsSeconds: number;
  azimuthalGapDeg: number;
  stationCount: number;
};

const DEPTH_CANDIDATES_KM = [5, 10, 20, 35, 60, 100, 150, 250, 400];

type Candidate = {
  latitude: number;
  longitude: number;
  depthKm: number;
  originTimeSeconds: number;
  rmsSeconds: number;
};

// Para un hipocentro candidato, el tiempo de origen optimo es el promedio de los
// residuos (obs - tiempoDeViaje); el RMS mide el desajuste restante.
function evaluate(picks: PhasePick[], latitude: number, longitude: number, depthKm: number): Candidate {
  const residuals = picks.map((pick) => {
    const surfaceKm = surfaceDistanceKm(latitude, longitude, pick.latitude, pick.longitude);
    const travel = pTravelTimeSeconds(surfaceKm, depthKm);
    return pick.timeSeconds - travel;
  });
  const originTimeSeconds = residuals.reduce((sum, value) => sum + value, 0) / residuals.length;
  const sumSquares = residuals.reduce((sum, value) => {
    const demeaned = value - originTimeSeconds;
    return sum + demeaned * demeaned;
  }, 0);
  const rmsSeconds = Math.sqrt(sumSquares / residuals.length);
  return { latitude, longitude: normalizeLongitude(longitude), depthKm, originTimeSeconds, rmsSeconds };
}

// Busqueda en malla en una ventana lat/lon x profundidades; devuelve el mejor candidato.
function searchWindow(
  picks: PhasePick[],
  centerLat: number,
  centerLon: number,
  halfWidthDeg: number,
  stepDeg: number,
  depths: number[]
): Candidate {
  let best: Candidate | null = null;
  const steps = Math.max(1, Math.round((halfWidthDeg * 2) / stepDeg));
  for (let iLat = 0; iLat <= steps; iLat += 1) {
    const latitude = Math.max(-89.9, Math.min(89.9, centerLat - halfWidthDeg + iLat * stepDeg));
    for (let iLon = 0; iLon <= steps; iLon += 1) {
      const longitude = centerLon - halfWidthDeg + iLon * stepDeg;
      for (const depthKm of depths) {
        const candidate = evaluate(picks, latitude, longitude, depthKm);
        if (!best || candidate.rmsSeconds < best.rmsSeconds) best = candidate;
      }
    }
  }
  // `best` no puede ser null: steps >= 1 y depths tiene elementos.
  return best as Candidate;
}

// Localiza un evento a partir de >= 4 picks P mediante triangulacion por busqueda en
// malla (grueso -> fino), anclada en la estacion de llegada mas temprana (la mas cercana
// al epicentro). Devuelve null si no hay suficientes observaciones.
export function locate(picks: PhasePick[]): LocationEstimate | null {
  if (picks.length < 4) return null;

  const anchor = picks.reduce((earliest, pick) =>
    pick.timeSeconds < earliest.timeSeconds ? pick : earliest
  );

  // Etapa 1: malla amplia y gruesa alrededor de la estacion mas cercana.
  const coarse = searchWindow(picks, anchor.latitude, anchor.longitude, 12, 1, DEPTH_CANDIDATES_KM);
  // Etapa 2: refinamiento fino alrededor del mejor candidato grueso.
  const refined = searchWindow(picks, coarse.latitude, coarse.longitude, 1.2, 0.1, DEPTH_CANDIDATES_KM);
  // Etapa 3: refinamiento de profundidad alrededor del mejor.
  const depthRange = [
    Math.max(0, refined.depthKm - 30),
    Math.max(0, refined.depthKm - 15),
    refined.depthKm,
    refined.depthKm + 15,
    refined.depthKm + 30
  ].filter((value) => value >= 0 && value <= 800);
  const fine = searchWindow(picks, refined.latitude, refined.longitude, 0.3, 0.05, depthRange);

  const azimuths = picks.map((pick) =>
    initialBearingDeg(fine.latitude, fine.longitude, pick.latitude, pick.longitude)
  );

  return {
    latitude: fine.latitude,
    longitude: fine.longitude,
    depthKm: fine.depthKm,
    originTimeSeconds: fine.originTimeSeconds,
    rmsSeconds: fine.rmsSeconds,
    azimuthalGapDeg: azimuthalGapDeg(azimuths),
    stationCount: picks.length
  };
}
