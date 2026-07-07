import assert from "node:assert/strict";
import test from "node:test";

import { type SeismicEvent } from "@sismica/shared";

import { broadcastPlace } from "../src/lib/broadcastPlace";
import { getEventPlace } from "../src/lib/presentation";
import {
  buildSeismicNarration,
  normalizeChatterboxText,
  normalizeSpokenText
} from "../src/lib/seismicSpeech";
import { normalizeSpanishText } from "../src/lib/spanishText";

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
    "Sismo detectado en Mar de Molucas, de magnitud 3.5, a una profundidad de 75 kilometros."
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
  assert.equal(narration, "Sismo detectado en norte de Sumatra, Indonesia.");
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
    "Sismo detectado en 112 kilometros al oeste de Caldera, Chile, de magnitud 2.6, a una profundidad de 28 kilometros."
  );
});

test("buildSeismicNarration can announce a newly detected quake", () => {
  const narration = buildSeismicNarration(makeEvent(), { intro: "Nuevo sismo detectado" });
  assert.equal(
    narration,
    "Nuevo sismo detectado en Mar de Molucas, de magnitud 3.5, a una profundidad de 75 kilometros."
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
    "Sismo detectado en 91 kilometros al sur de Sand Point, Alaska, Estados Unidos, de magnitud 2.7, a una profundidad de 1 kilometro."
  );
});

test("broadcastPlace converts offshore descriptors into broadcast Spanish", () => {
  const place = broadcastPlace(
    makeEvent({
      title: "M2.7 - Offshore Valparaiso, Chile",
      source: "EMSC"
    })
  );
  assert.equal(place, "Frente a la costa de Valparaiso, Chile");
});

test("broadcastPlace resolves ISO suffixes into full country names", () => {
  const place = broadcastPlace(
    makeEvent({
      title: "M3.3 - Poland - PL",
      source: "GEOFON"
    })
  );
  assert.equal(place, "Polonia");
});

test("broadcastPlace removes repeated location and country components", () => {
  const place = broadcastPlace(
    makeEvent({
      title: "M3.2 - Mindanao, Philippines - Philippines",
      source: "EMSC"
    })
  );
  assert.equal(place, "Mindanao, Filipinas");
});

test("broadcastPlace translates live legacy descriptors before narration", () => {
  assert.equal(
    broadcastPlace(makeEvent({ title: "M2.5 - Ceram Sea, Indonesia", source: "EMSC" })),
    "Mar de Ceram, Indonesia"
  );
  assert.equal(broadcastPlace(makeEvent({ title: "M2.5 - Crete, Greece", source: "EMSC" })), "Creta, Grecia");
  assert.equal(
    broadcastPlace(makeEvent({ title: "M4.8 - Bonin Islands, Japan", source: "GEOFON" })),
    "Islas Bonin, Japon"
  );
  assert.equal(
    broadcastPlace(makeEvent({ title: "M2.5 - Colombia-Ecuador Border region", source: "SGC" })),
    "Region de frontera entre Colombia y Ecuador"
  );
});

test("buildSeismicNarration appends a closing line when provided", () => {
  const narration = buildSeismicNarration(makeEvent(), { closing: "Seguimos monitoreando la zona" });
  assert.equal(
    narration,
    "Sismo detectado en Mar de Molucas, de magnitud 3.5, a una profundidad de 75 kilometros. Seguimos monitoreando la zona."
  );
});

test("normalizeSpokenText replaces sentence-ending periods with natural pauses", () => {
  const spoken = normalizeSpokenText(
    "La magnitud mide la energia del sismo. La intensidad describe sus efectos en un lugar especifico."
  );
  assert.equal(
    spoken,
    "La magnitud mide la energía del sismo, La intensidad describe sus efectos en un lugar específico"
  );
});

test("normalizeSpokenText no pronuncia puntos de fin de frase ni de abreviatura de lugar", () => {
  // Abreviatura de direccion en el lugar: no debe deletrearse "ese punto o punto".
  const lugar = normalizeSpokenText("Sismo en 15 km al S.O. de Ovalle. Seguimos.");
  assert.equal(/S\.O\.|\bpunto\b/iu.test(lugar), false);
  assert.equal(lugar.includes("SO"), true);
  assert.equal(/\.\s*$/u.test(lugar), false);

  // Fin de frase seguido de minuscula (caso que se colaba antes).
  assert.equal(normalizeSpokenText("frase uno. frase dos."), "frase uno, frase dos");

  // El decimal de la magnitud se deletrea con "punto" (no se convierte en pausa de puntuacion).
  assert.equal(
    normalizeSpokenText("de magnitud 3.5, a 9 kilometros."),
    "de magnitud tres punto cinco, a nueve kilometros"
  );
});

test("buildSeismicNarration expande direcciones abreviadas con punto a palabra completa", () => {
  const narration = buildSeismicNarration(makeEvent({ magnitude: null, depthKm: null }), {
    place: "15 km al S.O. de Ovalle, Chile"
  });
  assert.equal(/S\.O\.|\bpunto\b/iu.test(narration), false);
  assert.equal(/suroeste/iu.test(narration), true);
});

test("normalizeSpokenText deletrea numeros en espanol (fix Chatterbox: 148 no es 'catorce ocho')", () => {
  assert.equal(
    normalizeSpokenText("a una profundidad de 148 kilometros."),
    "a una profundidad de ciento cuarenta y ocho kilometros"
  );
  // El decimal de la magnitud se conserva como "punto".
  assert.equal(
    normalizeSpokenText("de magnitud 3.5, a 20 kilometros"),
    "de magnitud tres punto cinco, a veinte kilometros"
  );
  // Apocope ante sustantivo masculino "kilometro(s)".
  assert.equal(normalizeSpokenText("a 1 kilometro"), "a un kilometro");
  assert.equal(normalizeSpokenText("a 21 kilometros"), "a veintiun kilometros");
  // No debe quedar ningun digito suelto para el TTS.
  assert.equal(/\d/u.test(normalizeSpokenText("Sismo de magnitud 5.2 a 148 kilometros.")), false);
});

test("normalizeChatterboxText conserva puntuacion, tildes y punto final", () => {
  const spoken = normalizeChatterboxText(
    "Actualizacion sismica en 6 kilometros al Noroeste de Puerto Escondido, Oaxaca, Mexico, de magnitud 4.0. Se mantiene la informacion a disposicion de la audiencia"
  );

  assert.equal(
    spoken,
    "Actualizaci\u00f3n s\u00edsmica en seis kil\u00f3metros al Noroeste de Puerto Escondido, Oaxaca, M\u00e9xico, de magnitud cuatro punto cero. Se mantiene la informaci\u00f3n a disposici\u00f3n de la audiencia."
  );
  assert.equal(/\d/u.test(spoken), false);
  assert.equal(/[.!?]$/u.test(spoken), true);
});

test("normalizeSpanishText restores common accents for overlay and voice copy", () => {
  assert.equal(normalizeSpanishText("Contexto sismico"), "Contexto sísmico");
  assert.equal(normalizeSpanishText("BOLETIN"), "BOLETÍN");
  assert.equal(normalizeSpanishText("Informacion tectonica"), "Información tectónica");
});

test("normalizeSpanishText restores tectonic region accents returned by editorial AI", () => {
  assert.equal(
    normalizeSpanishText("Japon, Turquia, Pacifico y Sudamerica"),
    "Japón, Turquía, Pacífico y Sudamérica"
  );
});
