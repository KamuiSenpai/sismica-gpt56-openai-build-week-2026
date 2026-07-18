import assert from "node:assert/strict";
import test from "node:test";

import type { SeismicEvent } from "@sismica/shared";

import { buildSeismicSequence, selectPrioritySeaLevelStations } from "../src/lib/officialImpactMap";
import type { SeaLevelStation } from "../src/lib/seaLevel";

function event(
  eventId: string,
  time: string,
  magnitude: number,
  latitude = -12,
  longitude = -77,
  tsunami = false
): SeismicEvent {
  return {
    eventId,
    source: "USGS",
    sourceEventId: eventId,
    title: eventId,
    magnitude,
    magnitudeType: "mww",
    latitude,
    longitude,
    depthKm: 20,
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
    tsunami,
    networkCode: "us",
    providerEventCode: eventId,
    eventType: "earthquake",
    detailUrl: null,
    sources: ["USGS"],
    sourceCount: 1,
    eventTimeUtc: time,
    updatedAtUtc: time,
    status: "reviewed",
    sourceUrl: null,
    ingestedAt: time
  };
}

function station(code: string, status: SeaLevelStation["status"], latitude: number): SeaLevelStation {
  return {
    stationCode: code,
    name: code,
    countryCode: "PE",
    countryName: "Peru",
    latitude,
    longitude: -77,
    sensor: "rad",
    unit: "m",
    lastValue: 1,
    lastObservationAtUtc: "2026-07-18T12:00:00.000Z",
    lastUpdatedAtUtc: "2026-07-18T12:00:00.000Z",
    sampleRateMinutes: 1,
    status,
    sourceUrl: "https://ioc-sealevelmonitoring.org",
    sourceLabel: "UNESCO/IOC Sea Level Monitoring",
    connection: null,
    glossId: null,
    availableSensors: ["rad"]
  };
}

test("distingue evento principal y actividad posterior con conteos de 6 h y 24 h", () => {
  const events = [
    event("ancla", "2026-07-18T00:00:00.000Z", 5.1),
    event("principal", "2026-07-18T01:00:00.000Z", 6.2, -12.1),
    event("posterior-6h", "2026-07-18T05:00:00.000Z", 4.1, -12.2),
    event("posterior-24h", "2026-07-18T12:00:00.000Z", 4.3, -12.3),
    event("lejana", "2026-07-18T03:00:00.000Z", 7.1, 5, 5)
  ];

  const sequence = buildSeismicSequence(events, "ancla");
  assert.equal(sequence?.principal.event.eventId, "principal");
  assert.deepEqual(
    sequence?.posterior.map((member) => member.event.eventId),
    ["posterior-6h", "posterior-24h"]
  );
  assert.equal(sequence?.count6h, 1);
  assert.equal(sequence?.count24h, 2);
  assert.equal(sequence?.posterior[0].role, "posterior");
});

test("no clasifica una secuencia cuando falta actividad posterior relacionada", () => {
  const events = [
    event("solo", "2026-07-18T00:00:00.000Z", 5),
    event("fuera", "2026-07-19T02:00:00.000Z", 4.8)
  ];
  assert.equal(buildSeismicSequence(events, "solo"), null);
});

test("prioriza estaciones IOC operativas solo con indicador de tsunami", () => {
  const stations = [
    station("offline-cerca", "offline", -12.01),
    station("online-lejos", "online", -13),
    station("online-cerca", "online", -12.1),
    station("delayed", "delayed", -12.05)
  ];
  const withoutFlag = selectPrioritySeaLevelStations(
    event("sin-bandera", "2026-07-18T00:00:00.000Z", 6),
    stations
  );
  assert.deepEqual(withoutFlag, []);

  const prioritized = selectPrioritySeaLevelStations(
    event("con-bandera", "2026-07-18T00:00:00.000Z", 6, -12, -77, true),
    stations,
    3
  );
  assert.deepEqual(
    prioritized.map((entry) => entry.station.stationCode),
    ["online-cerca", "online-lejos", "delayed"]
  );
});
