import assert from "node:assert/strict";
import test from "node:test";

import {
  clearEditorialHistory,
  getRecentEditorialLines,
  rememberEditorialLine
} from "../src/lib/editorialHistory";

test("editorial history avoids exact consecutive duplicates", () => {
  clearEditorialHistory();
  rememberEditorialLine("Nuevo sismo detectado en Chile.");
  rememberEditorialLine("Nuevo sismo detectado en Chile.");
  assert.deepEqual(getRecentEditorialLines(), ["Nuevo sismo detectado en Chile."]);
});

test("editorial history keeps only the latest 20 lines", () => {
  clearEditorialHistory();
  for (let index = 1; index <= 24; index += 1) {
    rememberEditorialLine(`Linea ${index}`);
  }
  const lines = getRecentEditorialLines(25);
  assert.equal(lines.length, 20);
  assert.equal(lines[0], "Linea 5");
  assert.equal(lines[19], "Linea 24");
});
