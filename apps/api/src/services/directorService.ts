import { z } from "zod";

export const directorStateSchema = z.object({
  livePending: z.number().int().nonnegative(),
  recentCount: z.number().int().nonnegative(),
  minutesSinceRecap: z.number().nonnegative(),
  minutesSinceEducativo: z.number().nonnegative(),
  biggestRecentMagnitude: z.number().finite().nullish()
});
export type DirectorState = z.infer<typeof directorStateSchema>;

export type SegmentKind = "recorrido" | "resumen" | "educativo";
export type DirectorDecision = { kind: SegmentKind; source: "ai" | "rules" };

const RECAP_DUE_MIN = 60;
const EDUCATION_DUE_MIN = 15;

function rulesDecision(state: DirectorState): SegmentKind {
  if (state.minutesSinceRecap >= RECAP_DUE_MIN && state.recentCount > 0) return "resumen";
  if (state.recentCount === 0) return "educativo";
  return state.minutesSinceEducativo >= EDUCATION_DUE_MIN ? "educativo" : "recorrido";
}

// El director IA se simplifica a una agenda determinista para evitar latencia editorial
// y pausas innecesarias en el directo. El contrato se conserva para no romper el frontend.
export async function decideNext(state: DirectorState): Promise<DirectorDecision> {
  return { kind: rulesDecision(state), source: "rules" };
}
