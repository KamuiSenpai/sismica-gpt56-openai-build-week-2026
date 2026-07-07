import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDirectorV2GuidePlan,
  decideDirectorV2Action,
  DIRECTOR_V2_OFFICIAL_GUIDE_CLASS_CYCLE,
  DIRECTOR_V2_POLICY,
  isDirectorV2GuideClipEligible,
  isDirectorV2GuideDurationEligible,
  isDirectorV2TransitionClipEligible,
  selectDirectorV2GuideClass,
  shouldStartDirectorV2Guide
} from "../src/lib/directorV2";

const baseEditorialInput = {
  livePending: 0,
  dueBulletinWindow: null,
  recentCount: 12,
  minutesSinceRecap: 10,
  minutesSinceEducativo: 5,
  recapDueMin: 60,
  educationDueMin: 15,
  tourEventAvailable: true
} as const;

test("Director V2 da prioridad absoluta al siguiente sismo nuevo", () => {
  assert.deepEqual(
    decideDirectorV2Action({
      ...baseEditorialInput,
      livePending: 2,
      dueBulletinWindow: 60,
      minutesSinceRecap: 90,
      minutesSinceEducativo: 30
    }),
    { kind: "en-vivo" }
  );
});

test("Director V2 ordena boletin, resumen, educativo y recorrido", () => {
  assert.deepEqual(decideDirectorV2Action({ ...baseEditorialInput, dueBulletinWindow: 30 }), {
    kind: "boletin",
    windowMinutes: 30
  });
  assert.deepEqual(decideDirectorV2Action({ ...baseEditorialInput, minutesSinceRecap: 60 }), {
    kind: "resumen"
  });
  assert.deepEqual(decideDirectorV2Action({ ...baseEditorialInput, minutesSinceEducativo: 15 }), {
    kind: "educativo"
  });
  assert.deepEqual(decideDirectorV2Action(baseEditorialInput), { kind: "recorrido" });
});

test("Director V2 queda solo con musica si no hay contenido vencido", () => {
  assert.deepEqual(
    decideDirectorV2Action({
      ...baseEditorialInput,
      recentCount: 0,
      tourEventAvailable: false
    }),
    { kind: "idle" }
  );
});

test("Director V2 conserva la ventana de cinco a diez segundos para catalogos trial", () => {
  assert.equal(isDirectorV2GuideDurationEligible(null), false);
  assert.equal(isDirectorV2GuideDurationEligible(4_999), false);
  assert.equal(isDirectorV2GuideDurationEligible(5_000), true);
  assert.equal(isDirectorV2GuideDurationEligible(10_000), true);
  assert.equal(isDirectorV2GuideDurationEligible(10_001), false);
});

test("Director V2 usa classId y playbackRole para validar catalogos official", () => {
  assert.equal(
    isDirectorV2GuideClipEligible({
      durationMs: 11_200,
      classId: "verified_tectonics",
      playbackRole: "guide"
    }),
    true
  );
  assert.equal(
    isDirectorV2GuideClipEligible({
      durationMs: 4_200,
      classId: "continuity_transition",
      playbackRole: "transition"
    }),
    false
  );
  assert.equal(
    isDirectorV2TransitionClipEligible({
      durationMs: 4_200,
      classId: "continuity_transition",
      playbackRole: "transition"
    }),
    true
  );
  assert.equal(
    isDirectorV2GuideClipEligible({
      durationMs: 4_200,
      classId: "continuity_transition",
      playbackRole: "guide"
    }),
    false
  );
  assert.equal(
    isDirectorV2GuideClipEligible({
      durationMs: 6_300,
      classId: "unknown_group",
      playbackRole: "guide"
    }),
    false
  );
  assert.equal(
    isDirectorV2GuideClipEligible({
      durationMs: 7_000,
      classId: null,
      playbackRole: null
    }),
    true
  );
});

test("Director V2 limita promociones a una de cada diez pautas", () => {
  let cursor = 0;
  let playedGuideCount = 0;
  let promotionalGuideCount = 0;
  const selected: string[] = [];

  for (let index = 0; index < 30; index += 1) {
    const selection = selectDirectorV2GuideClass({
      cursor,
      priority: "routine",
      higherPriorityPending: false,
      playedGuideCount,
      promotionalGuideCount
    });
    cursor = selection.nextCursor;
    playedGuideCount += 1;
    if (selection.classId === "promotional_channel") promotionalGuideCount += 1;
    selected.push(selection.classId);
    assert.ok(promotionalGuideCount * 10 <= playedGuideCount);
  }

  assert.equal(DIRECTOR_V2_OFFICIAL_GUIDE_CLASS_CYCLE.includes("continuity_transition"), false);
  assert.equal(DIRECTOR_V2_OFFICIAL_GUIDE_CLASS_CYCLE.length, 11);
  assert.ok(selected.filter((classId) => classId === "promotional_channel").length <= 3);
});

