// Director/guionista del directo 24/7. Decide QUE se emite a continuacion (por reglas o con
// DeepSeek) y lo locuta con la voz. Nunca deja aire muerto: si no hay eventos, mete relleno.
import { useEffect, useRef, type MutableRefObject } from "react";

import { type SeismicEvent } from "@sismica/shared";

import { fetchDirectorDecision, fetchSegmentText, type DirectorSegmentKind } from "./api";
import { getEventPlace } from "./presentation";
import { isSeismicNarrationActive, resolveEventNarration, speakText } from "./seismicVoice";

export type DirectorMode = "off" | "rules" | "ai";
export type BroadcastSegment = { kind: DirectorSegmentKind | "en-vivo"; text: string };

const MIN_SEGMENT_MS = 9_000;
const RECAP_DUE_MIN = 30;

// Temas didacticos (rotan) con texto de respaldo si /api/segment falla por red.
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
    topic: "replicas",
    fallback:
      "Tras un gran terremoto es normal que haya replicas durante dias, casi siempre de menor magnitud."
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

function rulesDecision(state: DirectorState): DirectorSegmentKind {
  if (state.minutesSinceRecap >= RECAP_DUE_MIN && state.recentCount > 0) return "resumen";
  if (state.recentCount === 0) return "educativo";
  return state.minutesSinceEducativo >= 3 ? "educativo" : "recorrido";
}

export function useBroadcastDirector(params: {
  mode: DirectorMode;
  voiceEnabled: boolean;
  events: SeismicEvent[];
  pendingLiveQueueRef: MutableRefObject<SeismicEvent[]>;
  onFocusEvent: (eventId: string) => void;
  onSegment: (segment: BroadcastSegment) => void;
}): void {
  const { mode, voiceEnabled } = params;

  const eventsRef = useRef(params.events);
  eventsRef.current = params.events;
  const queueRef = params.pendingLiveQueueRef;
  const onFocusRef = useRef(params.onFocusEvent);
  onFocusRef.current = params.onFocusEvent;
  const onSegmentRef = useRef(params.onSegment);
  onSegmentRef.current = params.onSegment;

  const busyRef = useRef(false);
  const airingUntilRef = useRef(0);
  const lastRecapAtRef = useRef(0);
  const lastEducativoAtRef = useRef(0);
  const eduIndexRef = useRef(0);
  const tourIndexRef = useRef(-1);

  useEffect(() => {
    if (mode === "off") return;
    // Arranca mostrando actividad, no un resumen/educativo: marca ambos como recientes.
    const startedAt = Date.now();
    if (lastRecapAtRef.current === 0) lastRecapAtRef.current = startedAt;
    if (lastEducativoAtRef.current === 0) lastEducativoAtRef.current = startedAt;

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
      const tour = eventsRef.current.slice(0, 15);
      if (tour.length === 0) return null;
      tourIndexRef.current = (tourIndexRef.current + 1) % tour.length;
      return tour[tourIndexRef.current] ?? null;
    };

    const air = (segment: BroadcastSegment) => {
      onSegmentRef.current(segment);
      airingUntilRef.current = Date.now() + MIN_SEGMENT_MS;
      if (voiceEnabled) speakText(segment.text);
    };

    const airEvent = async (event: SeismicEvent, kind: BroadcastSegment["kind"], intro?: string) => {
      const text = await resolveEventNarration(event, intro ? { intro } : {});
      onFocusRef.current(event.eventId);
      air({ kind, text });
    };

    const airResumen = async () => {
      const events = eventsRef.current;
      const hourAgo = Date.now() - 3_600_000;
      const totalLastHour = events.filter(
        (event) => new Date(event.eventTimeUtc).getTime() >= hourAgo
      ).length;
      const biggest = events.reduce<SeismicEvent | null>(
        (best, event) => ((event.magnitude ?? -1) > (best?.magnitude ?? -1) ? event : best),
        null
      );
      const place = biggest ? getEventPlace(biggest.title) : null;
      const base = `En la ultima hora se registraron ${totalLastHour} sismos`;
      const fallback =
        biggest && place
          ? `${base}; el mayor, magnitud ${(biggest.magnitude ?? 0).toFixed(1)} en ${place}.`
          : `${base}.`;
      const text =
        (await fetchSegmentText({
          kind: "resumen",
          totalLastHour,
          biggestMagnitude: biggest?.magnitude ?? null,
          biggestPlace: place
        })) ?? fallback;
      lastRecapAtRef.current = Date.now();
      air({ kind: "resumen", text });
    };

    const airEducativo = async () => {
      const idx = eduIndexRef.current % EDUCATIVO_TOPICS.length;
      eduIndexRef.current = idx + 1;
      const { topic, fallback } = EDUCATIVO_TOPICS[idx];
      const text = (await fetchSegmentText({ kind: "educativo", topic })) ?? fallback;
      lastEducativoAtRef.current = Date.now();
      air({ kind: "educativo", text });
    };

    const airNext = async () => {
      // 1) Sismo EN VIVO (breaking) primero, en ambos modos.
      const queue = queueRef.current;
      const live = queue && queue.length > 0 ? queue.shift() : null;
      if (live) {
        await airEvent(live, "en-vivo", "Nuevo sismo detectado");
        return;
      }

      // 2) Elegir el siguiente segmento: reglas o DeepSeek (modo IA).
      const state = computeState();
      let kind: DirectorSegmentKind;
      if (mode === "ai") {
        const decision = await fetchDirectorDecision(state);
        kind = decision?.kind ?? rulesDecision(state);
      } else {
        kind = rulesDecision(state);
      }

      // 3) Ejecutar (recorrido sin eventos -> educativo).
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
      if (voiceEnabled && isSeismicNarrationActive()) return; // no tapar la voz en curso
      if (Date.now() < airingUntilRef.current) return; // piso de tiempo por segmento
      busyRef.current = true;
      void airNext().finally(() => {
        busyRef.current = false;
      });
    }, 500);

    return () => window.clearInterval(intervalId);
  }, [mode, voiceEnabled, queueRef]);
}
