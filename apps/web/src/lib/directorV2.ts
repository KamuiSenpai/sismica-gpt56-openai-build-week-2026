import { type DirectorSegmentKind } from "./editorial";

export const DIRECTOR_V2_POLICY = Object.freeze({
  shortSilenceMs: 1_500,
  trialGuideDurationMinMs: 5_000,
  trialGuideDurationMaxMs: 10_000,
  interGuideGapMs: 650,
  handoffGapMs: 300,
  // Chatterbox puede tardar ~35-45 s en generar una locucion serial. Las pautas
  // pregrabadas deben encadenarse mientras neuralReady siga pendiente, sin un
  // tope fijo de cantidad que deje aire muerto si la generacion tarda mas.
  secondGuideEarliestMs: 6_000,
  maxRoutineGuides: Number.POSITIVE_INFINITY,
  maxBreakingGuides: Number.POSITIVE_INFINITY
});

export type DirectorV2GuidePriority = "routine" | "breaking";
export type DirectorV2GuideClassId =
  | "station_identity"
  | "data_transparency"
  | "continuity_transition"
  | "data_literacy"
  | "education_brief"
  | "verified_tectonics"
  | "promotional_channel";
export type DirectorV2PlaybackRole = "guide" | "transition";

export const DIRECTOR_V2_OFFICIAL_GUIDE_CLASS_CYCLE = Object.freeze([
  "station_identity",
  "data_transparency",
  "data_literacy",
  "data_transparency",
  "station_identity",
  "education_brief",
  "verified_tectonics",
  "data_literacy",
  "station_identity",
  "data_transparency",
  "promotional_channel"
] satisfies readonly DirectorV2GuideClassId[]);

export type DirectorV2EditorialInput = {
  livePending: number;
  dueBulletinWindow: 15 | 30 | 60 | null;
  recentCount: number;
  minutesSinceRecap: number;
  minutesSinceEducativo: number;
  recapDueMin: number;
  educationDueMin: number;
  tourEventAvailable: boolean;
};

export type DirectorV2EditorialAction =
  | { kind: "en-vivo" }
  | { kind: "boletin"; windowMinutes: 15 | 30 | 60 }
  | { kind: Exclude<DirectorSegmentKind, "boletin"> }
  | { kind: "idle" };

export type DirectorV2GuidePlan = {
  startDelayMs: number;
  maxGuides: number;
  secondGuideEarliestMs: number;
  interGuideGapMs: number;
  handoffGapMs: number;
};

export type DirectorV2GuideGateInput = {
  elapsedMs: number;
  playedGuideCount: number;
  neuralReady: boolean;
  higherPriorityPending: boolean;
  priority: DirectorV2GuidePriority;
};

export type DirectorV2GuideClipEligibilityInput = {
  durationMs: number | null;
  classId?: string | null;
  playbackRole?: string | null;
};

export type DirectorV2GuideClassSelectionInput = {
  cursor: number;
  priority: DirectorV2GuidePriority;
  higherPriorityPending: boolean;
  playedGuideCount: number;
  promotionalGuideCount: number;
};

export type DirectorV2GuideClassSelection = {
  classId: DirectorV2GuideClassId;
  nextCursor: number;
};

const BREAKING_GUIDE_CLASS_IDS = new Set<DirectorV2GuideClassId>(["station_identity", "data_transparency"]);

const OFFICIAL_GUIDE_CLASS_IDS = new Set<DirectorV2GuideClassId>([
  "station_identity",
  "data_transparency",
  "data_literacy",
  "education_brief",
  "verified_tectonics",
  "promotional_channel"
]);

export function decideDirectorV2Action(input: DirectorV2EditorialInput): DirectorV2EditorialAction {
  if (input.livePending > 0) return { kind: "en-vivo" };
  if (input.dueBulletinWindow !== null) {
    return { kind: "boletin", windowMinutes: input.dueBulletinWindow };
  }
  if (input.minutesSinceRecap >= input.recapDueMin && input.recentCount > 0) {
    return { kind: "resumen" };
  }
  if (input.recentCount === 0) {
    return input.minutesSinceEducativo >= input.educationDueMin ? { kind: "educativo" } : { kind: "idle" };
  }
  if (input.minutesSinceEducativo >= input.educationDueMin) {
    return { kind: "educativo" };
  }
  return input.tourEventAvailable ? { kind: "recorrido" } : { kind: "idle" };
}

