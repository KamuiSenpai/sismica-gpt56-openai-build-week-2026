import assert from "node:assert/strict";
import test from "node:test";

import {
  computeCameraShot,
  computeInterEventTransitionPlan,
  computeNarrationRetreatRange,
  isMarineEvent,
  type CameraShotInput
} from "../src/lib/cameraDirector";

function ev(overrides: Partial<CameraShotInput> = {}): CameraShotInput {
  return {
    magnitude: 5,
    depthKm: 20,
    mmi: null,
    cdi: null,
    tsunami: false,
    title: "M5.0 - 10 km al este de Santiago, Chile",
    latitude: -33.4,
    longitude: -70.6,
    ...overrides
  };
}

test("mayor magnitud => encuadre mas amplio y vuelo mas solemne", () => {
  const chico = computeCameraShot(ev({ magnitude: 3 }));
  const grande = computeCameraShot(ev({ magnitude: 7.2 }));
  assert.ok(grande.range > chico.range);
  assert.ok(grande.duration > chico.duration);
});

test("evento marino: no sobre-acerca y conserva estilo cenital", () => {
  const tierra = computeCameraShot(ev({ magnitude: 5, title: "M5.0 - 10 km al este de Santiago" }));
  const mar = computeCameraShot(ev({ magnitude: 5, title: "M5.0 - Offshore Valparaiso, Chile" }));
  assert.equal(mar.marine, true);
  assert.equal(tierra.marine, false);
  assert.ok(mar.range > tierra.range);
  assert.equal(mar.pitchDeg, tierra.pitchDeg);
});

test("foco profundo aleja mas que uno superficial de igual magnitud", () => {
  const somero = computeCameraShot(ev({ magnitude: 5, depthKm: 15 }));
  const profundo = computeCameraShot(ev({ magnitude: 5, depthKm: 450 }));
  assert.ok(profundo.range > somero.range);
});

test("si se sintio, la camara permanece mas", () => {
  const base = computeCameraShot(ev({ magnitude: 5, mmi: null }));
  const sentido = computeCameraShot(ev({ magnitude: 5, mmi: 6 }));
  assert.ok(sentido.dwellMs > base.dwellMs);
});

test("tsunami: marino garantizado y permanencia larga", () => {
  const t = computeCameraShot(ev({ magnitude: 6.8, tsunami: true }));
  assert.equal(t.marine, true);
  assert.ok(t.dwellMs > computeCameraShot(ev({ magnitude: 6.8, tsunami: false })).dwellMs);
});

test("magnitud nula no rompe y da un plano regional razonable", () => {
  const shot = computeCameraShot(ev({ magnitude: null }));
  assert.ok(Number.isFinite(shot.range) && shot.range > 400_000 && shot.range < 2_000_000);
  assert.ok(shot.pitchDeg < 0 && shot.pitchDeg > -90);
});

test("a mitad de la locucion la camara abre mucho mas el plano", () => {
  const shot = computeCameraShot(ev({ magnitude: 6.4 }));
  const retreatRange = computeNarrationRetreatRange(shot);
  assert.ok(retreatRange > shot.range);
  assert.ok(retreatRange - shot.range >= 950_000);
  assert.ok(retreatRange - shot.range <= 3_000_000);
});

test("el alejamiento de mitad de locucion sigue siendo mas conservador en mar", () => {
  const landShot = computeCameraShot(ev({ magnitude: 5.8, title: "M5.8 - 14 km al sur de Arequipa" }));
  const marineShot = computeCameraShot(ev({ magnitude: 5.8, title: "M5.8 - Offshore Arequipa, Peru" }));
  const landExtra = computeNarrationRetreatRange(landShot) - landShot.range;
  const marineExtra = computeNarrationRetreatRange(marineShot) - marineShot.range;
  assert.ok(marineExtra < landExtra);
});

test("la transicion entre sismos sube primero a un plano continental limpio", () => {
  const fromShot = computeCameraShot(ev({ magnitude: 5.1, title: "M5.1 - 18 km al oeste de Lima, Peru" }));
  const toShot = computeCameraShot(ev({ magnitude: 6.3, title: "M6.3 - Norte de Chile" }));
  const plan = computeInterEventTransitionPlan(2_500_000, toShot, fromShot);

  assert.ok(plan.exitRange > fromShot.range);
  assert.ok(plan.retreatRange > toShot.range);
  assert.ok(plan.overviewRange > plan.exitRange);
  assert.ok(plan.overviewRange >= 6_000_000);
  assert.ok(plan.overviewPitchDeg > -85);
  assert.ok(plan.exitDuration >= 1.9);
  assert.ok(plan.approachDuration >= 3.3);
});

test("isMarineEvent detecta offshore/mar y no marca tierra", () => {
  assert.equal(isMarineEvent({ title: "M4 - Offshore Coquimbo", tsunami: false }), true);
  assert.equal(isMarineEvent({ title: "M4 - Mar de Molucas, Indonesia", tsunami: false }), true);
  assert.equal(isMarineEvent({ title: "M4 - 12 km al norte de Mendoza", tsunami: false }), false);
});
