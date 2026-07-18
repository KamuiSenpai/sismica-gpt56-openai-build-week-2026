import { useEffect, useRef, type MutableRefObject } from "react";

import { type SeismicEvent } from "@sismica/shared";

import { fetchSegmentText } from "./api";
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
  prefetchSeismicNarration,
  prefetchText,
  resolveEventNarration,
  setActiveBroadcastHost,
  speakSeismicNarration,
  speakText,
  type VoiceEngine
} from "./seismicVoice";
import { decideDirectorV2Action } from "./directorV2";
import { normalizeSpanishText } from "./spanishText";

export type DirectorMode = "off" | "rules" | "ai" | "v2";
export type BroadcastSegmentKind = DirectorSegmentKind | "en-vivo";
export type BroadcastSegment = {
  kind: BroadcastSegmentKind;
  text: string;
  cue?: EditorialCue;
};

export const HOST_ROTATION_INTERVAL_MS = 5 * 60_000;
export const HOST_ROTATION_POLL_MS = 500;
export const DIRECTOR_EVENT_DWELL_MS = 24_000;
const RECAP_DUE_MIN = 60;
const EDUCATION_DUE_MIN = 15;
const EDUCATION_REPEAT_WINDOW_MS = 60 * 60_000;
const EVENT_REPEAT_WINDOW_MS = 10 * 60_000;
const DIRECTOR_IDLE_RETRY_MS = 15_000;
const BULLETIN_WINDOWS: Array<60 | 30 | 15> = [60, 30, 15];
const DIRECTOR_DEBUG = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);

export function rotateBroadcastHostSilently(): void {
  const currentHost = getActiveBroadcastHost();
  setActiveBroadcastHost(getNextBroadcastHost(currentHost.id).id);
}

export function canRotateBroadcastHost(now: number, dueAt: number, narrationActive: boolean): boolean {
  return now >= dueAt && !narrationActive;
}

