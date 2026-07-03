import assert from "node:assert/strict";
import test from "node:test";

import {
  AMBIENT_MODE_FLOOR,
  clamp01,
  computeAmbientIntensity,
  computeAmbientTargets,
  type AmbientDrivers,
  type AmbientMode
} from "../src/lib/ambientBed";

function drivers(overrides: Partial<AmbientDrivers> = {}): AmbientDrivers {
  return { biggestMagnitude: null, recentCount: 0, mode: "monitoreo", ...overrides };
}

test("clamp01 mantiene el rango 0..1", () => {
  assert.equal(clamp01(-0.5), 0);
  assert.equal(clamp01(0.42), 0.42);
  assert.equal(clamp01(3), 1);
});

test("intensidad minima: monitoreo tranquilo sin sismos ni magnitud", () => {
  assert.equal(computeAmbientIntensity(drivers()), 0);
});

test("la intensidad crece de forma monotona con la magnitud", () => {
  const m3 = computeAmbientIntensity(drivers({ biggestMagnitude: 3 }));
  const m5 = computeAmbientIntensity(drivers({ biggestMagnitude: 5 }));
  const m7 = computeAmbientIntensity(drivers({ biggestMagnitude: 7 }));
  assert.ok(m3 < m5, `${m3} < ${m5}`);
  assert.ok(m5 < m7, `${m5} < ${m7}`);
  assert.ok(m7 <= 1);
});

test("la densidad de sismos tambien empuja la intensidad", () => {
  const pocos = computeAmbientIntensity(drivers({ recentCount: 3 }));
  const muchos = computeAmbientIntensity(drivers({ recentCount: 30 }));
  assert.ok(muchos > pocos, `${muchos} > ${pocos}`);
});

test("cada modo impone un piso de intensidad aunque no haya actividad", () => {
  const modes: AmbientMode[] = ["monitoreo", "boletin", "relevo", "vivo"];
  for (const mode of modes) {
    assert.ok(
      computeAmbientIntensity(drivers({ mode })) >= AMBIENT_MODE_FLOOR[mode] - 1e-9,
      `piso de ${mode}`
    );
  }
  // En vivo levanta mas piso que monitoreo con los mismos datos.
  assert.ok(
    computeAmbientIntensity(drivers({ mode: "vivo" })) >
      computeAmbientIntensity(drivers({ mode: "monitoreo" }))
  );
});

test("magnitud null no aporta al termino de magnitud", () => {
  const sinMagnitud = computeAmbientIntensity(drivers({ biggestMagnitude: null, recentCount: 15 }));
  const conMagnitudBaja = computeAmbientIntensity(drivers({ biggestMagnitude: 3, recentCount: 15 }));
  // M3 mapea a 0 en el termino de magnitud -> misma intensidad que null.
  assert.equal(sinMagnitud, conMagnitudBaja);
});

test("los targets de audio quedan dentro de rangos seguros", () => {
  for (const mode of ["monitoreo", "vivo"] as AmbientMode[]) {
    for (const magnitude of [null, 3, 5, 7.5]) {
      const targets = computeAmbientTargets(drivers({ mode, biggestMagnitude: magnitude, recentCount: 12 }));
      assert.ok(targets.intensity >= 0 && targets.intensity <= 1);
      assert.ok(targets.masterGain >= 0.05 - 1e-9 && targets.masterGain <= 0.09 + 1e-9);
      assert.ok(targets.filterHz >= 180 - 1e-6 && targets.filterHz <= 950 + 1e-6);
      assert.ok(targets.pulseGain >= 0 && targets.pulseGain <= 0.06 + 1e-9);
      assert.ok(targets.tensionGain >= 0 && targets.tensionGain <= 0.05 + 1e-9);
      assert.ok(targets.detuneCents >= 0 && targets.detuneCents <= 16 + 1e-9);
    }
  }
});

test("en monitoreo tranquilo el lecho es casi mudo y sin tension", () => {
  const targets = computeAmbientTargets(drivers());
  assert.equal(targets.masterGain, 0.05); // volumen base
  assert.equal(targets.filterHz, 180); // filtro cerrado
  assert.equal(targets.tensionGain, 0);
  assert.equal(targets.detuneCents, 0);
});

test("en vivo con sismo fuerte sube volumen, brillo, pulso y tension", () => {
  const calma = computeAmbientTargets(drivers({ mode: "monitoreo", biggestMagnitude: 3 }));
  const breaking = computeAmbientTargets(drivers({ mode: "vivo", biggestMagnitude: 6.8, recentCount: 20 }));
  assert.ok(breaking.masterGain > calma.masterGain);
  assert.ok(breaking.filterHz > calma.filterHz);
  assert.ok(breaking.pulseGain > calma.pulseGain);
  assert.ok(breaking.tensionGain > calma.tensionGain);
  assert.ok(breaking.detuneCents > calma.detuneCents);
});

test("el boletin aporta pulso de redaccion aunque la actividad sea moderada", () => {
  const boletin = computeAmbientTargets(drivers({ mode: "boletin", biggestMagnitude: 4, recentCount: 8 }));
  assert.ok(boletin.pulseGain > 0);
});
