import assert from "node:assert/strict";
import test from "node:test";

import { shouldRetryChatterboxRequest } from "../src/lib/seismicNeuralSpeech";

test("Chatterbox solo reintenta el 429 que representa un motor ocupado", () => {
  assert.equal(shouldRetryChatterboxRequest("chatterbox", 429, "tts_busy"), true);
  assert.equal(shouldRetryChatterboxRequest("chatterbox", 429, "rate_limit_exceeded"), false);
  assert.equal(shouldRetryChatterboxRequest("piper", 429, "tts_busy"), false);
});
