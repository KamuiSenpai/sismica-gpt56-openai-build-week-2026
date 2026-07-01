import assert from "node:assert/strict";
import test from "node:test";

import { locate, type PhasePick } from "../src/services/seismicEngine/locator.js";
import { pTravelTimeSeconds, surfaceDistanceKm } from "../src/services/seismicEngine/velocityModel.js";

// Epicentro "verdadero" (norte de Chile) usado para generar picks sinteticos.
const TRUE_LAT = -20;
const TRUE_LON = -70;
const TRUE_DEPTH_KM = 30;
const TRUE_ORIGIN_S = 1_000;

// Estaciones distribuidas alrededor del epicentro (buena cobertura azimutal).
const STATIONS: Array<{ id: string; lat: number; lon: number }> = [
  { id: "GE.A", lat: -18.5, lon: -70.2 },
  { id: "GE.B", lat: -21.7, lon: -69.4 },
  { id: "GE.C", lat: -20.3, lon: -72.1 },
  { id: "GE.D", lat: -19.6, lon: -68.3 },
  { id: "GE.E", lat: -22.5, lon: -71.2 },
  { id: "GE.F", lat: -17.9, lon: -68.9 }
];

// Genera tiempos de llegada P con el modelo directo + un ruido de pick pequeno y determinista.
function syntheticPicks(): PhasePick[] {
  return STATIONS.map((station, index) => {
    const surfaceKm = surfaceDistanceKm(TRUE_LAT, TRUE_LON, station.lat, station.lon);
    const travel = pTravelTimeSeconds(surfaceKm, TRUE_DEPTH_KM);
    const noise = ((index % 3) - 1) * 0.12; // -0.12, 0, +0.12 s
    return {
      stationId: station.id,
      latitude: station.lat,
      longitude: station.lon,
      timeSeconds: TRUE_ORIGIN_S + travel + noise
    };
  });
}

test("locate recovers the epicenter from synthetic P picks", () => {
  const estimate = locate(syntheticPicks());
  assert.ok(estimate, "esperaba una localizacion");
  const errorKm = surfaceDistanceKm(estimate!.latitude, estimate!.longitude, TRUE_LAT, TRUE_LON);
  assert.ok(errorKm < 25, `error epicentral ${errorKm.toFixed(1)} km deberia ser < 25`);
  assert.ok(estimate!.rmsSeconds < 0.75, `rms ${estimate!.rmsSeconds.toFixed(2)} s deberia ser bajo`);
  assert.equal(estimate!.stationCount, STATIONS.length);
  assert.ok(estimate!.azimuthalGapDeg < 180, "buena cobertura => gap < 180");
});

test("locate returns null with fewer than four picks", () => {
  assert.equal(locate(syntheticPicks().slice(0, 3)), null);
});
