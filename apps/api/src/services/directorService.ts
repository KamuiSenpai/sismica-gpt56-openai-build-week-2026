import { z } from "zod";

import { env } from "../config/env.js";
import { chat, DeepSeekUnavailableError } from "./deepseekClient.js";

export const directorStateSchema = z.object({
  livePending: z.number().int().nonnegative(),
  recentCount: z.number().int().nonnegative(),
  minutesSinceRecap: z.number().nonnegative(),
  minutesSinceEducativo: z.number().nonnegative(),
  minutesSinceRecommendation: z.number().nonnegative(),
  biggestRecentMagnitude: z.number().finite().nullish()
});
export type DirectorState = z.infer<typeof directorStateSchema>;

export type SegmentKind = "recorrido" | "resumen" | "educativo";
export type DirectorDecision = { kind: SegmentKind; source: "ai" | "rules" };

const ALLOWED: SegmentKind[] = ["recorrido", "resumen", "educativo"];
const RECAP_DUE_MIN = 60;
const EDUCATION_DUE_MIN = 8;

// Reglas de respaldo (equivalen al "modo barato" del lado servidor).
function rulesDecision(state: DirectorState): SegmentKind {
  if (state.minutesSinceRecap >= RECAP_DUE_MIN && state.recentCount > 0) return "resumen";
  if (state.recentCount === 0) return "educativo";
  return state.minutesSinceEducativo >= EDUCATION_DUE_MIN ? "educativo" : "recorrido";
}

const SYSTEM_PROMPT =
  "Eres el director de un canal sismico en directo 24/7. Elige el SIGUIENTE segmento entre: " +
  '"recorrido" (mostrar un sismo reciente), "resumen" (recap del periodo) o "educativo" (dato ' +
  "didactico). Evita repetir. No satures con contexto: si hubo uno hace pocos minutos, prioriza " +
  "recorrido. Si hace mas de 60 minutos del ultimo resumen y hubo actividad, prioriza resumen. " +
  'Responde SOLO un objeto JSON: {"kind":"recorrido|resumen|educativo"}.';

// Modo inteligente: DeepSeek decide el siguiente segmento; ante cualquier fallo, reglas.
export async function decideNext(state: DirectorState): Promise<DirectorDecision> {
  if (!env.deepseekEnabled || !env.deepseekApiKey) {
    return { kind: rulesDecision(state), source: "rules" };
  }
  try {
    const raw = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Estado actual: ${JSON.stringify(state)}` }
      ],
      { maxTokens: 30, temperature: 0.6 }
    );
    const match = raw.match(/"kind"\s*:\s*"(recorrido|resumen|educativo)"/u);
    const kind = match?.[1] as SegmentKind | undefined;
    if (kind && ALLOWED.includes(kind)) return { kind, source: "ai" };
    return { kind: rulesDecision(state), source: "rules" };
  } catch (error) {
    if (!(error instanceof DeepSeekUnavailableError)) {
      console.warn("Fallo la decision del director; se usan reglas.", error);
    }
    return { kind: rulesDecision(state), source: "rules" };
  }
}
