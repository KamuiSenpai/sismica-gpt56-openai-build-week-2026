import assert from "node:assert/strict";
import test from "node:test";

import { type SeismicEvent } from "@sismica/shared";

import { clearEditorialHistory } from "../src/lib/editorialHistory";
import {
  buildBridgePlaybackPlanForTests,
  classifyBridgeGroup,
  neuralFallbackOrder,
  pickBridgeCandidateForTests,
  pickDirectorV2TransitionCandidateForTests,
  pickGuideBridgeCandidateForTests,
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

test("guide clips exhaust the active voice pool and do not repeat within one hour", () => {
  resetBridgeSelectionStateForTests();
  const manifest = {
    library: "educational",
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
  assert.equal(fifth, null);
});

test("Director V2 official reutiliza pautas si el pool se agota antes de una hora", () => {
  resetBridgeSelectionStateForTests();
  const manifest = {
    library: "official-informative",
    version: "v2",
    generatedAtUtc: "2026-07-05T00:00:00.000Z",
    voices: ["mx_carolina"],
    groups: [],
    items: [
      {
        voice: "mx_carolina",
        classId: "station_identity",
        playbackRole: "guide",
        groupId: "station_identity",
        variant: "01",
        text: "Pauta oficial",
        bytes: 1,
        durationMs: 5_200,
        approvalStatus: "approved",
        path: "/tmp/station.wav",
        url: "http://localhost/station.wav",
        keywords: []
      }
    ]
  } as const;

  const first = pickGuideBridgeCandidateForTests(manifest, "station_identity", undefined, {
    requireApproved: true,
    directorV2Eligible: true,
    strictGroup: true
  });
  const second = pickGuideBridgeCandidateForTests(manifest, "station_identity", undefined, {
    requireApproved: true,
    directorV2Eligible: true,
    strictGroup: true,
    allowRepeatWhenExhausted: true
  });

  assert.equal(first?.variant, "01");
  assert.equal(second?.variant, "01");
});

test("recorded guides rotate through every manifest voice before reusing one", () => {
  resetBridgeSelectionStateForTests();
  const voices = ["mx_carolina", "mx_liam", "mx_martin", "mx_ninoska", "mx_sofia", "mx_valentina"];
  const manifest = {
    library: "educational",
    version: "test",
    generatedAtUtc: "2026-07-05T00:00:00.000Z",
    voices,
    groups: [],
    items: voices.flatMap((voice) =>
      ["01", "02"].map((variant) => ({
        voice,
        groupId: "station_identity",
        variant,
        text: `${voice} ${variant}`,
        bytes: 1,
        path: `/tmp/${voice}-${variant}.wav`,
        url: `http://localhost/${voice}-${variant}.wav`,
        keywords: []
      }))
    )
  };

  const selectedVoices = Array.from(
    { length: voices.length + 1 },
    () => pickGuideBridgeCandidateForTests(manifest, "station_identity")?.voice
  );

  assert.deepEqual(new Set(selectedVoices.slice(0, voices.length)), new Set(voices));
  assert.notEqual(selectedVoices[voices.length - 1], selectedVoices[voices.length]);
});

test("Director V2 separa remates de continuidad de pautas de espera official", () => {
  resetBridgeSelectionStateForTests();
  const base = {
    voice: "mx_carolina",
    groupId: "station_identity",
    text: "Pauta",
    bytes: 1,
    path: "/tmp/pauta.wav",
    url: "http://localhost/pauta.wav",
    keywords: []
  };
  const manifest = {
    library: "official-educational",
    version: "v2",
    generatedAtUtc: "2026-07-05T00:00:00.000Z",
    voices: ["mx_carolina"],
    groups: [],
    items: [
      {
        ...base,
        classId: "continuity_transition",
        playbackRole: "transition",
        groupId: "continuity_transition",
        variant: "transition",
        durationMs: 4_200,
        approvalStatus: "approved"
      },
      {
        ...base,
        classId: "station_identity",
        playbackRole: "guide",
        variant: "pending",
        durationMs: 7_500,
        approvalStatus: "pending"
      },
      {
        ...base,
        classId: "verified_tectonics",
        playbackRole: "guide",
        variant: "approved",
        durationMs: 11_200,
        approvalStatus: "approved"
      }
    ]
  } as const;

  const guide = pickGuideBridgeCandidateForTests(manifest, "continuity_transition", undefined, {
    requireApproved: true,
    directorV2Eligible: true,
    strictGroup: true
  });
  const transition = pickDirectorV2TransitionCandidateForTests(manifest);

  assert.equal(guide, null);
  assert.equal(transition?.variant, "transition");
});

test("Director V2 official no cambia de clase mediante fallback", () => {
  resetBridgeSelectionStateForTests();
  const manifest = {
    library: "official-informative",
    version: "v2",
    generatedAtUtc: "2026-07-05T00:00:00.000Z",
    voices: ["mx_carolina"],
    groups: [],
    items: [
      {
        voice: "mx_carolina",
        classId: "verified_tectonics",
        playbackRole: "guide",
        groupId: "verified_tectonics",
        variant: "01",
        text: "Pauta tectonica",
        bytes: 1,
        durationMs: 6_500,
        approvalStatus: "approved",
        path: "/tmp/tectonica.wav",
        url: "http://localhost/tectonica.wav",
        keywords: []
      }
    ]
  } as const;

  const strict = pickGuideBridgeCandidateForTests(manifest, "station_identity", undefined, {
    requireApproved: true,
    directorV2Eligible: true,
    strictGroup: true
  });
  const fallback = pickGuideBridgeCandidateForTests(manifest, "station_identity", undefined, {
    requireApproved: true,
    directorV2Eligible: true
  });

  assert.equal(strict, null);
  assert.equal(fallback?.groupId, "verified_tectonics");
});

test("Director V2 conserva el filtro generico de duracion para catalogos trial", () => {
  resetBridgeSelectionStateForTests();
  const base = {
    voice: "mx_carolina",
    groupId: "station_identity",
    text: "Pauta",
    bytes: 1,
    path: "/tmp/pauta.wav",
    url: "http://localhost/pauta.wav",
    keywords: []
  };
  const manifest = {
    library: "educational",
    version: "trial",
    generatedAtUtc: "2026-07-05T00:00:00.000Z",
    voices: ["mx_carolina"],
    groups: [],
    items: [
      { ...base, variant: "short", durationMs: 4_900, approvalStatus: "approved" },
      { ...base, variant: "approved", durationMs: 8_000, approvalStatus: "approved" },
      { ...base, variant: "long", durationMs: 10_100, approvalStatus: "approved" }
    ]
  } as const;

  const selected = pickGuideBridgeCandidateForTests(manifest, "station_identity", undefined, {
    directorV2Eligible: true
  });

  assert.equal(selected?.variant, "approved");
});

test("guide clips prefer keyword-matching context when available", () => {
  resetBridgeSelectionStateForTests();
  const manifest = {
    library: "educational",
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

test("guide clips widen to generic alternatives before repeating the same contextual clip", () => {
  resetBridgeSelectionStateForTests();
  const manifest = {
    library: "educational",
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

test("bridge plan uses only informative and educational guides", () => {
  assert.deepEqual(buildBridgePlaybackPlanForTests(repeatedTerms(8)), {
    libraries: ["educational", "informative"],
    maxBridgeElapsedMs: 20000
  });

  assert.deepEqual(buildBridgePlaybackPlanForTests(repeatedTerms(25)), {
    libraries: ["educational", "informative"],
    maxBridgeElapsedMs: 30000
  });

  assert.deepEqual(buildBridgePlaybackPlanForTests(repeatedTerms(40)), {
    libraries: ["educational", "informative"],
    maxBridgeElapsedMs: 38000
  });
});

test("bridge plan adds at most one guide selected by the adaptive cadence", () => {
  assert.deepEqual(
    buildBridgePlaybackPlanForTests(repeatedTerms(55), "mx_carolina", "chatterbox", "educational"),
    {
      libraries: ["educational", "informative"],
      maxBridgeElapsedMs: 46000
    }
  );

  assert.deepEqual(
    buildBridgePlaybackPlanForTests(repeatedTerms(70), "mx_carolina", "chatterbox", "informative"),
    {
      libraries: ["informative", "educational"],
      maxBridgeElapsedMs: 52000
    }
  );
});

test("bridge plan orders the guide libraries by expected wait", () => {
  assert.deepEqual(buildBridgePlaybackPlanForTests(repeatedTerms(55)), {
    libraries: ["educational", "informative"],
    maxBridgeElapsedMs: 46000
  });

  assert.deepEqual(buildBridgePlaybackPlanForTests(repeatedTerms(70)), {
    libraries: ["informative", "educational"],
    maxBridgeElapsedMs: 52000
  });
});

test("bridge plan adapts its budget from recent blob-ready telemetry by voice and length", () => {
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
    libraries: ["educational", "informative"],
    maxBridgeElapsedMs: 32000
  });
});

test("ready-cache blob timings do not skew adaptive bridge timing", () => {
  resetBlobReadyTelemetryForTests();
  rememberBlobReadyTimingForTests({
    engine: "chatterbox",
    voice: "mx_carolina",
    durationMs: 500,
    wordCount: 55,
    cacheState: "ready"
  });

  assert.deepEqual(buildBridgePlaybackPlanForTests(repeatedTerms(55), "mx_carolina", "chatterbox"), {
    libraries: ["educational", "informative"],
    maxBridgeElapsedMs: 46000
  });
});

test("bridge budget follows slow real latency above the word-count hardcap", () => {
  resetBlobReadyTelemetryForTests();
  // Generaciones lentas reales (~55 s) para 40 palabras (hardcap fijo 38 s).
  for (const durationMs of [55000, 55000, 55000]) {
    rememberBlobReadyTimingForTests({
      engine: "chatterbox",
      voice: "mx_carolina",
      durationMs,
      wordCount: 40,
      cacheState: "missing"
    });
  }
  // El presupuesto sigue la latencia observada (55 s + 2.5 s slack) en vez de capar en 38 s,
  // para que los puentes cubran la cola de la generacion lenta.
  assert.deepEqual(buildBridgePlaybackPlanForTests(repeatedTerms(40), "mx_carolina", "chatterbox"), {
    libraries: ["educational", "informative"],
    maxBridgeElapsedMs: 57500
  });
});

test("bridge budget never exceeds the absolute safety ceiling", () => {
  resetBlobReadyTelemetryForTests();
  // Latencia patologica: la generacion casi nunca completa.
  for (const durationMs of [150000, 150000, 150000]) {
    rememberBlobReadyTimingForTests({
      engine: "chatterbox",
      voice: "mx_carolina",
      durationMs,
      wordCount: 40,
      cacheState: "missing"
    });
  }
  // El techo de 90 s acota el relleno aunque la estimacion sea mayor.
  assert.deepEqual(buildBridgePlaybackPlanForTests(repeatedTerms(40), "mx_carolina", "chatterbox"), {
    libraries: ["educational", "informative"],
    maxBridgeElapsedMs: 90000
  });
});
