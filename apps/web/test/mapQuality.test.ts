import assert from "node:assert/strict";
import test from "node:test";

import { resolveMapRenderScale } from "../src/lib/mapQuality";

test("map rendering stays sharp when browser zoom reports a DPR below one", () => {
  const scale = resolveMapRenderScale(1920, 1080, 0.9);

  assert.equal(scale.effectivePixelRatio, 1.25);
  assert.ok(Math.abs(scale.resolutionScale - 1.3888888889) < 0.000001);
});

test("map rendering respects a 4K drawing-buffer budget", () => {
  const scale = resolveMapRenderScale(3840, 2160, 2);

  assert.equal(scale.effectivePixelRatio, 1);
  assert.equal(scale.resolutionScale, 0.5);
});

test("map rendering uses available HiDPI detail below the pixel budget", () => {
  const scale = resolveMapRenderScale(1920, 1080, 2);

  assert.equal(scale.effectivePixelRatio, 2);
  assert.equal(scale.resolutionScale, 1);
});
