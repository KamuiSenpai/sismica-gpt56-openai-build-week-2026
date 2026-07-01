export type WavefrontInput = {
  originTimeMs: number;
  nowMs: number;
  velocityMps: number;
  depthM: number;
  maxRadiusM: number;
};

export function surfaceWaveRadius({
  originTimeMs,
  nowMs,
  velocityMps,
  depthM,
  maxRadiusM
}: WavefrontInput): number {
  if (
    ![originTimeMs, nowMs, velocityMps, depthM, maxRadiusM].every(Number.isFinite) ||
    velocityMps <= 0 ||
    depthM < 0 ||
    maxRadiusM <= 0
  ) {
    return 0;
  }
  const elapsedSeconds = Math.max(0, (nowMs - originTimeMs) / 1000);
  const sphericalRadius = velocityMps * elapsedSeconds;
  if (sphericalRadius <= depthM) return 0;
  return Math.min(maxRadiusM, Math.sqrt(sphericalRadius ** 2 - depthM ** 2));
}

export function wavefrontExpiresAt(
  originTimeMs: number,
  velocityMps: number,
  depthM: number,
  maxRadiusM: number
): number {
  return originTimeMs + (Math.sqrt(maxRadiusM ** 2 + depthM ** 2) / velocityMps) * 1000;
}