export function buildDirectorV2GuidePlan(priority: DirectorV2GuidePriority): DirectorV2GuidePlan {
  return {
    startDelayMs: DIRECTOR_V2_POLICY.shortSilenceMs,
    maxGuides:
      priority === "breaking" ? DIRECTOR_V2_POLICY.maxBreakingGuides : DIRECTOR_V2_POLICY.maxRoutineGuides,
    secondGuideEarliestMs: DIRECTOR_V2_POLICY.secondGuideEarliestMs,
    interGuideGapMs: DIRECTOR_V2_POLICY.interGuideGapMs,
    handoffGapMs: DIRECTOR_V2_POLICY.handoffGapMs
  };
}

export function isDirectorV2GuideDurationEligible(durationMs: number | null): boolean {
  return (
    durationMs !== null &&
    Number.isFinite(durationMs) &&
    durationMs >= DIRECTOR_V2_POLICY.trialGuideDurationMinMs &&
    durationMs <= DIRECTOR_V2_POLICY.trialGuideDurationMaxMs
  );
}

export function isDirectorV2GuideMetadataEligible(
  classId?: string | null,
  playbackRole?: string | null
): boolean {
  if (classId === undefined && playbackRole === undefined) return true;
  if (typeof classId !== "string") return false;
  if (classId === "continuity_transition") {
    return false;
  }
  if (playbackRole !== "guide") return false;
  return OFFICIAL_GUIDE_CLASS_IDS.has(classId as DirectorV2GuideClassId);
}

export function isDirectorV2TransitionClipEligible(input: DirectorV2GuideClipEligibilityInput): boolean {
  return (
    input.durationMs !== null &&
    Number.isFinite(input.durationMs) &&
    input.durationMs > 0 &&
    input.classId === "continuity_transition" &&
    input.playbackRole === "transition"
  );
}

export function isDirectorV2GuideClipEligible(input: DirectorV2GuideClipEligibilityInput): boolean {
  const { durationMs, classId, playbackRole } = input;
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) return false;
  if (classId != null || playbackRole != null) {
    return isDirectorV2GuideMetadataEligible(classId, playbackRole);
  }
  return isDirectorV2GuideDurationEligible(durationMs);
}

export function selectDirectorV2GuideClass(
  input: DirectorV2GuideClassSelectionInput
): DirectorV2GuideClassSelection {
  const cycle = DIRECTOR_V2_OFFICIAL_GUIDE_CLASS_CYCLE;
  let cursor = Math.max(0, Math.trunc(input.cursor));

  for (let attempt = 0; attempt < cycle.length; attempt += 1) {
    const classId = cycle[cursor % cycle.length] ?? "station_identity";
    cursor += 1;
    if (input.priority === "breaking" && !BREAKING_GUIDE_CLASS_IDS.has(classId)) {
      continue;
    }
    if (classId !== "promotional_channel") {
      return { classId, nextCursor: cursor };
    }

    const nextGuideCount = input.playedGuideCount + 1;
    const nextPromotionalCount = input.promotionalGuideCount + 1;
    const promotionAllowed =
      input.priority === "routine" &&
      !input.higherPriorityPending &&
      nextPromotionalCount * 10 <= nextGuideCount;
    if (promotionAllowed) return { classId, nextCursor: cursor };
  }

  return { classId: "station_identity", nextCursor: cursor };
}

export function shouldStartDirectorV2Guide(input: DirectorV2GuideGateInput): boolean {
  const plan = buildDirectorV2GuidePlan(input.priority);
  if (input.neuralReady) return false;
  if (input.higherPriorityPending && input.priority !== "breaking") return false;
  if (input.playedGuideCount >= plan.maxGuides) return false;
  if (input.playedGuideCount === 0) return input.elapsedMs >= plan.startDelayMs;
  return input.elapsedMs >= plan.secondGuideEarliestMs;
}
