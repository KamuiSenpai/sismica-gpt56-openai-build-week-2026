import assert from "node:assert/strict";
import test from "node:test";

import { resolveFixedStationPosition } from "../src/lib/stationPosition";

test("la posicion de catalogo no cambia cuando llega un nuevo estado", () => {
  const positions = new Map();
  const initial = resolveFixedStationPosition(positions, "GEOFON:GE.TEST", {
    latitude: -12.5,
    longitude: -77.25
  });
  const repeated = resolveFixedStationPosition(positions, "GEOFON:GE.TEST", {
    latitude: -12.5,
    longitude: -77.25
  });

  assert.deepEqual(repeated.position, initial.position);
  assert.equal(repeated.ignoredChange, false);
});

test("ignora un desplazamiento posterior de la misma estacion", () => {
  const positions = new Map();
  resolveFixedStationPosition(positions, "GEOFON:GE.TEST", {
    latitude: -12.5,
    longitude: -77.25
  });
  const moved = resolveFixedStationPosition(positions, "GEOFON:GE.TEST", {
    latitude: -10,
    longitude: -75
  });

  assert.deepEqual(moved.position, { latitude: -12.5, longitude: -77.25 });
  assert.equal(moved.ignoredChange, true);
});
