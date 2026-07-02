import assert from "node:assert/strict";
import test from "node:test";

// Estado determinista: DeepSeek deshabilitado -> debe caer siempre a null (plantilla).
process.env.DEEPSEEK_ENABLED = "false";

const { generateNarration, narrationRequestSchema } = await import("../src/services/narrationService.js");

test("narrationRequestSchema exige eventId y titulo", () => {
  assert.equal(narrationRequestSchema.safeParse({ eventId: "USGS:1", title: "M5.4 - Lima" }).success, true);
  assert.equal(narrationRequestSchema.safeParse({ eventId: "", title: "X" }).success, false);
  assert.equal(narrationRequestSchema.safeParse({ title: "X" }).success, false);
});

test("generateNarration devuelve null con DeepSeek deshabilitado (usa plantilla)", async () => {
  const text = await generateNarration({
    eventId: "USGS:test",
    title: "M5.4 - Cerca de la costa de Lima",
    magnitude: 5.4,
    depthKm: 30
  });
  assert.equal(text, null);
});
