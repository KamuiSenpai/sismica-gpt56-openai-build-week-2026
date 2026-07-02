import assert from "node:assert/strict";
import test from "node:test";

import { type SeismicEvent } from "@sismica/shared";

import { buildSeismicNarration } from "../src/lib/seismicSpeech";
import { getEventPlace } from "../src/lib/presentation";

function makeEvent(overrides: Partial<SeismicEvent> = {}): SeismicEvent {
  return {
    eventId: "USGS:test-event",
    source: "USGS",
    sourceEventId: "test-event",
    title: "M3.5 - Molucca Sea",
    magnitude: 3.5,
    magnitudeType: "Mw",
    latitude: 1.23,
    longitude: 127.45,
    depthKm: 75,
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
    eventTimeUtc: "2026-07-01T23:12:09.000Z",
    updatedAtUtc: null,
    status: "automatic",
    sourceUrl: null,
    ingestedAt: "2026-07-01T23:13:00.000Z",
    ...overrides
  };
}

test("buildSeismicNarration turns a seismic card into spoken Spanish", () => {
  const narration = buildSeismicNarration(makeEvent());
  assert.equal(
    narration,
    "Sismo detectado en Molucca Sea, de magnitud 3.5, a una profundidad de 75 kilometros."
  );
});

test("buildSeismicNarration omits missing values cleanly", () => {
  const narration = buildSeismicNarration(
    makeEvent({
      title: "Earthquake - Northern Sumatra, Indonesia",
      magnitude: null,
      depthKm: null
    })
  );
  assert.equal(narration, "Sismo detectado en Northern Sumatra, Indonesia.");
});

test("buildSeismicNarration can announce a newly detected quake", () => {
  const narration = buildSeismicNarration(makeEvent(), { intro: "Nuevo sismo detectado" });
  assert.equal(
    narration,
    "Nuevo sismo detectado en Molucca Sea, de magnitud 3.5, a una profundidad de 75 kilometros."
  );
});

test("getEventPlace capitalizes sentence-style descriptors for cards", () => {
  assert.equal(getEventPlace("M4.7 - sur de Perú"), "Sur de Perú");
  assert.equal(
    getEventPlace("M3.2 - cerca de la costa norte de Papúa, Indonesia"),
    "Cerca de la costa norte de Papúa, Indonesia"
  );
});

test("buildSeismicNarration lowers descriptor openings so speech stays natural", () => {
  const narration = buildSeismicNarration(
    makeEvent({
      title: "M4.7 - Sur de Perú",
      magnitude: 4.7,
      depthKm: 0
    })
  );
  assert.equal(
    narration,
    "Sismo detectado en sur de Perú, de magnitud 4.7, a una profundidad de 0 kilometros."
  );
});
