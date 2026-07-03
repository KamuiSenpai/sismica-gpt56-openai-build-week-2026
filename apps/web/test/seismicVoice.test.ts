import assert from "node:assert/strict";
import test from "node:test";

import { type SeismicEvent } from "@sismica/shared";

import { clearEditorialHistory } from "../src/lib/editorialHistory";
import { resolveEventNarration } from "../src/lib/seismicVoice";

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

function mockEditorial(payload: Record<string, unknown>): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ editorial: payload }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("resolveEventNarration builds the canonical message when the editorial API is unavailable", async (t) => {
  clearEditorialHistory();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const narration = await resolveEventNarration(makeEvent());

  assert.equal(
    narration.text,
    "Sismo detectado en Mar de Molucas, de magnitud 3.5, a una profundidad de 75 kilometros."
  );
  assert.deepEqual(Object.keys(narration).sort(), ["cue", "tectonicContext", "text"]);
});

test("resolveEventNarration ignores competing legacy overlay, narration and ticker formats", async (t) => {
  clearEditorialHistory();
  t.after(
    mockEditorial({
      intro: "Sismo detectado",
      closing: null,
      tectonicContext: null,
      formats: {
        overlay: "SISMO | Colombia-Ecuador | 2.5 | Prof. 0 km",
        narration: "Texto legado repetido que no debe salir al aire.",
        ticker: "Sismo 2.5 en frontera Colombia-Ecuador, profundidad superficial"
      },
      cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
    })
  );

  const narration = await resolveEventNarration(makeEvent());

  assert.equal(
    narration.text,
    "Sismo detectado en Mar de Molucas, de magnitud 3.5, a una profundidad de 75 kilometros."
  );
  assert.equal("overlayText" in narration, false);
  assert.equal("tickerText" in narration, false);
});

test("resolveEventNarration discards unsupported editorial claims", async (t) => {
  clearEditorialHistory();
  t.after(
    mockEditorial({
      intro: "Sismo detectado",
      closing: "Sin reportes de danos hasta el momento",
      tectonicContext: null,
      cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
    })
  );

  const narration = await resolveEventNarration(makeEvent());

  assert.equal(
    narration.text,
    "Sismo detectado en Mar de Molucas, de magnitud 3.5, a una profundidad de 75 kilometros."
  );
});

test("resolveEventNarration strips AI intros that already include the location", async (t) => {
  clearEditorialHistory();
  t.after(
    mockEditorial({
      intro: "Sismo detectado en Puerto Rico",
      closing: null,
      tectonicContext: null,
      cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
    })
  );

  const narration = await resolveEventNarration(
    makeEvent({
      title: "M3.2 - 2 km al noreste de Parcelas Nuevas, Puerto Rico",
      magnitude: 3.2,
      depthKm: 73
    })
  );

  assert.equal(
    narration.text,
    "Sismo detectado en 2 kilometros al noreste de Parcelas Nuevas, Puerto Rico, de magnitud 3.2, a una profundidad de 73 kilometros."
  );
});

test("resolveEventNarration replaces malformed AI intros before they reach the overlay and voice", async (t) => {
  clearEditorialHistory();
  t.after(
    mockEditorial({
      intro: "Sismo detectado en seguimiento",
      closing: null,
      tectonicContext: null,
      cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
    })
  );

  const narration = await resolveEventNarration(makeEvent());

  assert.equal(
    narration.text,
    "Sismo detectado en Mar de Molucas, de magnitud 3.5, a una profundidad de 75 kilometros."
  );
});

test("resolveEventNarration rechaza aperturas 'nuevo' en seguimiento (sismo no reciente)", async (t) => {
  clearEditorialHistory();
  t.after(
    mockEditorial({
      intro: "Nuevo sismo detectado",
      closing: null,
      tectonicContext: null,
      cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
    })
  );

  // Sin options.intro -> modo seguimiento (evento del recorrido, no recien ingresado).
  const narration = await resolveEventNarration(makeEvent());

  assert.equal(/nuevo/iu.test(narration.text), false);
  assert.equal(
    narration.text,
    "Sismo detectado en Mar de Molucas, de magnitud 3.5, a una profundidad de 75 kilometros."
  );
});

