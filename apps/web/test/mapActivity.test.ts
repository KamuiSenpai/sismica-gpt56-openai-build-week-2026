import assert from "node:assert/strict";
import test from "node:test";

import { type SeismicEvent } from "@sismica/shared";

import {
  buildActiveAreaLayers,
  buildCoastalAttentionLayers,
  buildEventHaloLayers,
  buildTectonicCorridorLayers
} from "../src/lib/mapActivity";

function makeEvent(eventId: string, overrides: Partial<SeismicEvent> = {}): SeismicEvent {
  return {
    eventId,
    source: "USGS",
    sourceEventId: eventId,
    title: "M3.2 - Mindanao, Filipinas",
    magnitude: 3.2,
    magnitudeType: "Mw",
    latitude: 1.23,
    longitude: 127.45,
    depthKm: 12,
    mmi: null,
    cdi: null,
    intensityText: null,
    stationCount: null,
    azimuthalGapDeg: null,
    nearestStationDeg: null,
    rmsSec: null,
    significance: null,
    feltReports: null,
    alertLevel: null,
    tsunami: false,
    networkCode: null,
    providerEventCode: null,
    eventType: "earthquake",
    detailUrl: null,
    sources: ["USGS"],
    sourceCount: 1,
    eventTimeUtc: "2026-07-03T10:00:00.000Z",
    updatedAtUtc: null,
    status: "automatic",
    sourceUrl: null,
    ingestedAt: "2026-07-03T10:01:00.000Z",
    ...overrides
  };
}

test("buildEventHaloLayers keeps the selected event visible and still surfaces stronger recent events", () => {
  const referenceMs = Date.parse("2026-07-03T12:00:00.000Z");
  const layers = buildEventHaloLayers(
    [
      makeEvent("selected-old", {
        title: "M2.8 - Interior de Peru",
        magnitude: 2.8,
        depthKm: 18,
        eventTimeUtc: "2026-07-02T00:00:00.000Z"
      }),
      makeEvent("strong-recent", {
        title: "M5.1 - Costa norte de Chile",
        magnitude: 5.1,
        mmi: 5,
        latitude: -22.1,
        longitude: -70.2,
        eventTimeUtc: "2026-07-03T11:20:00.000Z"
      })
    ],
    "selected-old",
    referenceMs
  );

  assert.equal(layers.length, 2);
  assert.equal(layers[0]?.eventId, "selected-old");
  assert.equal(layers[0]?.selected, true);
  assert.equal(
    layers.some((layer) => layer.eventId === "strong-recent"),
    true
  );
});

test("buildCoastalAttentionLayers detects coastal descriptors and tsunami flags", () => {
  const referenceMs = Date.parse("2026-07-03T12:00:00.000Z");
  const layers = buildCoastalAttentionLayers(
    [
      makeEvent("sea", {
        title: "M3.5 - Molucca Sea",
        latitude: 1.9,
        longitude: 126.7,
        eventTimeUtc: "2026-07-03T11:50:00.000Z"
      }),
      makeEvent("tsunami", {
        title: "M4.8 - Valle central",
        magnitude: 4.8,
        tsunami: true,
        latitude: -14.2,
        longitude: -76.8,
        eventTimeUtc: "2026-07-02T20:00:00.000Z"
      })
    ],
    "sea",
    referenceMs
  );

  assert.equal(layers.length, 2);
  assert.equal(
    layers.some((layer) => layer.eventId === "sea" && layer.label.includes("Molucca Sea")),
    true
  );
  assert.equal(
    layers.some((layer) => layer.eventId === "sea" && layer.pathPoints.length >= 2),
    true
  );
  assert.equal(
    layers.some((layer) => layer.eventId === "tsunami" && layer.tsunami),
    true
  );
});

test("buildActiveAreaLayers groups nearby events and emits a corridor for elongated clusters", () => {
  const referenceMs = Date.parse("2026-07-03T12:00:00.000Z");
  const layers = buildActiveAreaLayers(
    [
      makeEvent("cluster-1", {
        title: "M4.1 - Frente a costa de Chile",
        magnitude: 4.1,
        latitude: -20.1,
        longitude: -71.5,
        eventTimeUtc: "2026-07-03T11:55:00.000Z"
      }),
      makeEvent("cluster-2", {
        title: "M3.9 - Frente a costa de Chile",
        magnitude: 3.9,
        latitude: -19.5,
        longitude: -69.1,
        eventTimeUtc: "2026-07-03T11:40:00.000Z"
      }),
      makeEvent("cluster-3", {
        title: "M3.8 - Frente a costa de Chile",
        magnitude: 3.8,
        latitude: -18.9,
        longitude: -68.2,
        eventTimeUtc: "2026-07-03T11:25:00.000Z"
      }),
      makeEvent("isolated", {
        title: "M2.7 - Interior de Bolivia",
        magnitude: 2.7,
        latitude: -8.2,
        longitude: -58.1,
        eventTimeUtc: "2026-07-03T11:10:00.000Z"
      })
    ],
    referenceMs
  );

  assert.equal(layers.length >= 1, true);
  assert.equal(layers[0]?.count, 3);
  assert.equal(layers[0]?.corridorPoints.length, 3);
  assert.equal((layers[0]?.polygonPoints.length ?? 0) >= 3, true);
});

test("buildTectonicCorridorLayers highlights the matching tectonic belt without circular overlays", () => {
  const referenceMs = Date.parse("2026-07-03T12:00:00.000Z");
  const layers = buildTectonicCorridorLayers(
    [
      makeEvent("naiguata", {
        title: "M2.7 - Naiguata, Venezuela",
        magnitude: 2.7,
        latitude: 10.6,
        longitude: -66.8,
        eventTimeUtc: "2026-07-03T11:50:00.000Z"
      }),
      makeEvent("mindanao", {
        title: "M4.1 - Mindanao, Filipinas",
        magnitude: 4.1,
        latitude: 8.1,
        longitude: 127.2,
        eventTimeUtc: "2026-07-03T11:35:00.000Z"
      })
    ],
    "naiguata",
    referenceMs
  );

  assert.equal(layers.length >= 1, true);
  assert.equal(layers[0]?.corridorId, "caribbean-arc");
  assert.equal(layers[0]?.points.length >= 4, true);
});
