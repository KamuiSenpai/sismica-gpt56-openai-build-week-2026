import assert from "node:assert/strict";
import test from "node:test";

import { type SeismicEvent } from "@sismica/shared";

import {
  buildNewEventYoutubeChatMessage,
  formatBroadcastPlaceForChat,
  isEventFreshForYoutubeChat
} from "../src/services/youtubeChatMessageFormatter.js";
import {
  buildPromotionalLikeYoutubeChatMessage,
  getPromotionalLikeMessages,
  pickNextPromotionalLikeMessageIndex
} from "../src/services/youtubeChatPromotionalService.js";

function createEvent(overrides: Partial<SeismicEvent> = {}): SeismicEvent {
  return {
    eventId: "SSN:test-1",
    source: "SSN",
    sourceEventId: "test-1",
    title: "M4.0 - 29 km NW of Puerto Escondido, Mexico",
    magnitude: 4,
    magnitudeType: "Mw",
    latitude: 15.86,
    longitude: -97.07,
    depthKm: 28,
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
    networkCode: "SSN",
    providerEventCode: "test-1",
    eventType: "earthquake",
    detailUrl: null,
    sources: ["SSN"],
    sourceCount: 1,
    eventTimeUtc: "2026-07-06T20:00:00.000Z",
    updatedAtUtc: null,
    status: "reviewed",
    sourceUrl: "https://www.ssn.unam.mx/",
    ingestedAt: "2026-07-06T20:00:30.000Z",
    ...overrides
  };
}

test("formatea lugares de broadcast en espanol operativo para chat", () => {
  assert.equal(
    formatBroadcastPlaceForChat("M4.0 - 29 km NW of Puerto Escondido, Mexico"),
    "29 km al noroeste de Puerto Escondido, Mexico"
  );
  assert.equal(
    formatBroadcastPlaceForChat("M5.1 - Off Coast of Oaxaca, Mexico"),
    "Frente a la costa de Oaxaca, Mexico"
  );
});

test("arma el mensaje breve determinista para sismo nuevo", () => {
  const message = buildNewEventYoutubeChatMessage(createEvent());

  assert.equal(
    message,
    "🌎🇲🇽 [NUEVO SISMO] M4.0 | 29 km al noroeste de Puerto Escondido, Mexico | 28 km | Fuente: SSN"
  );
});

test("eleva el rotulo a terremoto desde magnitud 6 con alerta visual", () => {
  const message = buildNewEventYoutubeChatMessage(
    createEvent({
      source: "CSN",
      title: "M6.4 - Northern Chile",
      magnitude: 6.4,
      depthKm: 42
    })
  );

  assert.equal(message, "🚨🌎🇨🇱 [TERREMOTO] M6.4 | Northern Chile | 42 km | Fuente: CSN");
});

test("recorta el lugar cuando el mensaje excede el limite", () => {
  const message = buildNewEventYoutubeChatMessage(
    createEvent({
      magnitude: 6.3,
      title: "M6.3 - 145 km WNW of Extremely Long Coastal Settlement Name That Keeps Growing, Mexico"
    }),
    78
  );

  assert.ok(message.length <= 78);
  assert.match(message, /^🚨?🌎(?:🇲🇽)? \[(?:NUEVO SISMO|TERREMOTO)\] M6\.3 \| /);
  assert.ok(message.endsWith("..."));
});

test("solo considera frescos los eventos dentro de la ventana operativa", () => {
  const now = Date.parse("2026-07-06T20:15:00.000Z");
  assert.equal(isEventFreshForYoutubeChat(createEvent(), now, 20), true);
  assert.equal(
    isEventFreshForYoutubeChat(createEvent({ eventTimeUtc: "2026-07-06T19:30:00.000Z" }), now, 20),
    false
  );
  assert.equal(isEventFreshForYoutubeChat(createEvent({ eventTimeUtc: "fecha-invalida" }), now, 20), false);
});

test("rota los mensajes promocionales sin repetir inmediatamente", () => {
  const messages = getPromotionalLikeMessages();
  assert.ok(messages.length >= 3);
  for (const message of messages) {
    assert.ok(message.length <= 180);
  }

  assert.equal(pickNextPromotionalLikeMessageIndex(null), 0);
  assert.equal(pickNextPromotionalLikeMessageIndex(0), 1);

  const first = buildPromotionalLikeYoutubeChatMessage(null);
  const second = buildPromotionalLikeYoutubeChatMessage(first.variantIndex);

  assert.notEqual(first.text, second.text);
  assert.equal(first.variantIndex, 0);
  assert.equal(second.variantIndex, 1);
});