test("resolveEventNarration conserva 'Nuevo sismo detectado' cuando el intro es solicitado (en vivo)", async (t) => {
  clearEditorialHistory();
  t.after(
    mockEditorial({
      intro: "Sismo detectado",
      closing: null,
      tectonicContext: null,
      cue: { urgency: "alta", rhythm: "agil", tone: "directo" }
    })
  );

  // Con options.intro -> el sismo recien ingresado conserva su apertura "nuevo".
  const narration = await resolveEventNarration(makeEvent(), { intro: "Nuevo sismo detectado" });

  assert.equal(
    narration.text,
    "Nuevo sismo detectado en Mar de Molucas, de magnitud 3.5, a una profundidad de 75 kilometros."
  );
});

test("resolveEventNarration descarta cierres de 'pausa/comercial' (directo 24/7 sin cortes)", async (t) => {
  clearEditorialHistory();
  t.after(
    mockEditorial({
      intro: "Sismo detectado",
      closing: "Volvemos con mas informacion tras pausa",
      tectonicContext: "Evento asociado a la subduccion del Pacifico",
      cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
    })
  );

  const narration = await resolveEventNarration(
    makeEvent({ title: "M3.5 - Halmahera, Indonesia", magnitude: 3.5, depthKm: 9 })
  );

  // Se elimina el cierre de "pausa" pero se conserva el contexto tectonico.
  assert.equal(/pausa|volvemos/iu.test(narration.text), false);
  assert.equal(narration.text.includes("subduccion del Pacifico"), true);
});

test("resolveEventNarration descarta formulas de informacion no verificable", async (t) => {
  clearEditorialHistory();
  t.after(
    mockEditorial({
      intro: "Sismo detectado",
      closing: "Informacion en desarrollo. No tenemos mas informacion por ahora",
      tectonicContext: "Evento asociado al margen de subduccion del Pacifico",
      cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
    })
  );

  const narration = await resolveEventNarration(
    makeEvent({ title: "M3.5 - Halmahera, Indonesia", magnitude: 3.5, depthKm: 9 })
  );

  assert.equal(/informacion en desarrollo|no tenemos mas informacion/iu.test(narration.text), false);
  assert.equal(narration.text.includes("subduccion del Pacifico"), true);
});

test("resolveEventNarration descarta claims institucionales de monitoreo", async (t) => {
  clearEditorialHistory();
  t.after(
    mockEditorial({
      intro: "Sismo detectado",
      closing: "Se mantiene monitoreo permanente desde el centro sismologico",
      tectonicContext: null,
      cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
    })
  );

  const narration = await resolveEventNarration(makeEvent());

  assert.equal(/centro sismologico|monitoreo permanente|se mantiene monitoreo/iu.test(narration.text), false);
  assert.equal(
    narration.text,
    "Sismo detectado en Mar de Molucas, de magnitud 3.5, a una profundidad de 75 kilometros."
  );
});

test("resolveEventNarration preserves one useful tectonic context sentence", async (t) => {
  clearEditorialHistory();
  t.after(
    mockEditorial({
      intro: "Evento sismico en seguimiento",
      closing: null,
      tectonicContext: "Evento asociado al margen de subduccion del Pacifico",
      cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
    })
  );

  const narration = await resolveEventNarration(
    makeEvent({ title: "M3.2 - Mindanao, Philippines", magnitude: 3.2, depthKm: 12 })
  );

  assert.equal(
    narration.text,
    "Evento sismico en seguimiento en Mindanao, Filipinas, de magnitud 3.2, a una profundidad de 12 kilometros. Evento asociado al margen de subduccion del Pacifico."
  );
  assert.equal((narration.text.match(/Mindanao/gu) ?? []).length, 1);
  assert.equal((narration.text.match(/Filipinas/gu) ?? []).length, 1);
});
