import assert from "node:assert/strict";
import test from "node:test";

// Estado determinista: DeepSeek deshabilitado -> debe caer siempre al fallback local.
process.env.DEEPSEEK_ENABLED = "false";

const { generateNarration, narrationRequestSchema } = await import("../src/services/narrationService.js");

test("narrationRequestSchema exige eventId y titulo", () => {
  assert.equal(
    narrationRequestSchema.safeParse({
      eventId: "USGS:1",
      title: "M5.4 - Lima",
      normalizedPlace: "Lima, Peru",
      mode: "breaking"
    }).success,
    true
  );
  assert.equal(
    narrationRequestSchema.safeParse({
      eventId: "USGS:1",
      title: "M5.4 - Lima",
      normalizedPlace: "Lima, Peru",
      magnitude: 5.44,
      depthKm: 14.2,
      updatedAtUtc: "2026-07-02T15:40:40.000Z"
    }).success,
    true
  );
  assert.equal(narrationRequestSchema.safeParse({ eventId: "", title: "X" }).success, false);
  assert.equal(narrationRequestSchema.safeParse({ title: "X" }).success, false);
});

test("generateNarration devuelve pauta editorial local con DeepSeek deshabilitado", async () => {
  const editorial = await generateNarration({
    eventId: "USGS:test",
    title: "M5.4 - Cerca de la costa de Lima",
    normalizedPlace: "Cerca de la costa de Lima, Peru",
    mode: "breaking",
    magnitude: 5.4,
    depthKm: 30
  });
  assert.deepEqual(editorial, {
    intro: "Nuevo sismo detectado",
    closing: "Seguimos monitoreando la zona",
    cue: { urgency: "alta", rhythm: "agil", tone: "directo" }
  });
});
