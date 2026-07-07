import assert from "node:assert/strict";
import test from "node:test";

import { type SeismicEvent } from "@sismica/shared";

import { buildEstimatedIntensityOverlay, drawSeismicIntensityPolygons } from "../src/lib/intensityOverlay";

function makeEvent(overrides: Partial<SeismicEvent> = {}): SeismicEvent {
  return {
    eventId: "USGS:test",
    source: "USGS",
    sourceEventId: "test",
    title: "M7.2 - Offshore seismic test",
    magnitude: 7.2,
    magnitudeType: "Mw",
    latitude: -12.5,
    longitude: -77.2,
    depthKm: 10,
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
    eventTimeUtc: "2026-07-05T00:00:00.000Z",
    updatedAtUtc: null,
    status: "automatic",
    sourceUrl: null,
    ingestedAt: "2026-07-05T00:01:00.000Z",
    ...overrides
  };
}

test("buildEstimatedIntensityOverlay emits smooth nested geodesic polygons for strong events", () => {
  const layers = buildEstimatedIntensityOverlay(makeEvent());

  assert.equal(layers.length, 3);
  assert.equal(
    layers.every((layer) => layer.points.length === 128),
    true
  );
  assert.equal(
    layers.every((layer) => layer.radiusKm > 0),
    true
  );
  assert.equal(
    layers.every((layer) => layer.strokeOpacity >= 0.2),
    true
  );
  assert.equal(
    layers.every((layer) => !layer.label.startsWith("hex-")),
    true
  );
  assert.equal(Math.max(...layers.map((layer) => layer.mmi)) >= 7, true);
  assert.equal(layers.at(-1)?.zIndex > (layers[0]?.zIndex ?? 0), true);
  assert.equal((layers[0]?.radiusKm ?? 0) > (layers[1]?.radiusKm ?? 0), true);
  assert.equal((layers[1]?.radiusKm ?? 0) > (layers[2]?.radiusKm ?? 0), true);
});

test("buildEstimatedIntensityOverlay keeps minor events quiet unless intensity data warrants it", () => {
  const minor = buildEstimatedIntensityOverlay(
    makeEvent({ eventId: "USGS:minor", magnitude: 1.8, depthKm: 15, mmi: null, cdi: null })
  );
  const felt = buildEstimatedIntensityOverlay(
    makeEvent({ eventId: "USGS:felt", magnitude: 2.2, depthKm: 5, mmi: 5, cdi: null })
  );

  assert.equal(minor.length, 0);
  assert.equal(felt.length > 0, true);
  assert.equal(Math.max(...felt.map((layer) => layer.mmi)) >= 5, true);
});

test("buildEstimatedIntensityOverlay keeps monitored M2.5+ events visible even when deep", () => {
  const layers = buildEstimatedIntensityOverlay(
    makeEvent({ eventId: "EMSC:san-juan", magnitude: 3, depthKm: 96, mmi: null, cdi: null })
  );

  assert.equal(layers.length > 0, true);
  assert.equal(Math.max(...layers.map((layer) => layer.mmi)) >= 2, true);
  assert.equal(layers[0]?.radiusKm > 5, true);
});

test("drawSeismicIntensityPolygons creates deterministic smooth geodesic bands", () => {
  const options = { eventId: "USGS:m76", pointCount: 128, mmi: 9 };
  const first = drawSeismicIntensityPolygons({ lat: -12.5, lng: -77.2 }, 7.6, 10, options);
  const second = drawSeismicIntensityPolygons({ lat: -12.5, lng: -77.2 }, 7.6, 10, options);

  assert.equal(first.length, 3);
  assert.equal(
    first.every((layer) => layer.points.length === 128),
    true
  );
  assert.deepEqual(first, second);
  assert.equal(first[0]?.fillColor, "#4aa9d8");
  assert.equal(first.at(-1)?.fillColor, "#6f1838");
  assert.equal(first[0]?.radiusKm > (first.at(-1)?.radiusKm ?? 0), true);
  assert.equal((first[0]?.fillOpacity ?? 1) < (first.at(-1)?.fillOpacity ?? 0), true);
});

test("buildEstimatedIntensityOverlay keeps a broad continuous outer contour", () => {
  const layers = buildEstimatedIntensityOverlay(
    makeEvent({ eventId: "USGS:strong-footprint", magnitude: 7.6, depthKm: 10 })
  );
  assert.equal(layers.length, 3);

  const latKm = 111;
  const lonKm = Math.max(35, 111 * Math.cos((-12.5 * Math.PI) / 180));
  const radii = (layers[0]?.points ?? []).map((point) =>
    Math.hypot((point.latitude - -12.5) * latKm, (point.longitude - -77.2) * lonKm)
  );
  const farthest = Math.max(...radii);
  const nearest = Math.min(...radii);

  assert.equal(farthest > 300, true);
  assert.equal(farthest < 650, true);
  assert.equal(nearest > 250, true);
  assert.equal(farthest / nearest < 1.6, true);
});
