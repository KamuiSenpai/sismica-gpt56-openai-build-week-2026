import { type SeismicEvent } from "@sismica/shared";

// Direccion de camara cinematografica para el globo (Cesium).
// Traduce un evento sismico en un plano: encuadre por magnitud, trato especial
// para eventos marinos y reglas de salida/entrada entre focos para que los
// saltos de recorrido no arrastren la camara.

export type CameraShotInput = Pick<
  SeismicEvent,
  "magnitude" | "depthKm" | "mmi" | "cdi" | "tsunami" | "title" | "latitude" | "longitude"
>;

export type CameraShot = {
  range: number;
  pitchDeg: number;
  headingDeg: number;
  duration: number;
  dwellMs: number;
  orbitDeg: number;
  marine: boolean;
};

export type CameraTransitionPlan = {
  exitRange: number;
  retreatRange: number;
  overviewRange: number;
  overviewPitchDeg: number;
  exitDuration: number;
  approachDuration: number;
};

function interp(x: number, pts: readonly (readonly [number, number])[]): number {
  if (x <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return last[1];
}

const MARINE_PATTERN =
  /offshore|off the coast|\bsea\b|ocean|ridge|\brise\b|\bmar de\b|frente a la costa|\bmarino\b|oceanic|gulf of|golfo|estrecho|trench|dorsal/i;

export function isMarineEvent(event: Pick<SeismicEvent, "title" | "tsunami">): boolean {
  if (event.tsunami) return true;
  return MARINE_PATTERN.test(event.title ?? "");
}

export function computeNarrationRetreatRange(shot: Pick<CameraShot, "range" | "marine">): number {
  const extraRange = shot.marine
    ? Math.max(700_000, Math.min(2_400_000, shot.range * 1.2))
    : Math.max(950_000, Math.min(3_000_000, shot.range * 1.85));
  return Math.round(shot.range + extraRange);
}

export function computeInterEventTransitionPlan(
  surfaceDistanceM: number,
  toShot: Pick<CameraShot, "range" | "marine">,
  fromShot?: Pick<CameraShot, "range" | "marine"> | null
): CameraTransitionPlan {
  const normalizedDistance = Number.isFinite(surfaceDistanceM) ? Math.max(0, surfaceDistanceM) : 0;
  const retreatRange = computeNarrationRetreatRange(toShot);
  const baseShotRange = Math.max(fromShot?.range ?? 0, toShot.range);
  const exitBase = fromShot ?? toShot;
  const exitExtraRange = exitBase.marine
    ? Math.max(1_200_000, Math.min(3_600_000, exitBase.range * 2.15))
    : Math.max(1_600_000, Math.min(4_400_000, exitBase.range * 2.55));
  const exitRange = Math.round(exitBase.range + exitExtraRange);
  const overviewRange = Math.round(
    Math.max(
      exitRange + 900_000,
      Math.min(13_000_000, Math.max(6_000_000, baseShotRange * 4.8 + normalizedDistance * 0.28))
    )
  );
  const overviewPitchDeg = fromShot?.marine || toShot.marine ? -80 : -78;
  const distanceFactor = Math.min(1, normalizedDistance / 10_000_000);
  const exitDuration = Number((1.9 + distanceFactor * 0.7).toFixed(2));
  const approachDuration = Number((3.3 + distanceFactor * 1.4).toFixed(2));

  return {
    exitRange,
    retreatRange,
    overviewRange,
    overviewPitchDeg,
    exitDuration,
    approachDuration
  };
}

export function computeCameraShot(event: CameraShotInput): CameraShot {
  const mag = typeof event.magnitude === "number" ? event.magnitude : 3.5;
  const depth = typeof event.depthKm === "number" ? event.depthKm : 10;
  const intensity = Math.max(event.mmi ?? 0, event.cdi ?? 0);

  let range = interp(mag, [
    [2, 520_000],
    [4.5, 780_000],
    [6, 1_200_000],
    [7, 1_650_000],
    [8, 2_100_000],
    [9, 2_600_000]
  ]);
  const duration = interp(mag, [
    [2, 3.0],
    [6, 3.6],
    [9, 4.4]
  ]);
  let dwellMs = interp(mag, [
    [2, 5000],
    [6, 7000],
    [8, 9000],
    [9, 10000]
  ]);

  if (depth > 300) range *= 1.15;
  else if (depth > 70) range *= 1.06;

  if (intensity >= 4) dwellMs += 2500;

  const marine = isMarineEvent(event);
  if (marine) {
    range *= 1.35;
  }
  if (event.tsunami) dwellMs += 2500;

  const pitchDeg = -85;
  const headingDeg = 0;
  const orbitDeg = 0;

  return {
    range: Math.round(range),
    pitchDeg: Number(pitchDeg.toFixed(1)),
    headingDeg,
    duration: Number(duration.toFixed(2)),
    dwellMs: Math.round(dwellMs),
    orbitDeg,
    marine
  };
}
