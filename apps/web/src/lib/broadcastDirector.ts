import { useEffect, useRef, type MutableRefObject } from "react";

import { type SeismicEvent } from "@sismica/shared";

import { fetchDirectorDecision, fetchHandoffSegment, fetchSegmentText } from "./api";
import { getRecentEditorialLines, rememberEditorialLine } from "./editorialHistory";
import { broadcastPlace } from "./broadcastPlace";
import {
  cueToVoiceDelivery,
  fallbackSegmentCue,
  type DirectorSegmentKind,
  type EditorialCue,
  type SegmentPacket
} from "./editorial";
import {
  getActiveBroadcastHost,
  getNextBroadcastHost,
  isSeismicNarrationActive,
  prefetchDialogue,
  prefetchText,
  resolveEventNarration,
  setActiveBroadcastHost,
  speakDialogue,
  speakText,
  type BroadcastDialogueTurn
} from "./seismicVoice";
import { normalizeSpanishText } from "./spanishText";

export type DirectorMode = "off" | "rules" | "ai";
export type BroadcastSegmentKind = DirectorSegmentKind | "en-vivo" | "relevo";
export type BroadcastSegment = {
  kind: BroadcastSegmentKind;
  text: string;
  cue?: EditorialCue;
};

const HANDOFF_DUE_MIN = 10;
const RECAP_DUE_MIN = 60;
const EDUCATION_DUE_MIN = 8;
const EDUCATION_REPEAT_WINDOW_MS = 60 * 60_000;
const EVENT_REPEAT_WINDOW_MS = 10 * 60_000;
const BULLETIN_WINDOWS: Array<60 | 30 | 15> = [60, 30, 15];
const HANDOFF_CUE: EditorialCue = { urgency: "media", rhythm: "fluido", tone: "directo" };
const DIRECTOR_DEBUG = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);

const EDUCATIVO_TOPICS: Array<{ topic: string; fallback: string }> = [
  {
    topic: "escala de magnitud logaritmica",
    fallback:
      "La escala de magnitud es logaritmica: cada punto equivale a unas treinta y dos veces mas energia liberada."
  },
  {
    topic: "magnitud frente a intensidad",
    fallback: "La magnitud mide la energia del sismo; la intensidad, cuanto se sintio en cada lugar."
  },
  {
    topic: "zonas de subduccion",
    fallback:
      "La mayoria de los grandes terremotos ocurre donde una placa se hunde bajo otra, en zonas de subduccion."
  },
  {
    topic: "ondas P y S",
    fallback:
      "Un sismo emite ondas P rapidas y ondas S mas lentas; su diferencia de llegada revela la distancia al epicentro."
  },
  {
    topic: "profundidad del sismo",
    fallback:
      "Un sismo superficial suele sentirse mas que uno profundo de igual magnitud, porque la energia viaja menos."
  },
  {
    topic: "tsunamis",
    fallback: "Un sismo submarino grande y superficial puede desplazar el agua y generar un tsunami."
  },
  {
    topic: "cinturon de fuego",
    fallback:
      "El Cinturon de Fuego del Pacifico concentra cerca del ochenta por ciento de los grandes terremotos."
  },
  {
    topic: "por que unos se sienten mas",
    fallback: "Que un sismo se sienta mas depende de su magnitud, profundidad, distancia y del tipo de suelo."
  },
  {
    topic: "como se localiza un epicentro",
    fallback: "El epicentro se obtiene combinando los tiempos de llegada de las ondas a varias estaciones."
  }
];

type DirectorState = {
  livePending: number;
  recentCount: number;
  minutesSinceRecap: number;
  minutesSinceEducativo: number;
  biggestRecentMagnitude: number | null;
};

function rulesDecision(state: DirectorState): Exclude<DirectorSegmentKind, "boletin"> {
  if (state.minutesSinceRecap >= RECAP_DUE_MIN && state.recentCount > 0) return "resumen";
  if (state.recentCount === 0) return "educativo";
  return state.minutesSinceEducativo >= EDUCATION_DUE_MIN ? "educativo" : "recorrido";
}

function pickEducationalTopic(
  topics: Array<{ topic: string; fallback: string }>,
  recentTopics: Map<string, number>,
  now: number
): { topic: string; fallback: string } {
  const eligible = topics.filter(
    (entry) => now - (recentTopics.get(entry.topic) ?? 0) >= EDUCATION_REPEAT_WINDOW_MS
  );
  const pool = eligible.length > 0 ? eligible : topics;
  return pool.reduce((oldest, entry) => {
    const oldestAt = recentTopics.get(oldest.topic) ?? 0;
    const entryAt = recentTopics.get(entry.topic) ?? 0;
    return entryAt < oldestAt ? entry : oldest;
  }, pool[0]);
}