test("Director V2 excluye promociones de sismos nuevos o pendientes", () => {
  for (const state of [
    { priority: "breaking" as const, higherPriorityPending: false },
    { priority: "routine" as const, higherPriorityPending: true }
  ]) {
    const selection = selectDirectorV2GuideClass({
      cursor: DIRECTOR_V2_OFFICIAL_GUIDE_CLASS_CYCLE.length - 1,
      playedGuideCount: 9,
      promotionalGuideCount: 0,
      ...state
    });
    assert.notEqual(selection.classId, "promotional_channel");
  }
});

test("Director V2 limita las pautas breaking a clases breves", () => {
  const allowedBreakingClasses = new Set(["station_identity", "data_transparency"]);

  for (let cursor = 0; cursor < DIRECTOR_V2_OFFICIAL_GUIDE_CLASS_CYCLE.length; cursor += 1) {
    const selection = selectDirectorV2GuideClass({
      cursor,
      priority: "breaking",
      higherPriorityPending: true,
      playedGuideCount: 0,
      promotionalGuideCount: 0
    });
    assert.equal(allowedBreakingClasses.has(selection.classId), true);
  }
});

test("Director V2 usa musica durante los primeros 1.5 segundos", () => {
  assert.equal(
    shouldStartDirectorV2Guide({
      elapsedMs: DIRECTOR_V2_POLICY.shortSilenceMs - 1,
      playedGuideCount: 0,
      neuralReady: false,
      higherPriorityPending: false,
      priority: "routine"
    }),
    false
  );
  assert.equal(
    shouldStartDirectorV2Guide({
      elapsedMs: DIRECTOR_V2_POLICY.shortSilenceMs,
      playedGuideCount: 0,
      neuralReady: false,
      higherPriorityPending: false,
      priority: "routine"
    }),
    true
  );
});

test("Director V2 no inicia pauta rutinaria si Chatterbox esta listo o hay sismo pendiente", () => {
  for (const state of [
    { neuralReady: true, higherPriorityPending: false },
    { neuralReady: false, higherPriorityPending: true }
  ]) {
    assert.equal(
      shouldStartDirectorV2Guide({
        elapsedMs: 25_000,
        playedGuideCount: 0,
        priority: "routine",
        ...state
      }),
      false
    );
  }
});

test("Director V2 permite encadenar pautas breaking aunque haya backlog de sismos", () => {
  assert.equal(
    shouldStartDirectorV2Guide({
      elapsedMs: DIRECTOR_V2_POLICY.shortSilenceMs,
      playedGuideCount: 0,
      neuralReady: false,
      higherPriorityPending: true,
      priority: "breaking"
    }),
    true
  );
  assert.equal(
    shouldStartDirectorV2Guide({
      elapsedMs: DIRECTOR_V2_POLICY.secondGuideEarliestMs,
      playedGuideCount: 1,
      neuralReady: false,
      higherPriorityPending: true,
      priority: "breaking"
    }),
    true
  );
  assert.equal(
    shouldStartDirectorV2Guide({
      elapsedMs: DIRECTOR_V2_POLICY.secondGuideEarliestMs,
      playedGuideCount: 50,
      neuralReady: false,
      higherPriorityPending: true,
      priority: "breaking"
    }),
    true
  );
});

test("Director V2 encadena la segunda pauta apenas pasa el gate", () => {
  assert.equal(
    shouldStartDirectorV2Guide({
      elapsedMs: DIRECTOR_V2_POLICY.secondGuideEarliestMs - 1,
      playedGuideCount: 1,
      neuralReady: false,
      higherPriorityPending: false,
      priority: "routine"
    }),
    false
  );
  assert.equal(
    shouldStartDirectorV2Guide({
      elapsedMs: DIRECTOR_V2_POLICY.secondGuideEarliestMs,
      playedGuideCount: 1,
      neuralReady: false,
      higherPriorityPending: false,
      priority: "routine"
    }),
    true
  );
  // Breaking tambien encadena pautas breves mientras Chatterbox no esta listo.
  assert.equal(
    shouldStartDirectorV2Guide({
      elapsedMs: DIRECTOR_V2_POLICY.secondGuideEarliestMs,
      playedGuideCount: 1,
      neuralReady: false,
      higherPriorityPending: false,
      priority: "breaking"
    }),
    true
  );
});

test("Director V2 encadena varias pautas rutinarias y conserva el handoff de 300 ms", () => {
  assert.equal(buildDirectorV2GuidePlan("routine").handoffGapMs, 300);
  assert.equal(buildDirectorV2GuidePlan("routine").maxGuides, DIRECTOR_V2_POLICY.maxRoutineGuides);
  assert.equal(buildDirectorV2GuidePlan("breaking").maxGuides, DIRECTOR_V2_POLICY.maxBreakingGuides);
  assert.equal(Number.isFinite(buildDirectorV2GuidePlan("routine").maxGuides), false);
  assert.equal(Number.isFinite(buildDirectorV2GuidePlan("breaking").maxGuides), false);
});
