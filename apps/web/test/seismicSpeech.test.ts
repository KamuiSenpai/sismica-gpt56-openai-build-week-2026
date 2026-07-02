import assert from "node:assert/strict";
import test from "node:test";

import { type SeismicEvent } from "@sismica/shared";

import { getEventPlace } from "../src/lib/presentation";
import { buildSeismicNarration } from "../src/lib/seismicSpeech";

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

test("buildSeismicNarration appends inferred country for national-source titles", () => {
  const narration = buildSeismicNarration(
    makeEvent({
      source: "CSN",
      title: "M2.6 - 112 km al O de Caldera",
      magnitude: 2.6,
      depthKm: 28
    })
  );
  assert.equal(
    narration,
    "Sismo detectado en 112 kilometros al O de Caldera, Chile, de magnitud 2.6, a una profundidad de 28 kilometros."
  );
});

test("buildSeismicNarration can announce a newly detected quake", () => {
  const narration = buildSeismicNarration(makeEvent(), { intro: "Nuevo sismo detectado" });
  assert.equal(
    narration,
    "Nuevo sismo detectado en Molucca Sea, de magnitud 3.5, a una profundidad de 75 kilometros."
  );
});

test("getEventPlace capitalizes sentence-style descriptors for cards", () => {
  assert.equal(getEventPlace("M4.7 - sur de Per\u00fa"), "Sur de Per\u00fa");
  assert.equal(
    getEventPlace("M3.2 - cerca de la costa norte de Pap\u00faa, Indonesia"),
    "Cerca de la costa norte de Pap\u00faa, Indonesia"
  );
});

test("buildSeismicNarration lowers descriptor openings so speech stays natural", () => {
  const narration = buildSeismicNarration(
    makeEvent({
      title: "M4.7 - Sur de Per\u00fa",
      magnitude: 4.7,
      depthKm: 0
    })
  );
  assert.equal(
    narration,
    "Sismo detectado en sur de Per\u00fa, de magnitud 4.7, a una profundidad de 0 kilometros."
  );
});

test("buildSeismicNarration expands km inside the location text for speech", () => {
  const narration = buildSeismicNarration(
    makeEvent({
      title: "M3.5 - 19.3 km al suroeste de la sede del condado de Hualien",
      depthKm: 14
    })
  );
  assert.equal(
    narration,
    "Sismo detectado en 19.3 kilometros al suroeste de la sede del condado de Hualien, de magnitud 3.5, a una profundidad de 14 kilometros."
  );
});

test("buildSeismicNarration uses singular kilometro when the value is one", () => {
  const narration = buildSeismicNarration(
    makeEvent({
      title: "M2.1 - 1 km al norte de prueba",
      magnitude: 2.1,
      depthKm: 1
    })
  );
  assert.equal(
    narration,
    "Sismo detectado en 1 kilometro al norte de prueba, de magnitud 2.1, a una profundidad de 1 kilometro."
  );
});

test("buildSeismicNarration expands EE. UU. for speech", () => {
  const narration = buildSeismicNarration(
    makeEvent({
      title: "M2.7 - 91 km al sur de Sand Point, Alaska - EE. UU.",
      magnitude: 2.7,
      depthKm: 1
    })
  );
  assert.equal(
    narration,
    "Sismo detectado en 91 kilometros al sur de Sand Point, Alaska- Estados Unidos, de magnitud 2.7, a una profundidad de 1 kilometro."
  );
});
