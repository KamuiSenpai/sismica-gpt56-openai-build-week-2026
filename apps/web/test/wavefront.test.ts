import assert from "node:assert/strict";
import test from "node:test";

import { surfaceWaveRadius, wavefrontExpiresAt } from "../src/lib/wavefront";

test("surface wave remains hidden until the wave reaches the surface", () => {
  assert.equal(
    surfaceWaveRadius({
      originTimeMs: 0,
      nowMs: 1_000,
      velocityMps: 6_500,
      depthM: 10_000,
      maxRadiusM: 1_500_000
    }),
    0
  );
});

test("surface wave uses elapsed origin time and caps its radius", () => {
  const radius = surfaceWaveRadius({
    originTimeMs: 0,
    nowMs: 10_000,
    velocityMps: 6_500,
    depthM: 10_000,
    maxRadiusM: 1_500_000
  });
  assert.ok(Math.abs(radius - Math.sqrt(65_000 ** 2 - 10_000 ** 2)) < 0.001);
  assert.equal(
    surfaceWaveRadius({
      originTimeMs: 0,
      nowMs: 1_000_000,
      velocityMps: 6_500,
      depthM: 0,
      maxRadiusM: 1_500_000
    }),
    1_500_000
  );
});

test("wavefront expiry is derived from travel time", () => {
  assert.equal(wavefrontExpiresAt(1_000, 1_000, 0, 10_000), 11_000);
});
