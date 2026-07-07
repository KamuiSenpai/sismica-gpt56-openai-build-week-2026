import assert from "node:assert/strict";
import test from "node:test";

// Aseguramos un estado determinista: TTS deshabilitado y motores sin configurar.
process.env.TTS_ENABLED = "false";
delete process.env.PIPER_BINARY_PATH;
delete process.env.PIPER_VOICE_MODEL;
delete process.env.XTTS_SERVICE_URL;

const {
  getHealth,
  normalizeTextForTtsEngine,
  synthesize,
  ttsEngineSchema,
  ttsRequestSchema,
  TtsUnavailableError,
  voiceEngineSchema
} = await import("../src/services/ttsService.js");
const { getTtsBridgeManifest, parsePcmWavDurationMs } = await import("../src/services/ttsBridgeService.js");

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

test("Chatterbox conserva puntuacion real y otros motores usan comas seguras", () => {
  assert.equal(normalizeTextForTtsEngine("chatterbox", "Frase uno. Frase dos"), "Frase uno. Frase dos.");
  assert.equal(
    normalizeTextForTtsEngine("piper", "Magnitud 4.0. Frase dos."),
    "Magnitud 4 punto 0, Frase dos,"
  );
});

test("el manifiesto puede obtener la duracion exacta desde un WAV PCM", () => {
  const sampleRate = 24_000;
  const byteRate = sampleRate * 2;
  const durationSeconds = 7.5;
  const dataBytes = Math.round(byteRate * durationSeconds);
  const wav = Buffer.alloc(44);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);

  assert.equal(parsePcmWavDurationMs(wav), 7_500);
  assert.equal(parsePcmWavDurationMs(Buffer.from("not-a-wave")), null);
});

test("los catalogos oficiales conservan clase, rol y aprobacion", async () => {
  const informative = await getTtsBridgeManifest("official-informative");
  assert.ok(informative);
  assert.ok(
    informative.items.some(
      (item) =>
        item.classId === "verified_tectonics" &&
        item.playbackRole === "guide" &&
        item.approvalStatus === "approved"
    )
  );

  const promotional = await getTtsBridgeManifest("official-promotional");
  assert.ok(promotional);
  assert.ok(promotional.items.length > 0);
  assert.equal(
    promotional.items.every(
      (item) =>
        item.classId === "promotional_channel" &&
        item.playbackRole === "guide" &&
        item.approvalStatus === "approved"
    ),
    true
  );
});