function normalizeAiKind(
  kind: Exclude<DirectorSegmentKind, "boletin">,
  state: DirectorState
): Exclude<DirectorSegmentKind, "boletin"> {
  if (kind === "resumen" && (state.minutesSinceRecap < RECAP_DUE_MIN || state.recentCount === 0)) {
    return rulesDecision(state);
  }
  if (kind === "educativo" && state.minutesSinceEducativo < EDUCATION_DUE_MIN) {
    return state.recentCount === 0 ? "educativo" : "recorrido";
  }
  return kind;
}

// Variantes calidas y respetuosas para cuando el API no responde. Rotan para no sonar identico.
const FALLBACK_HANDOFF_VARIANTS: Array<
  (currentHost: string, nextHost: string) => { currentHostLine: string; nextHostLine: string }
> = [
  (currentHost, nextHost) => ({
    currentHostLine: `${nextHost}, te dejo la posta con toda confianza. Un gusto compartir cabina contigo, cuidalos bien.`,
    nextHostLine: `Gracias, ${currentHost}, siempre un placer. Tomo la posta y seguimos juntos al aire con la cobertura sismica.`
  }),
  (currentHost, nextHost) => ({
    currentHostLine: `${nextHost}, hasta aqui mi turno, quedas en las mejores manos. Nos vemos al rato, un abrazo.`,
    nextHostLine: `Con carino, ${currentHost}. Recibo la posta y sigo acompanando al publico con la cobertura en vivo.`
  }),
  (currentHost, nextHost) => ({
    currentHostLine: `${nextHost}, te paso la posta y me despido de la audiencia. Que tengas un gran turno, colega.`,
    nextHostLine: `Un gusto, ${currentHost}, descansa. Aqui sigo yo, atentos y en calma con la cobertura en vivo.`
  }),
  (currentHost, nextHost) => ({
    currentHostLine: `${nextHost}, cierro mi turno y te dejo la conduccion. Gracias por tanto, seguimos en contacto.`,
    nextHostLine: `Gracias por el relevo, ${currentHost}. Tomo la posta y continuamos con la informacion sismica al aire.`
  })
];
let fallbackHandoffIndex = 0;

function fallbackHandoff(
  currentHost: string,
  nextHost: string
): {
  currentHostLine: string;
  nextHostLine: string;
} {
  const variant = FALLBACK_HANDOFF_VARIANTS[fallbackHandoffIndex % FALLBACK_HANDOFF_VARIANTS.length];
  fallbackHandoffIndex += 1;
  return variant(currentHost, nextHost);
}

export function dialogueDisplayText(turns: BroadcastDialogueTurn[]): string {
  return turns
    .map((turn) => normalizeSpanishText(turn.text.trim()))
    .filter(Boolean)
    .join(" ");
}

function eventTimeMs(event: SeismicEvent): number {
  return new Date(event.eventTimeUtc).getTime();
}

function pickBiggest(events: SeismicEvent[]): SeismicEvent | null {
  return events.reduce<SeismicEvent | null>(
    (best, event) => ((event.magnitude ?? -1) > (best?.magnitude ?? -1) ? event : best),
    null
  );
}

function eventArea(event: SeismicEvent): string {
  const place = broadcastPlace(event);
  const parts = place
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? (parts[parts.length - 1] ?? place) : place;
}

function topAreas(events: SeismicEvent[]): string[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const area = eventArea(event);
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "es"))
    .slice(0, 3)
    .map(([area]) => area);
}

function joinAreas(areas: string[]): string {
  if (areas.length === 0) return "";
  if (areas.length === 1) return areas[0] ?? "";
  if (areas.length === 2) return `${areas[0]} y ${areas[1]}`;
  return `${areas[0]}, ${areas[1]} y ${areas[2]}`;
}

function comparisonText(currentCount: number, previousCount: number, windowMinutes: number): string {
  const delta = currentCount - previousCount;
  if (delta > 0) return `${delta} mas que en los ${windowMinutes} minutos previos`;
  if (delta < 0) return `${Math.abs(delta)} menos que en los ${windowMinutes} minutos previos`;
  return `sin cambio frente a los ${windowMinutes} minutos previos`;
}

