export type EditorialUrgency = "baja" | "media" | "alta";
export type EditorialRhythm = "sereno" | "fluido" | "agil";
export type EditorialTone = "sobrio" | "directo" | "calido";

export type EditorialCue = {
  urgency: EditorialUrgency;
  rhythm: EditorialRhythm;
  tone: EditorialTone;
};

export type NarrationMode = "breaking" | "seguimiento";
export type DirectorSegmentKind = "recorrido" | "resumen" | "educativo" | "boletin";

export type NarrationEditorial = {
  intro: string;
  closing: string | null;
  tectonicContext: string | null;
  formats: {
    overlay: string;
    narration: string;
    ticker: string;
  };
  cue: EditorialCue;
};

export type SegmentPacket = {
  text: string;
  cue: EditorialCue;
};

export type CueContextKind = "evento" | DirectorSegmentKind | "relevo" | "en-vivo";
export type VoiceDelivery = {
  rate: number;
  playbackRate: number;
  minDurationMs: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function fallbackNarrationEditorial(mode: NarrationMode): NarrationEditorial {
  if (mode === "breaking") {
    return {
      intro: "Nuevo sismo detectado",
      closing: "Seguimos monitoreando la zona",
      tectonicContext: null,
      formats: {
        overlay: "Nuevo sismo detectado",
        narration: "",
        ticker: "Nuevo sismo detectado"
      },
      cue: { urgency: "alta", rhythm: "agil", tone: "directo" }
    };
  }
  return {
    intro: "Sismo detectado",
    closing: null,
    tectonicContext: null,
    formats: {
      overlay: "Sismo detectado",
      narration: "",
      ticker: "Sismo detectado"
    },
    cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
  };
}

export function fallbackSegmentCue(
  kind: DirectorSegmentKind,
  options: {
    windowMinutes?: 15 | 30 | 60;
    biggestMagnitude?: number | null;
    currentCount?: number | null;
  } = {}
): EditorialCue {
  if (kind === "boletin") {
    if ((options.biggestMagnitude ?? 0) >= 6 || (options.currentCount ?? 0) >= 10) {
      return { urgency: "alta", rhythm: "agil", tone: "directo" };
    }
    if (options.windowMinutes === 60) {
      return { urgency: "baja", rhythm: "sereno", tone: "sobrio" };
    }
    if (options.windowMinutes === 30) {
      return { urgency: "media", rhythm: "fluido", tone: "directo" };
    }
    return { urgency: "media", rhythm: "agil", tone: "directo" };
  }
  if (kind === "resumen") {
    return { urgency: "media", rhythm: "fluido", tone: "directo" };
  }
  if (kind === "educativo") {
    return { urgency: "baja", rhythm: "sereno", tone: "sobrio" };
  }
  return { urgency: "media", rhythm: "fluido", tone: "sobrio" };
}

export function cueToVoiceDelivery(
  cue: EditorialCue,
  context: { text: string; kind: CueContextKind }
): VoiceDelivery {
  const rhythmRateMap: Record<EditorialRhythm, number> = {
    sereno: 0.97,
    fluido: 1.03,
    agil: 1.09
  };
  const urgencyDelta: Record<EditorialUrgency, number> = {
    baja: -0.02,
    media: 0,
    alta: 0.03
  };
  const toneDelta: Record<EditorialTone, number> = {
    sobrio: -0.01,
    directo: 0.01,
    calido: 0
  };
  const rawRate = rhythmRateMap[cue.rhythm] + urgencyDelta[cue.urgency] + toneDelta[cue.tone];
  const rate = clamp(Number(rawRate.toFixed(2)), 0.92, 1.14);
  const words = Math.max(1, context.text.trim().split(/\s+/u).length);
  const isEventLike = context.kind === "evento" || context.kind === "en-vivo";
  const baseFloor = isEventLike ? 6_000 : 7_200;
  const basePadding = isEventLike ? 2_300 : 2_900;
  const spokenEstimate = Math.round((words * 460) / rate + basePadding);
  const urgencyBonus = cue.urgency === "alta" ? -600 : cue.urgency === "baja" ? 500 : 0;
  const minDurationMs = clamp(spokenEstimate + urgencyBonus, baseFloor, 14_000);
  return { rate, playbackRate: rate, minDurationMs };
}
