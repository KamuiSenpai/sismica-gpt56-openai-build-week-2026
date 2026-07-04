import assert from "node:assert/strict";
import test from "node:test";

// Estado determinista: DeepSeek deshabilitado -> debe caer siempre al fallback local.
process.env.DEEPSEEK_ENABLED = "false";

const { generateNarration, narrationRequestSchema, sanitizeNarrationEditorial, EVENT_CLOSINGS } =
  await import("../src/services/narrationService.js");

const seguimientoFallback = {
  intro: "Sismo detectado",
  closing: null,
  tectonicContext: null,
  cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" } as const
};
const breakingCue = { urgency: "alta", rhythm: "agil", tone: "directo" } as const;

test("narrationRequestSchema exige eventId y titulo", () => {
  assert.equal(
    narrationRequestSchema.safeParse({
      eventId: "USGS:1",
      source: "USGS",
      title: "M5.4 - Lima",
      normalizedPlace: "Lima, Peru",
      mode: "breaking",
      latitude: -12.05,
      longitude: -77.04
    }).success,
    true
  );
  assert.equal(
    narrationRequestSchema.safeParse({
      eventId: "USGS:1",
      source: "USGS",
      title: "M5.4 - Lima",
      normalizedPlace: "Lima, Peru",
      latitude: -12.05,
      longitude: -77.04,
      magnitude: 5.44,
      depthKm: 14.2,
      updatedAtUtc: "2026-07-02T15:40:40.000Z",
      recentLines: ["Nuevo sismo detectado en Chile"]
    }).success,
    true
  );
  assert.equal(narrationRequestSchema.safeParse({ eventId: "", title: "X" }).success, false);
  assert.equal(narrationRequestSchema.safeParse({ title: "X" }).success, false);
});

test("generateNarration devuelve pauta editorial local con DeepSeek deshabilitado", async () => {
  const editorial = await generateNarration({
    eventId: "USGS:test",
    source: "USGS",
    title: "M5.4 - Cerca de la costa de Lima",
    normalizedPlace: "Cerca de la costa de Lima, Peru",
    mode: "breaking",
    latitude: -12.1,
    longitude: -77.2,
    magnitude: 5.4,
    depthKm: 30,
    recentLines: ["Nuevo sismo detectado en Chile"]
  });
  assert.equal(typeof editorial.intro, "string");
  assert.deepEqual(editorial.cue, { urgency: "alta", rhythm: "agil", tone: "directo" });
  assert.notEqual(editorial.intro, "Nuevo sismo detectado");
  assert.equal(/sin reportes?/iu.test([editorial.intro, editorial.closing].join(" ")), false);
});

test("generateNarration cierra con un remate curado que rota sin repetir", async () => {
  const closings = EVENT_CLOSINGS as readonly string[];
  const seen: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const editorial = await generateNarration({
      eventId: `USGS:rot-${i}`,
      source: "USGS",
      title: "M3.4 - Mindanao, Philippines",
      normalizedPlace: "Mindanao, Filipinas",
      mode: "seguimiento",
      latitude: 7.1,
      longitude: 126.5,
      magnitude: 3.4,
      depthKm: 20,
      recentLines: seen.slice()
    });
    assert.ok(
      editorial.closing && closings.includes(editorial.closing),
      `remate curado: ${editorial.closing}`
    );
    // No repite un remate que ya salio en las lineas recientes.
    assert.equal(
      seen.some((line) => line.includes(editorial.closing ?? "")),
      false
    );
    seen.push(editorial.closing ?? "");
  }
});

test("generateNarration aporta microcontexto regional para Japon", async () => {
  const editorial = await generateNarration({
    eventId: "USGS:japan-1",
    source: "USGS",
    title: "M4.7 - Hokkaido, Japan",
    normalizedPlace: "Hokkaido, Japon",
    country: "Japon",
    mode: "seguimiento",
    latitude: 43.1,
    longitude: 142.9,
    magnitude: 4.7,
    depthKm: 52
  });

  assert.equal(
    editorial.tectonicContext,
    "Japon registra sismicidad frecuente por la convergencia de placas en el Pacifico occidental"
  );
});

test("sanitizeNarrationEditorial bloquea aperturas 'nuevo' cuando el modo es seguimiento", () => {
  const raw = {
    intro: "Nuevo sismo detectado",
    closing: null,
    tectonicContext: null,
    cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
  };
  const result = sanitizeNarrationEditorial(raw, seguimientoFallback, "seguimiento");
  assert.equal(result?.intro, "Sismo detectado");
});

test("sanitizeNarrationEditorial conserva 'Nuevo sismo detectado' en modo breaking", () => {
  const breakingFallback = { ...seguimientoFallback, intro: "Se registra un nuevo sismo", cue: breakingCue };
  const raw = { intro: "Nuevo sismo detectado", closing: null, tectonicContext: null, cue: breakingCue };
  const result = sanitizeNarrationEditorial(raw, breakingFallback, "breaking");
  assert.equal(result?.intro, "Nuevo sismo detectado");
});

test("sanitizeNarrationEditorial descarta cierres de 'pausa/comercial' (directo 24/7 sin cortes)", () => {
  const raw = {
    intro: "Sismo detectado",
    closing: "Volvemos con mas informacion tras pausa",
    tectonicContext: null,
    cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
  };
  const result = sanitizeNarrationEditorial(raw, seguimientoFallback, "seguimiento");
  assert.equal(result?.closing, null);
  assert.equal(/pausa|volvemos/iu.test(result?.closing ?? ""), false);
});

test("sanitizeNarrationEditorial descarta formulas de informacion no verificable", () => {
  const raw = {
    intro: "Sismo detectado",
    closing: "Informacion en desarrollo, no tenemos mas informacion por ahora",
    tectonicContext: null,
    cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
  };
  const result = sanitizeNarrationEditorial(raw, seguimientoFallback, "seguimiento");
  assert.equal(result?.intro, "Sismo detectado");
  assert.equal(result?.closing, null);
  assert.equal(/informacion en desarrollo|no tenemos mas informacion/iu.test(result?.closing ?? ""), false);
});

test("sanitizeNarrationEditorial descarta claims institucionales de monitoreo", () => {
  const raw = {
    intro: "Sismo detectado",
    closing: "Se mantiene monitoreo permanente desde el centro sismologico",
    tectonicContext: null,
    cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
  };
  const result = sanitizeNarrationEditorial(raw, seguimientoFallback, "seguimiento");
  assert.equal(result?.intro, "Sismo detectado");
  assert.equal(result?.closing, null);
});

test("sanitizeNarrationEditorial conserva una apertura valida de seguimiento", () => {
  const raw = {
    intro: "Evento sismico en seguimiento",
    closing: null,
    tectonicContext: null,
    cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
  };
  const result = sanitizeNarrationEditorial(raw, seguimientoFallback, "seguimiento");
  assert.equal(result?.intro, "Evento sismico en seguimiento");
});