function fallbackBulletinPacket(
  windowMinutes: 15 | 30 | 60,
  currentCount: number,
  previousCount: number,
  biggest: SeismicEvent | null,
  activeAreas: string[]
): SegmentPacket {
  const parts = [
    `Boletin de ${windowMinutes} minutos: ${currentCount} sismos detectados, ${comparisonText(currentCount, previousCount, windowMinutes)}.`
  ];
  if (typeof biggest?.magnitude === "number") {
    parts.push(`La mayor magnitud fue ${biggest.magnitude.toFixed(1)} en ${broadcastPlace(biggest)}.`);
  }
  if (activeAreas.length > 0) {
    parts.push(`Actividad concentrada en ${joinAreas(activeAreas)}.`);
  }
  return {
    text: parts.join(" "),
    cue: fallbackSegmentCue("boletin", {
      windowMinutes,
      biggestMagnitude: biggest?.magnitude ?? null,
      currentCount
    })
  };
}

function segmentCue(kind: BroadcastSegmentKind, cue?: EditorialCue): EditorialCue {
  if (cue) return cue;
  if (kind === "relevo") return HANDOFF_CUE;
  if (kind === "en-vivo") return { urgency: "alta", rhythm: "agil", tone: "directo" };
  return fallbackSegmentCue(kind);
}

function traceDirectorEvent(stage: string, payload: Record<string, unknown>): void {
  if (!DIRECTOR_DEBUG) return;
  console.debug(`[director:${stage}]`, payload);
}

function pruneRecentEvents(recentEventIds: Map<string, number>, now: number): void {
  for (const [eventId, announcedAt] of recentEventIds.entries()) {
    if (now - announcedAt >= EVENT_REPEAT_WINDOW_MS) {
      recentEventIds.delete(eventId);
    }
  }
}

export function pickNextTourEvent(
  events: SeismicEvent[],
  currentIndex: number,
  recentEventIds: Map<string, number>,
  now = Date.now()
): { event: SeismicEvent | null; nextIndex: number; skippedEventIds: string[] } {
  const tour = events.slice(0, 15);
  if (tour.length === 0) {
    return { event: null, nextIndex: currentIndex, skippedEventIds: [] };
  }

  pruneRecentEvents(recentEventIds, now);

  const skippedEventIds: string[] = [];
  for (let offset = 1; offset <= tour.length; offset += 1) {
    const index = (currentIndex + offset + tour.length) % tour.length;
    const candidate = tour[index];
    if (!candidate) continue;
    if (recentEventIds.has(candidate.eventId)) {
      skippedEventIds.push(candidate.eventId);
      continue;
    }
    return { event: candidate, nextIndex: index, skippedEventIds };
  }

  return {
    event: null,
    nextIndex: currentIndex < 0 ? 0 : currentIndex % tour.length,
    skippedEventIds
  };
}

