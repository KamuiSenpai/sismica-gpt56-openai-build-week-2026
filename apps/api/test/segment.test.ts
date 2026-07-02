import assert from "node:assert/strict";
import test from "node:test";

process.env.DEEPSEEK_ENABLED = "false";

const {
  EDUCATIVO_TOPICS,
  RECOMMENDATION_TOPICS,
  generateHandoffSegment,
  generateSegment,
  handoffRequestSchema,
  segmentRequestSchema
} = await import("../src/services/segmentService.js");

test("segmentRequestSchema acepta recomendaciones", () => {
  assert.equal(
    segmentRequestSchema.safeParse({
      kind: "recomendacion",
      topic: "durante el sismo"
    }).success,
    true
  );
});

test("segmentRequestSchema acepta boletines de 15 minutos", () => {
  assert.equal(
    segmentRequestSchema.safeParse({
      kind: "boletin",
      windowMinutes: 15,
      currentCount: 6,
      previousCount: 4,
      biggestMagnitude: 4.8,
      biggestPlace: "Frente a la costa de Taiwan",
      activeAreas: ["Indonesia", "Chile", "Taiwan"],
      recentLines: ["Boletin de 15 minutos anterior"]
    }).success,
    true
  );
});

test("generateSegment usa variantes locales para recomendaciones si DeepSeek esta deshabilitado", async () => {
  const packet = await generateSegment({
    kind: "recomendacion",
    topic: RECOMMENDATION_TOPICS[0].topic
  });
  assert.equal(typeof packet.text, "string");
  assert.equal(packet.text.trim().length > 0, true);
  assert.deepEqual(packet.cue, { urgency: "media", rhythm: "fluido", tone: "sobrio" });
});

test("generateSegment construye boletin local cuando DeepSeek esta deshabilitado", async () => {
  const packet = await generateSegment({
    kind: "boletin",
    windowMinutes: 30,
    currentCount: 8,
    previousCount: 5,
    biggestMagnitude: 5.1,
    biggestPlace: "Frente a la costa de Taiwan",
    activeAreas: ["Indonesia", "Chile", "Taiwan"],
    regionalFocus: "Indonesia"
  });
  assert.equal(packet.text.includes("Boletin de 30 minutos"), true);
  assert.equal(packet.text.includes("8 sismos"), true);
  assert.equal(packet.text.includes("Frente a la costa de Taiwan"), true);
  assert.deepEqual(packet.cue, { urgency: "media", rhythm: "fluido", tone: "directo" });
});

test("handoffRequestSchema acepta relevo entre Claribel y Andrew", () => {
  assert.equal(
    handoffRequestSchema.safeParse({
      currentHost: "Claribel",
      nextHost: "Andrew"
    }).success,
    true
  );
});

test("generateHandoffSegment usa pauta local si DeepSeek esta deshabilitado", async () => {
  const handoff = await generateHandoffSegment({
    currentHost: "Claribel",
    nextHost: "Andrew"
  });
  assert.equal(handoff.overlayText.includes("Andrew"), true);
  assert.equal(handoff.currentHostLine.includes("Andrew"), true);
  assert.equal(handoff.nextHostLine.includes("Claribel"), true);
});

test("los catalogos de aire no incluyen replicas como tema activo", () => {
  assert.equal(
    EDUCATIVO_TOPICS.some((entry: { topic: string }) => /replic/iu.test(entry.topic)),
    false
  );
  assert.equal(
    RECOMMENDATION_TOPICS.some((entry: { topic: string }) => /replic/iu.test(entry.topic)),
    false
  );
});
