import assert from "node:assert/strict";
import test from "node:test";

// Aseguramos un estado determinista: TTS deshabilitado y motores sin configurar.
process.env.TTS_ENABLED = "false";
delete process.env.PIPER_BINARY_PATH;
delete process.env.PIPER_VOICE_MODEL;
delete process.env.XTTS_SERVICE_URL;

const { getHealth, synthesize, ttsEngineSchema, ttsRequestSchema, TtsUnavailableError, voiceEngineSchema } =
  await import("../src/services/ttsService.js");

test("ttsEngineSchema acepta los tres motores locales", () => {
  assert.equal(ttsEngineSchema.safeParse("piper").success, true);
  assert.equal(ttsEngineSchema.safeParse("xtts").success, true);
  assert.equal(ttsEngineSchema.safeParse("chatterbox").success, true);
  assert.equal(ttsEngineSchema.safeParse("browser").success, false);
  assert.equal(ttsEngineSchema.safeParse(undefined).success, false);
});

test("voiceEngineSchema acepta los motores seleccionables por la interfaz", () => {
  for (const engine of ["browser", "piper", "xtts", "chatterbox"]) {
    assert.equal(voiceEngineSchema.safeParse(engine).success, true);
  }
  assert.equal(voiceEngineSchema.safeParse("cuda").success, false);
});

test("ttsRequestSchema exige texto no vacio", () => {
  assert.equal(ttsRequestSchema.safeParse({ text: "Sismo M5 cerca de Lima" }).success, true);
  assert.equal(ttsRequestSchema.safeParse({ text: "   " }).success, false);
  assert.equal(ttsRequestSchema.safeParse({}).success, false);
});

test("getHealth reporta motores no disponibles cuando no hay configuracion", async () => {
  const health = await getHealth();
  assert.equal(typeof health.enabled, "boolean");
  assert.equal(health.engines.piper.ok, false);
  assert.equal(health.engines.xtts.ok, false);
});

test("synthesize lanza TtsUnavailableError si el motor no esta listo", async () => {
  await assert.rejects(() => synthesize("piper", { text: "Sismo de prueba" }), TtsUnavailableError);
  await assert.rejects(() => synthesize("xtts", { text: "Sismo de prueba" }), TtsUnavailableError);
});
