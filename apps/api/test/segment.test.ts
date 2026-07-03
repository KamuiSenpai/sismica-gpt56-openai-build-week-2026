import assert from "node:assert/strict";
import test from "node:test";

process.env.DEEPSEEK_ENABLED = "false";

const {
  EDUCATIVO_TOPICS,
  RECOMMENDATION_TOPICS,
  generateHandoffSegment,
  generateSegment,
  handoffRequestSchema,
  sanitizeGeneratedSegmentPacket,
  segmentRequestSchema
} = await import("../src/services/segmentService.js");
const { directorStateSchema } = await import("../src/services/directorService.js");

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

test("handoffRequestSchema acepta relevo entre Carolina y Liam", () => {
  assert.equal(
    handoffRequestSchema.safeParse({
      currentHost: "Carolina",
      nextHost: "Liam"
    }).success,
    true
  );
});

test("directorStateSchema acepta el estado real del director IA", () => {
  assert.equal(
    directorStateSchema.safeParse({
      livePending: 0,
      recentCount: 100,
      minutesSinceRecap: 0.2,
      minutesSinceEducativo: 0.2,
      biggestRecentMagnitude: 5.1
    }).success,
    true
  );
});

test("generateHandoffSegment usa pauta local si DeepSeek esta deshabilitado", async () => {
  const handoff = await generateHandoffSegment({
    currentHost: "Carolina",
    nextHost: "Liam"
  });
  assert.equal(handoff.currentHostLine.includes("Liam"), true);
  assert.equal(handoff.nextHostLine.includes("Carolina"), true);
});

test("sanitizeGeneratedSegmentPacket descarta formulas de informacion no verificable", () => {
  const packet = sanitizeGeneratedSegmentPacket(
    {
      text: "Informacion en desarrollo. No tenemos mas informacion por ahora.",
      cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
    },
    {
      kind: "resumen",
      totalLastHour: 6,
      biggestMagnitude: 4.8,
      biggestPlace: "Mar de Molucas"
    }
  );
  assert.equal(/informacion en desarrollo|no tenemos mas informacion/iu.test(packet.text), false);
  assert.equal(packet.text.includes("En la ultima hora"), true);
});

test("sanitizeGeneratedSegmentPacket descarta claims de autoridad o monitoreo institucional", () => {
  const packet = sanitizeGeneratedSegmentPacket(
    {
      text: "Se mantiene monitoreo permanente desde el centro sismologico.",
      cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
    },
    {
      kind: "resumen",
      totalLastHour: 6,
      biggestMagnitude: 4.8,
      biggestPlace: "Mar de Molucas"
    }
  );
  assert.equal(packet.text.includes("En la ultima hora"), true);
  assert.equal(/centro sismologico|monitoreo permanente/iu.test(packet.text), false);
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