const EDUCATIVO_TOPICS: Array<{ topic: string; fallback: string }> = [
  {
    topic: "escala de magnitud logaritmica",
    fallback:
      "La escala de magnitud es logaritmica, cada punto equivale a unas treinta y dos veces mas energia liberada."
  },
  {
    topic: "magnitud frente a intensidad",
    fallback: "La magnitud mide la energia del sismo, la intensidad, cuanto se sintio en cada lugar."
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

function trendPhrase(currentCount: number, previousCount: number, windowMinutes: number): string {
  const delta = currentCount - previousCount;
  if (delta > 0) return `${delta} mas que en los ${windowMinutes} minutos previos`;
  if (delta < 0) return `${Math.abs(delta)} menos que en los ${windowMinutes} minutos previos`;
  return `estable frente a los ${windowMinutes} minutos previos`;
}

// Aperturas rotativas: el boletin no debe sonar identico cada vez (retencion 24/7).
const BULLETIN_OPENERS: Array<(windowMinutes: number) => string> = [
  (w) => `Boletin de ${w} minutos.`,
  (w) => `Resumen de los ultimos ${w} minutos.`,
  (w) => `Panorama sismico de los ultimos ${w} minutos.`,
  (w) => `Actualizacion de ${w} minutos.`
];
let bulletinOpenerIndex = 0;

// Respaldo del boletin cuando DeepSeek no responde. TODO sale del feed real
// (conteos, mayor magnitud, profundidad, zonas): verificable por construccion.
function fallbackBulletinPacket(
  windowMinutes: 15 | 30 | 60,
  currentCount: number,
  previousCount: number,
  biggest: SeismicEvent | null,
  activeAreas: string[]
): SegmentPacket {
  const opener = BULLETIN_OPENERS[bulletinOpenerIndex % BULLETIN_OPENERS.length](windowMinutes);
  bulletinOpenerIndex += 1;

  const parts: string[] = [];
  if (currentCount === 0) {
    parts.push(`${opener} El planeta estuvo en calma: sin sismos registrados en este lapso.`);
  } else {
    const plural = currentCount === 1 ? "sismo" : "sismos";
    parts.push(
      `${opener} ${currentCount} ${plural} registrados, ${trendPhrase(currentCount, previousCount, windowMinutes)}.`
    );
    if (typeof biggest?.magnitude === "number") {
      const depth =
        typeof biggest.depthKm === "number"
          ? `, a ${Math.round(biggest.depthKm)} kilometros de profundidad`
          : "";
      parts.push(
        `El de mayor magnitud, ${biggest.magnitude.toFixed(1)} en ${broadcastPlace(biggest)}${depth}.`
      );
    }
    if (activeAreas.length > 0) {
      parts.push(`Mayor actividad en ${joinAreas(activeAreas)}.`);
    }
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
  paused: boolean;
  voiceEnabled: boolean;
  voiceEngine: VoiceEngine;
  events: SeismicEvent[];
  pendingLiveQueueRef: MutableRefObject<SeismicEvent[]>;
  onFocusEvent: (eventId: string) => void;
  onSegment: (segment: BroadcastSegment) => void;
}): void {
  const { mode, paused } = params;

  const eventsRef = useRef(params.events);
  eventsRef.current = params.events;
  const voiceEnabledRef = useRef(params.voiceEnabled);
  voiceEnabledRef.current = params.voiceEnabled;
  const voiceEngineRef = useRef(params.voiceEngine);
  voiceEngineRef.current = params.voiceEngine;
  const queueRef = params.pendingLiveQueueRef;
  const onFocusRef = useRef(params.onFocusEvent);
  onFocusRef.current = params.onFocusEvent;
  const onSegmentRef = useRef(params.onSegment);
  onSegmentRef.current = params.onSegment;

  const busyRef = useRef(false);
  const airingUntilRef = useRef(0);
  const lastRecapAtRef = useRef(0);
  const lastEducativoAtRef = useRef(0);
  const lastBulletinAtRef = useRef<Record<15 | 30 | 60, number>>({ 15: 0, 30: 0, 60: 0 });
  const recentEducationalTopicsRef = useRef(new Map<string, number>());
  const tourIndexRef = useRef(-1);
  const recentAiredEventsRef = useRef(new Map<string, number>());

  useEffect(() => {
    let rotationDueAt = Date.now() + HOST_ROTATION_INTERVAL_MS;
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      if (!canRotateBroadcastHost(now, rotationDueAt, isSeismicNarrationActive())) return;
      rotateBroadcastHostSilently();
      rotationDueAt = now + HOST_ROTATION_INTERVAL_MS;
    }, HOST_ROTATION_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (mode === "off" || paused) return;
    let cancelled = false;

    const startedAt = Date.now();
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

    const air = (segment: BroadcastSegment, eventId?: string) => {
      if (cancelled) return false;
      if (mode === "v2" && segment.kind !== "en-vivo" && (queueRef.current?.length ?? 0) > 0) {
        traceDirectorEvent("skip-for-live-priority", {
          kind: segment.kind,
          livePending: queueRef.current?.length ?? 0
        });
        return false;
      }
      const text = normalizeSpanishText(segment.text);
      const cue = segmentCue(segment.kind, segment.cue);
      const delivery = cueToVoiceDelivery(cue, { text, kind: segment.kind });
      const payload = { ...segment, text, cue };
      onSegmentRef.current(payload);
      rememberEditorialLine(text);
      airingUntilRef.current = Date.now() + delivery.minDurationMs;
      if (voiceEnabledRef.current) {
        prefetchText(payload.text);
        speakText(payload.text, {
          cue,
          kind: payload.kind,
          eventId,
          continuityMode: mode === "v2" ? "director-v2" : "legacy",
          isHigherPriorityPending:
            mode === "v2" && payload.kind !== "en-vivo"
              ? () => (queueRef.current?.length ?? 0) > 0
              : undefined
        });
      }
      return true;
    };

    const airEvent = async (event: SeismicEvent, kind: BroadcastSegmentKind, intro?: string) => {
      const narrationMode = kind === "en-vivo" ? "breaking" : "seguimiento";
      const narration = await resolveEventNarration(event, {
        intro,
        mode: narrationMode
      });
      if (cancelled) return;
      if (mode === "v2" && kind !== "en-vivo" && (queueRef.current?.length ?? 0) > 0) {
        traceDirectorEvent("skip-event-for-live-priority", {
          kind,
          eventId: event.eventId,
          livePending: queueRef.current?.length ?? 0
        });
        return;
      }
      const text = normalizeSpanishText(narration.text);
      const cue = segmentCue(kind, narration.cue);
      const delivery = cueToVoiceDelivery(cue, { text, kind });
      const payload = { kind, text, cue };
      recentAiredEventsRef.current.set(event.eventId, Date.now());
      traceDirectorEvent("emit-event", {
        kind,
        eventId: event.eventId,
        place: broadcastPlace(event),
        text
      });
      onFocusRef.current(event.eventId);
      onSegmentRef.current(payload);
      rememberEditorialLine(text);
      airingUntilRef.current = Date.now() + Math.max(delivery.minDurationMs, DIRECTOR_EVENT_DWELL_MS);
      if (!voiceEnabledRef.current) return;
      prefetchSeismicNarration(event, true, {
        intro,
        mode: narrationMode,
        resolved: { ...narration, text, cue },
        continuityMode: mode === "v2" ? "director-v2" : "legacy"
      });
      speakSeismicNarration(event, true, {
        force: true,
        intro,
        mode: narrationMode,
        resolved: { ...narration, text, cue },
        continuityMode: mode === "v2" ? "director-v2" : "legacy",
        isHigherPriorityPending: mode === "v2" ? () => (queueRef.current?.length ?? 0) > 0 : undefined
      });
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
      if (air({ kind: "resumen", text: packet.text, cue: packet.cue })) {
        lastRecapAtRef.current = Date.now();
      }
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
      if (air({ kind: "educativo", text: packet.text, cue: packet.cue })) {
        recentEducationalTopicsRef.current.set(topic, now);
        lastEducativoAtRef.current = now;
      }
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
      if (air({ kind: "boletin", text: packet.text, cue: packet.cue })) {
        markBulletinAired(windowMinutes, now);
      }
    };

    const airNext = async () => {
      if (cancelled) return;
      if (mode === "v2") {
        const state = computeState();
        const action = decideDirectorV2Action({
          livePending: state.livePending,
          dueBulletinWindow: dueBulletinWindow(Date.now()),
          recentCount: state.recentCount,
          minutesSinceRecap: state.minutesSinceRecap,
          minutesSinceEducativo: state.minutesSinceEducativo,
          recapDueMin: RECAP_DUE_MIN,
          educationDueMin: EDUCATION_DUE_MIN,
          tourEventAvailable: eventsRef.current.length > 0
        });

        if (action.kind === "en-vivo") {
          const live = queueRef.current?.shift() ?? null;
          if (live) await airEvent(live, "en-vivo", "Nuevo sismo detectado");
          return;
        }
        if (action.kind === "boletin") {
          await airBulletin(action.windowMinutes);
          return;
        }
        if (action.kind === "resumen") {
          await airResumen();
          return;
        }
        if (action.kind === "educativo") {
          await airEducativo();
          return;
        }
        if (action.kind === "recorrido") {
          const event = nextTourEvent();
          if (event) {
            await airEvent(event, "recorrido");
            return;
          }
        }
        airingUntilRef.current = Date.now() + DIRECTOR_IDLE_RETRY_MS;
        return;
      }

      const queue = queueRef.current;
      const live = queue && queue.length > 0 ? queue.shift() : null;
      if (live) {
        await airEvent(live, "en-vivo", "Nuevo sismo detectado");
        return;
      }

      const bulletinWindow = dueBulletinWindow(Date.now());
      if (bulletinWindow) {
        await airBulletin(bulletinWindow);
        return;
      }

      const state = computeState();
      if (state.recentCount === 0 && state.minutesSinceEducativo < EDUCATION_DUE_MIN) {
        airingUntilRef.current = Date.now() + DIRECTOR_IDLE_RETRY_MS;
        return;
      }
      let kind: Exclude<DirectorSegmentKind, "boletin">;
      kind = mode === "ai" ? normalizeAiKind(rulesDecision(state), state) : rulesDecision(state);

      if (kind === "recorrido") {
        const event = nextTourEvent();
        if (event) {
          await airEvent(event, "recorrido");
          return;
        }
        if (state.minutesSinceEducativo >= EDUCATION_DUE_MIN) {
          kind = "educativo";
        } else {
          airingUntilRef.current = Date.now() + DIRECTOR_IDLE_RETRY_MS;
          return;
        }
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
      const followChatterboxTiming = voiceEnabledRef.current && voiceEngineRef.current === "chatterbox";
      if (!followChatterboxTiming && Date.now() < airingUntilRef.current) return;
      busyRef.current = true;
      void airNext().finally(() => {
        busyRef.current = false;
      });
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [mode, paused, queueRef]);
}
