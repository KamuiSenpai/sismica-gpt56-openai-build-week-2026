import assert from "node:assert/strict";
import test from "node:test";

import { experimentalOriginSchema, stationSnapshotSchema } from "../src/services/seismicEngineRepository.js";
import { parseStationQuery } from "../src/services/stationRepository.js";

test("station snapshot accepts the versioned contract", () => {
  const result = stationSnapshotSchema.safeParse({
    schemaVersion: 1,
    engine: "seiscomp-test/1",
    states: [
      {
        stationId: "GEOFON:GE.TEST",
        status: "triggered",
        phase: "P",
        observedAtUtc: new Date().toISOString(),
        sequence: 2
      }
    ]
  });
  assert.equal(result.success, true);
});

test("station snapshot rejects unsupported status and future observations", () => {
  const result = stationSnapshotSchema.safeParse({
    schemaVersion: 1,
    engine: "test",
    states: [
      {
        stationId: "GEOFON:GE.TEST",
        status: "alarm",
        observedAtUtc: new Date(Date.now() + 10 * 60_000).toISOString(),
        sequence: 1
      }
    ]
  });
  assert.equal(result.success, false);
});

test("located origin requires four stations", () => {
  const result = experimentalOriginSchema.safeParse({
    schemaVersion: 1,
    originId: "test:1",
    engine: "test",
    originTimeUtc: new Date().toISOString(),
    latitude: 0,
    longitude: 0,
    depthKm: 10,
    stationCount: 3,
    quality: "preliminary",
    status: "located"
  });
  assert.equal(result.success, false);
});

test("station query validates bbox and normalizes network", () => {
  assert.deepEqual(parseStationQuery({ bbox: "-80,-20,-70,0", network: "ge", limit: "50" }), {
    bbox: [-80, -20, -70, 0],
    statuses: undefined,
    network: "GE",
    activeAt: undefined,
    limit: 50
  });
  assert.throws(() => parseStationQuery({ bbox: "10,20,-10,30" }), /bbox/);
});
