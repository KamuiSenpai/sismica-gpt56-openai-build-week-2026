import assert from "node:assert/strict";
import test from "node:test";

import {
  AMBIENT_MODE_FLOOR,
  clamp01,
  computeAmbientIntensity,
  computeAmbientTargets,
  slewTempo,
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
      assert.ok(targets.padGain >= 0.05 - 1e-9 && targets.padGain <= 0.09 + 1e-9);
      assert.ok(targets.filterHz >= 700 - 1e-6 && targets.filterHz <= 2200 + 1e-6);
      assert.ok(targets.rhythmGain >= 0.45 - 1e-9 && targets.rhythmGain <= 0.85 + 1e-9);
      assert.ok(targets.tempoBpm >= 72 - 1e-9 && targets.tempoBpm <= 96 + 1e-9);
      assert.ok(targets.detuneCents >= 0 && targets.detuneCents <= 14 + 1e-9);
    }
  }
});

test("en monitoreo tranquilo el ritmo se oye pero el pad esta calmo", () => {
  const targets = computeAmbientTargets(drivers());
  assert.equal(targets.padGain, 0.05); // pad base
  assert.equal(targets.filterHz, 700); // ya con medios presentes (audible)
  assert.equal(targets.rhythmGain, 0.45); // el ritmo SIEMPRE suena, no arranca en cero
  assert.equal(targets.tempoBpm, 72); // pulso tranquilo
  assert.equal(targets.detuneCents, 0);
});

test("en vivo con sismo fuerte sube pad, brillo, ritmo y tempo", () => {
  const calma = computeAmbientTargets(drivers({ mode: "monitoreo", biggestMagnitude: 3 }));
  const breaking = computeAmbientTargets(drivers({ mode: "vivo", biggestMagnitude: 6.8, recentCount: 20 }));
  assert.ok(breaking.padGain > calma.padGain);
  assert.ok(breaking.filterHz > calma.filterHz);
  assert.ok(breaking.rhythmGain > calma.rhythmGain);
  assert.ok(breaking.tempoBpm > calma.tempoBpm);
  assert.ok(breaking.detuneCents > calma.detuneCents);
});

test("el boletin sube la energia del ritmo frente al monitoreo tranquilo", () => {
  const monitoreo = computeAmbientTargets(
    drivers({ mode: "monitoreo", biggestMagnitude: 4, recentCount: 8 })
  );
  const boletin = computeAmbientTargets(drivers({ mode: "boletin", biggestMagnitude: 4, recentCount: 8 }));
  assert.ok(boletin.rhythmGain > monitoreo.rhythmGain);
  assert.ok(boletin.rhythmGain >= 0.45);
});

test("slewTempo suaviza subidas bruscas de BPM", () => {
  assert.equal(slewTempo(72, 96, 250), 74);
  assert.equal(slewTempo(72, 96, 3_000), 96);
});

test("slewTempo suaviza bajadas y respeta tiempos no positivos", () => {
  assert.equal(slewTempo(90, 72, 250), 88);
  assert.equal(slewTempo(84, 72, 0), 84);
});