export function useBroadcastDirector(params: {
  mode: DirectorMode;
  voiceEnabled: boolean;
  events: SeismicEvent[];
  pendingLiveQueueRef: MutableRefObject<SeismicEvent[]>;
  onFocusEvent: (eventId: string) => void;
  onSegment: (segment: BroadcastSegment) => void;
}): void {
  const { mode } = params;

  const eventsRef = useRef(params.events);
  eventsRef.current = params.events;
  const voiceEnabledRef = useRef(params.voiceEnabled);
  voiceEnabledRef.current = params.voiceEnabled;
  const queueRef = params.pendingLiveQueueRef;
  const onFocusRef = useRef(params.onFocusEvent);
  onFocusRef.current = params.onFocusEvent;
  const onSegmentRef = useRef(params.onSegment);
  onSegmentRef.current = params.onSegment;

  const busyRef = useRef(false);
  const airingUntilRef = useRef(0);
  const lastHandoffAtRef = useRef(0);
  const lastRecapAtRef = useRef(0);
  const lastEducativoAtRef = useRef(0);
  const lastBulletinAtRef = useRef<Record<15 | 30 | 60, number>>({ 15: 0, 30: 0, 60: 0 });
  const recentEducationalTopicsRef = useRef(new Map<string, number>());
  const tourIndexRef = useRef(-1);
  const recentAiredEventsRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (mode === "off") return;

    const startedAt = Date.now();
    if (lastHandoffAtRef.current === 0) lastHandoffAtRef.current = startedAt;
    if (lastRecapAtRef.current === 0) lastRecapAtRef.current = startedAt;
    if (lastEducativoAtRef.current === 0) lastEducativoAtRef.current = startedAt;
    for (const windowMinutes of BULLETIN_WINDOWS) {
      if (lastBulletinAtRef.current[windowMinutes] === 0) {
        lastBulletinAtRef.current[windowMinutes] = startedAt;
      }
    }

    const computeState = (): DirectorState => {
      const events = eventsRef.current;
      const now = Date.now();
      const biggest = events.reduce((max, event) => Math.max(max, event.magnitude ?? 0), 0);
      return {
        livePending: queueRef.current?.length ?? 0,
        recentCount: events.length,
        minutesSinceRecap: (now - lastRecapAtRef.current) / 60_000,
        minutesSinceEducativo: (now - lastEducativoAtRef.current) / 60_000,
        biggestRecentMagnitude: biggest || null
      };
    };

    const nextTourEvent = (): SeismicEvent | null => {
      const next = pickNextTourEvent(
        eventsRef.current,
        tourIndexRef.current,
        recentAiredEventsRef.current,
        Date.now()
      );
      if (next.skippedEventIds.length > 0) {
        traceDirectorEvent("skip-repeat", {
          skippedEventIds: next.skippedEventIds,
          windowMs: EVENT_REPEAT_WINDOW_MS
        });
      }
      if (!next.event) return null;
      tourIndexRef.current = next.nextIndex;
      return next.event;
    };

    const air = (segment: BroadcastSegment) => {
      const text = normalizeSpanishText(segment.text);
      const cue = segmentCue(segment.kind, segment.cue);
      const delivery = cueToVoiceDelivery(cue, { text, kind: segment.kind });
      const payload = { ...segment, text, cue };
      onSegmentRef.current(payload);
      rememberEditorialLine(text);
      airingUntilRef.current = Date.now() + delivery.minDurationMs;
      if (voiceEnabledRef.current) {
        prefetchText(payload.text);
        speakText(payload.text, { cue, kind: payload.kind });
      }
    };

    const airEvent = async (event: SeismicEvent, kind: BroadcastSegmentKind, intro?: string) => {
      const narration = await resolveEventNarration(event, {
        intro,
        mode: kind === "en-vivo" ? "breaking" : "seguimiento"
      });
      recentAiredEventsRef.current.set(event.eventId, Date.now());
      traceDirectorEvent("emit-event", {
        kind,
        eventId: event.eventId,
        place: broadcastPlace(event),
        text: narration.text
      });
      onFocusRef.current(event.eventId);
      air({
        kind,
        text: narration.text,
        cue: narration.cue
      });
    };

    const airHandoff = async () => {
      const currentHost = getActiveBroadcastHost();
      const nextHost = getNextBroadcastHost(currentHost.id);
      const script =
        (await fetchHandoffSegment(currentHost.name, nextHost.name, getRecentEditorialLines())) ??
        fallbackHandoff(currentHost.name, nextHost.name);
      const turns: BroadcastDialogueTurn[] = [
        {
          hostId: currentHost.id,
          speakerName: currentHost.name,
          text: script.currentHostLine
        },
        {
          hostId: nextHost.id,
          speakerName: nextHost.name,
          text: script.nextHostLine
        }
      ];
      const dialogueText = dialogueDisplayText(turns);

      setActiveBroadcastHost(nextHost.id);
      lastHandoffAtRef.current = Date.now();
      onSegmentRef.current({ kind: "relevo", text: dialogueText, cue: HANDOFF_CUE });
      rememberEditorialLine(dialogueText);
      airingUntilRef.current =
        Date.now() + cueToVoiceDelivery(HANDOFF_CUE, { text: dialogueText, kind: "relevo" }).minDurationMs;
      if (voiceEnabledRef.current) {
        prefetchDialogue(turns);
        speakDialogue(turns);
      }
    };

    const airResumen = async () => {
      const events = eventsRef.current;
      const hourAgo = Date.now() - 3_600_000;
      const windowEvents = events.filter((event) => eventTimeMs(event) >= hourAgo);
      const biggest = pickBiggest(windowEvents);
      const fallback: SegmentPacket = {
        text:
          biggest && typeof biggest.magnitude === "number"
            ? `En la ultima hora se registraron ${windowEvents.length} sismos; el mayor, magnitud ${biggest.magnitude.toFixed(1)} en ${broadcastPlace(biggest)}.`
            : `En la ultima hora se registraron ${windowEvents.length} sismos.`,
        cue: fallbackSegmentCue("resumen")
      };
      const packet =
        (await fetchSegmentText({
          kind: "resumen",
          totalLastHour: windowEvents.length,
          biggestMagnitude: biggest?.magnitude ?? null,
          biggestPlace: biggest ? broadcastPlace(biggest) : null,
          recentLines: getRecentEditorialLines()
        })) ?? fallback;
      lastRecapAtRef.current = Date.now();
      air({ kind: "resumen", text: packet.text, cue: packet.cue });
    };

    const airEducativo = async () => {
      const now = Date.now();
      const { topic, fallback } = pickEducationalTopic(
        EDUCATIVO_TOPICS,
        recentEducationalTopicsRef.current,
        now
      );
      const packet = (await fetchSegmentText({
        kind: "educativo",
        topic,
        recentLines: getRecentEditorialLines()
      })) ?? {
        text: fallback,
        cue: fallbackSegmentCue("educativo")
      };
      recentEducationalTopicsRef.current.set(topic, now);
      lastEducativoAtRef.current = now;
      air({ kind: "educativo", text: packet.text, cue: packet.cue });
    };

    const dueBulletinWindow = (now: number): 15 | 30 | 60 | null => {
      for (const windowMinutes of BULLETIN_WINDOWS) {
        const elapsed = (now - lastBulletinAtRef.current[windowMinutes]) / 60_000;
        if (elapsed >= windowMinutes) return windowMinutes;
      }
      return null;
    };

    const markBulletinAired = (windowMinutes: 15 | 30 | 60, now: number) => {
      lastBulletinAtRef.current[windowMinutes] = now;
      if (windowMinutes >= 30) lastBulletinAtRef.current[15] = now;
      if (windowMinutes === 60) {
        lastBulletinAtRef.current[30] = now;
        lastRecapAtRef.current = now;
      }
    };

    const airBulletin = async (windowMinutes: 15 | 30 | 60) => {
      const now = Date.now();
      const currentStart = now - windowMinutes * 60_000;
      const previousStart = now - windowMinutes * 120_000;
      const events = eventsRef.current;
      const currentEvents = events.filter((event) => {
        const time = eventTimeMs(event);
        return time >= currentStart && time <= now;
      });
      const previousEvents = events.filter((event) => {
        const time = eventTimeMs(event);
        return time >= previousStart && time < currentStart;
      });
      const biggest = pickBiggest(currentEvents);
      const activeAreas = topAreas(currentEvents);
      const packet =
        (await fetchSegmentText({
          kind: "boletin",
          windowMinutes,
          currentCount: currentEvents.length,
          previousCount: previousEvents.length,
          biggestMagnitude: biggest?.magnitude ?? null,
          biggestPlace: biggest ? broadcastPlace(biggest) : null,
          activeAreas,
          regionalFocus: activeAreas[0] ?? null,
          recentLines: getRecentEditorialLines()
        })) ??
        fallbackBulletinPacket(
          windowMinutes,
          currentEvents.length,
          previousEvents.length,
          biggest,
          activeAreas
        );
      markBulletinAired(windowMinutes, now);
      air({ kind: "boletin", text: packet.text, cue: packet.cue });
    };

    const airNext = async () => {
      const queue = queueRef.current;
      const live = queue && queue.length > 0 ? queue.shift() : null;
      if (live) {
        await airEvent(live, "en-vivo", "Nuevo sismo detectado");
        return;
      }

      if ((Date.now() - lastHandoffAtRef.current) / 60_000 >= HANDOFF_DUE_MIN) {
        await airHandoff();
        return;
      }

      const bulletinWindow = dueBulletinWindow(Date.now());
      if (bulletinWindow) {
        await airBulletin(bulletinWindow);
        return;
      }

      const state = computeState();
      let kind: Exclude<DirectorSegmentKind, "boletin">;
      if (mode === "ai") {
        const decision = await fetchDirectorDecision(state);
        kind = normalizeAiKind(decision?.kind ?? rulesDecision(state), state);
      } else {
        kind = rulesDecision(state);
      }

      if (kind === "recorrido") {
        const event = nextTourEvent();
        if (event) {
          await airEvent(event, "recorrido");
          return;
        }
        kind = "educativo";
      }

      if (kind === "resumen") {
        await airResumen();
        return;
      }

      await airEducativo();
    };

    const intervalId = window.setInterval(() => {
      if (busyRef.current) return;
      if (voiceEnabledRef.current && isSeismicNarrationActive()) return;
      if (Date.now() < airingUntilRef.current) return;
      busyRef.current = true;
      void airNext().finally(() => {
        busyRef.current = false;
      });
    }, 500);

    return () => window.clearInterval(intervalId);
  }, [mode, queueRef]);
}
