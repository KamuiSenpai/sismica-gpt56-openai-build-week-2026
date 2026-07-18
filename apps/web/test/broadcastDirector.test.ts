import assert from "node:assert/strict";
import test from "node:test";

import { type SeismicEvent } from "@sismica/shared";

import {
  canRotateBroadcastHost,
  DIRECTOR_EVENT_DWELL_MS,
  HOST_ROTATION_INTERVAL_MS,
  HOST_ROTATION_POLL_MS,
  pickNextTourEvent,
  rotateBroadcastHostSilently
} from "../src/lib/broadcastDirector";
import { getActiveBroadcastHost, setActiveBroadcastHost } from "../src/lib/seismicVoice";

function makeEvent(eventId: string, title: string): SeismicEvent {
  return {
    eventId,
    source: "USGS",
    sourceEventId: eventId,
    title,
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
    eventTimeUtc: "2026-07-02T01:00:00.000Z",
    updatedAtUtc: null,
    status: "automatic",
    sourceUrl: null,
    ingestedAt: "2026-07-02T01:01:00.000Z"
  };
}

test("pickNextTourEvent skips a recently aired live event in recorrido", () => {
  const now = Date.now();
  const recentEventIds = new Map<string, number>([["live-1", now]]);
  const events = [
    makeEvent("live-1", "M3.2 - Mindanao, Philippines"),
    makeEvent("tour-2", "M3.1 - Alaska"),
    makeEvent("tour-3", "M2.9 - Chile")
  ];

  const next = pickNextTourEvent(events, -1, recentEventIds, now);

  assert.equal(next.event?.eventId, "tour-2");
  assert.deepEqual(next.skippedEventIds, ["live-1"]);
});

test("pickNextTourEvent returns null when every candidate was aired recently", () => {
  const now = Date.now();
  const events = [makeEvent("live-1", "M3.2 - Mindanao, Philippines"), makeEvent("tour-2", "M3.1 - Alaska")];
  const recentEventIds = new Map<string, number>(events.map((event) => [event.eventId, now] as const));

  const next = pickNextTourEvent(events, -1, recentEventIds, now);

  assert.equal(next.event, null);
  assert.deepEqual(next.skippedEventIds, ["live-1", "tour-2"]);
});

test("host rotation is silent and scheduled every five minutes", () => {
  assert.equal(HOST_ROTATION_INTERVAL_MS, 5 * 60_000);
  assert.equal(HOST_ROTATION_POLL_MS, 500);
  setActiveBroadcastHost("carolina");
  rotateBroadcastHostSilently();
  assert.equal(getActiveBroadcastHost().id, "liam");
  rotateBroadcastHostSilently();
  assert.equal(getActiveBroadcastHost().id, "valentina");
  setActiveBroadcastHost("carolina");
});

test("host rotation waits until the complete voice message has finished", () => {
  const dueAt = 1_000;

  assert.equal(canRotateBroadcastHost(999, dueAt, false), false);
  assert.equal(canRotateBroadcastHost(1_000, dueAt, true), false);
  assert.equal(canRotateBroadcastHost(1_500, dueAt, true), false);
  assert.equal(canRotateBroadcastHost(1_500, dueAt, false), true);
});

test("director keeps each focused event visible long enough to avoid frantic camera changes", () => {
  assert.equal(DIRECTOR_EVENT_DWELL_MS, 24_000);
});
