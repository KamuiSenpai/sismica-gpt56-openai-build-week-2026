import assert from "node:assert/strict";
import test from "node:test";

import { type SeismicEvent } from "@sismica/shared";

import { clearEditorialHistory } from "../src/lib/editorialHistory";
import {
  buildBridgePlaybackPlanForTests,
  classifyBridgeGroup,
  neuralFallbackOrder,
  pickBridgeCandidateForTests,
  pickBreakingNarrationIntro,
  rememberBlobReadyTimingForTests,
  resetBlobReadyTelemetryForTests,
  resetBridgeSelectionStateForTests,
  resolveEventNarration
} from "../src/lib/seismicVoice";

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

function repeatedTerms(count: number): string {
  return Array.from({ length: count }, (_value, index) => `termino${index}`).join(" ");
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

test("pickBreakingNarrationIntro returns a stable allowed intro for the same event", () => {
  const event = makeEvent({ eventId: "USGS:breaking-1" });
  const introA = pickBreakingNarrationIntro(event);
  const introB = pickBreakingNarrationIntro(event);

  assert.equal(introA, introB);
  assert.ok(
    [
      "Nuevo sismo detectado",
      "Se registra un nuevo sismo",
      "Actualizacion sismica reciente",
      "Evento sismico reciente"
    ].includes(introA)
  );
});

test("classifyBridgeGroup uses standard shallow, intermediate and deep ranges", () => {
  assert.equal(
    classifyBridgeGroup(
      makeEvent({ title: "M3.4 - Fukushima, Japon", depthKm: 50, latitude: 37.7, longitude: 141.7 })
    ),
    "subduccion_pacifico_superficial"
  );
  assert.equal(
    classifyBridgeGroup(
      makeEvent({ title: "M4.4 - Pastaza, Peru", depthKm: 130, latitude: -4.2, longitude: -76.8 })
    ),
    "subduccion_pacifico_intermedio"
  );
  assert.equal(
    classifyBridgeGroup(
      makeEvent({ title: "M3.2 - Socaire, Chile", depthKm: 213, latitude: -23.9, longitude: -67.4 })
    ),
    "subduccion_pacifico_intermedio"
  );
  assert.equal(
    classifyBridgeGroup(
      makeEvent({ title: "M5.0 - Tonga", depthKm: 350, latitude: -20.0, longitude: -175.0 })
    ),
    "subduccion_pacifico_profundo"
  );
});

test("a newly arrived earthquake never switches from Chatterbox to Piper", () => {
  assert.deepEqual(neuralFallbackOrder("chatterbox", false), ["chatterbox"]);
  assert.deepEqual(neuralFallbackOrder("chatterbox", true), ["chatterbox", "piper"]);
});

test("station guides exhaust the active voice pool before repeating", () => {
  resetBridgeSelectionStateForTests();
  const manifest = {
    library: "station",
    version: "test",
    generatedAtUtc: "2026-07-04T00:00:00.000Z",
    voices: ["mx_carolina"],
    groups: [],
    items: [
      {
        voice: "mx_carolina",
        groupId: "station_identity",
        variant: "13",
        text: "a",
        bytes: 1,
        path: "/tmp/13.wav",
        url: "http://localhost/13.wav",
        keywords: []
      },
      {
        voice: "mx_carolina",
        groupId: "station_identity",
        variant: "15",
        text: "b",
        bytes: 1,
        path: "/tmp/15.wav",
        url: "http://localhost/15.wav",
        keywords: []
      },
      {
        voice: "mx_carolina",
        groupId: "station_identity",
        variant: "17",
        text: "c",
        bytes: 1,
        path: "/tmp/17.wav",
        url: "http://localhost/17.wav",
        keywords: []
      },
      {
        voice: "mx_carolina",
        groupId: "station_identity",
        variant: "19",
        text: "d",
        bytes: 1,
        path: "/tmp/19.wav",
        url: "http://localhost/19.wav",
        keywords: []
      }
    ]
  } as const;

  const firstCycle = Array.from(
    { length: 4 },
    () => pickBridgeCandidateForTests(manifest, "mx_carolina", "station_identity")?.variant
  );
  assert.equal(
    firstCycle.every((variant): variant is string => typeof variant === "string"),
    true
  );
  assert.equal(new Set(firstCycle).size, 4);

  const fifth = pickBridgeCandidateForTests(manifest, "mx_carolina", "station_identity");
  assert.ok(fifth);
  assert.equal(firstCycle.includes(fifth.variant), true);
  assert.equal(fifth.variant === firstCycle[3], false);
});

test("station guides prefer keyword-matching context when available", () => {
  resetBridgeSelectionStateForTests();
  const manifest = {
    library: "station",
    version: "test",
    generatedAtUtc: "2026-07-04T00:00:00.000Z",
    voices: ["mx_sofia"],
    groups: [],
    items: [
      {
        voice: "mx_sofia",
        groupId: "station_identity",
        variant: "03",
        text: "Sudamerica",
        bytes: 1,
        path: "/tmp/03.wav",
        url: "http://localhost/03.wav",
        keywords: ["peru", "chile", "ecuador"]
      },
      {
        voice: "mx_sofia",
        groupId: "station_identity",
        variant: "11",
        text: "General",
        bytes: 1,
        path: "/tmp/11.wav",
        url: "http://localhost/11.wav",
        keywords: []
      }
    ]
  } as const;

  const selected = pickBridgeCandidateForTests(
    manifest,
    "mx_sofia",
    "station_identity",
    "Sismo detectado en la costa de Peru"
  );
  assert.equal(selected?.variant, "03");
});

test("station guides widen to generic alternatives before repeating the same contextual clip", () => {
  resetBridgeSelectionStateForTests();
  const manifest = {
    library: "station",
    version: "test",
    generatedAtUtc: "2026-07-04T00:00:00.000Z",
    voices: ["mx_sofia"],
    groups: [],
    items: [
      {
        voice: "mx_sofia",
        groupId: "station_identity",
        variant: "03",
        text: "Sudamerica",
        bytes: 1,
        path: "/tmp/03.wav",
        url: "http://localhost/03.wav",
        keywords: ["peru", "chile", "ecuador"]
      },
      {
        voice: "mx_sofia",
        groupId: "station_identity",
        variant: "11",
        text: "General 1",
        bytes: 1,
        path: "/tmp/11.wav",
        url: "http://localhost/11.wav",
        keywords: []
      },
      {
        voice: "mx_sofia",
        groupId: "station_identity",
        variant: "13",
        text: "General 2",
        bytes: 1,
        path: "/tmp/13.wav",
        url: "http://localhost/13.wav",
        keywords: []
      }
    ]
  } as const;

  const first = pickBridgeCandidateForTests(
    manifest,
    "mx_sofia",
    "station_identity",
    "Sismo detectado en Peru"
  );
  const second = pickBridgeCandidateForTests(
    manifest,
    "mx_sofia",
    "station_identity",
    "Sismo detectado en Peru"
  );
  const third = pickBridgeCandidateForTests(
    manifest,
    "mx_sofia",
    "station_identity",
    "Sismo detectado en Peru"
  );

  assert.equal(first?.variant, "03");
  assert.ok(second);
  assert.ok(third);
  assert.equal(second?.variant === "03", false);
  assert.equal(third?.variant === "03", false);
  assert.equal(new Set([second?.variant, third?.variant]).size, 2);
});

test("bridge plan skips long station fillers for short and medium texts", () => {
  assert.deepEqual(buildBridgePlaybackPlanForTests(repeatedTerms(8)), {
    libraries: ["short"],
    stationEarliestAtMs: null,
    overflowLibraries: ["extended"],
    maxBridgeElapsedMs: 20000
  });

  assert.deepEqual(buildBridgePlaybackPlanForTests(repeatedTerms(25)), {
    libraries: ["short", "extended"],
    stationEarliestAtMs: null,
    overflowLibraries: ["extended"],
    maxBridgeElapsedMs: 30000
  });

  assert.deepEqual(buildBridgePlaybackPlanForTests(repeatedTerms(40)), {
    libraries: ["short", "extended", "extended"],
    stationEarliestAtMs: null,
    overflowLibraries: ["extended"],
    maxBridgeElapsedMs: 38000
  });
});

test("bridge plan only enables station guides for clearly long texts", () => {
  assert.deepEqual(buildBridgePlaybackPlanForTests(repeatedTerms(55)), {
    libraries: ["short", "extended", "extended", "station"],
    stationEarliestAtMs: 18000,
    overflowLibraries: ["extended"],
    maxBridgeElapsedMs: 46000
  });

  assert.deepEqual(buildBridgePlaybackPlanForTests(repeatedTerms(70)), {
    libraries: ["short", "extended", "extended", "station"],
    stationEarliestAtMs: 16000,
    overflowLibraries: ["extended", "station"],
    maxBridgeElapsedMs: 52000
  });
});

test("bridge plan adapts station delay from recent blob-ready telemetry by voice and length", () => {
  resetBlobReadyTelemetryForTests();
  rememberBlobReadyTimingForTests({
    engine: "chatterbox",
    voice: "mx_carolina",
    durationMs: 21000,
    wordCount: 55,
    cacheState: "missing"
  });
  rememberBlobReadyTimingForTests({
    engine: "chatterbox",
    voice: "mx_carolina",
    durationMs: 22000,
    wordCount: 55,
    cacheState: "pending"
  });
  rememberBlobReadyTimingForTests({
    engine: "chatterbox",
    voice: "mx_carolina",
    durationMs: 23000,
    wordCount: 55,
    cacheState: "missing"
  });

  assert.deepEqual(buildBridgePlaybackPlanForTests(repeatedTerms(55), "mx_carolina", "chatterbox"), {
    libraries: ["short", "extended", "extended", "station"],
    stationEarliestAtMs: 20600,
    overflowLibraries: ["extended"],
    maxBridgeElapsedMs: 32000
  });
});

test("ready-cache blob timings do not skew adaptive station delay", () => {
  resetBlobReadyTelemetryForTests();
  rememberBlobReadyTimingForTests({
    engine: "chatterbox",
    voice: "mx_carolina",
    durationMs: 500,
    wordCount: 55,
    cacheState: "ready"
  });

  assert.deepEqual(buildBridgePlaybackPlanForTests(repeatedTerms(55), "mx_carolina", "chatterbox"), {
    libraries: ["short", "extended", "extended", "station"],
    stationEarliestAtMs: 18000,
    overflowLibraries: ["extended"],
    maxBridgeElapsedMs: 46000
  });
});
