import assert from "node:assert/strict";
import test from "node:test";

import { type SeismicEvent } from "@sismica/shared";

import { dialogueDisplayText, pickNextTourEvent } from "../src/lib/broadcastDirector";

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

test("dialogueDisplayText contains exactly the lines spoken during a handoff", () => {
  const turns = [
    {
      hostId: "carolina" as const,
      speakerName: "Carolina",
      text: "Liam, te cedo la posta del monitoreo."
    },
    {
      hostId: "liam" as const,
      speakerName: "Liam",
      text: "Con gusto, Carolina. Seguimos monitoreando."
    }
  ];

  assert.equal(
    dialogueDisplayText(turns),
    "Liam, te cedo la posta del monitoreo. Con gusto, Carolina. Seguimos monitoreando."
  );
});
