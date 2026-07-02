import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  DEFAULT_HOURS,
  DEFAULT_MIN_MAGNITUDE,
  clampNumber,
  type SeismicEvent,
  type SeismicStation,
  type StationState
} from "@sismica/shared";

import { EventList } from "./components/EventList";
import { MapPanel } from "./components/MapPanel";
import { SourceStatusCard } from "./components/SourceStatusCard";
import { useEventStream } from "./hooks/useEventStream";
import { useStationStream } from "./hooks/useStationStream";
import {
  eventsQueryKey,
  mergeIncomingEvent,
  useDisastersQuery,
  useEventsQuery,
  useSeismicPresenceQuery,
  useSourceStatusesQuery,
  useStationsQuery,
  useTopMagnitudeQuery,
  useTsunamiQuery
} from "./hooks/queries";
import {
  formatCoordinate,
  formatDepth,
  formatMagnitude,
  formatMetric,
  formatUtcClock,
  formatUtcDateTime,
  getEventStatusBadge,
  MAGNITUDE_BANDS,
  magnitudeCssColor,
  normalizedIntensity,
  normalizedPlace
} from "./lib/presentation";
import { resolveCountryCode, useCountryGeocoder } from "./lib/countryGeocoder";
import { setSeismicAudioEnabled } from "./lib/seismicAudio";
import {
  getVoiceEngine,
  isEngineAvailable,
  isSeismicNarrationActive,
  isSeismicVoiceSupported,
  prefetchSeismicNarration,
  primeSeismicVoices,
  refreshTtsHealth,
  setSeismicVoiceEnabled,
  setVoiceEngine,
  speakSeismicNarration,
  speakText,
  VOICE_ENGINE_LABELS,
  VOICE_ENGINES,
  type VoiceEngine
} from "./lib/seismicVoice";
import { CountryFlag } from "./components/CountryFlag";
import { Marquee } from "./components/Marquee";
import { useBroadcastDirector, type BroadcastSegment, type DirectorMode } from "./lib/broadcastDirector";

const DIRECTOR_MODES: DirectorMode[] = ["off", "rules", "ai"];
const DIRECTOR_MODE_LABELS: Record<DirectorMode, string> = {
  off: "Recorrido",
  rules: "Director reglas",
  ai: "Director IA"
};
const SEGMENT_LABELS: Record<BroadcastSegment["kind"], string> = {
  "en-vivo": "EN VIVO",
  recorrido: "RECORRIDO",
  boletin: "BOLETIN",
  resumen: "RESUMEN",
  educativo: "CONTEXTO",
  relevo: "CABINA"
};
const SEGMENT_TITLES: Record<BroadcastSegment["kind"], string> = {
  "en-vivo": "Actualizacion sismica",
  recorrido: "Evento en seguimiento",
  boletin: "Boletin automatico",
  resumen: "Resumen operativo",
  educativo: "Contexto sismico",
  relevo: "Cambio de locutor"
};

function findSelectedEvent(events: SeismicEvent[], selectedEventId: string | null): SeismicEvent | null {
  return selectedEventId ? (events.find((event) => event.eventId === selectedEventId) ?? null) : null;
}

function directorOverlayStyle(text: string): CSSProperties {
  const normalized = text.replace(/\s+/g, " ").trim();
  const length = normalized.length;
  const targetLines = length <= 72 ? 1 : length <= 132 ? 2 : 3;
  const idealChars = clampNumber(Math.ceil((length + 18) / targetLines), 36, 68);
  return {
    ["--director-overlay-ideal-ch" as string]: `${idealChars}ch`
  };
}

const MAGNITUDE_SCALE_LEVELS = [9, 8, 7, 6, 5, 4, 3, 2, 1] as const;

// Presentacion de sismos EN VIVO: tiempo minimo que cada uno permanece en foco y tope de la
// cola, para que un lote grande ingresado de golpe no salte erraticamente ni tape la voz.
const MIN_LIVE_DISPLAY_MS = 8_000;
const MAX_LIVE_QUEUE = 5;

function MagnitudeScale({ magnitude }: { magnitude: number | null }) {
  const normalizedMagnitude = clampNumber(magnitude ?? 0, 0, 9);
  return (
    <div
      className="magnitude-scale"
      aria-label={`Barra de magnitud ${magnitude ?? "no disponible"}`}
      title="Barra = magnitud del evento. El color del mapa representa intensidad MMI."
    >
      <span className="magnitude-scale-label">Magnitud</span>
      <div className="magnitude-scale-body">
        <div className="magnitude-scale-numbers">
          {MAGNITUDE_SCALE_LEVELS.map((value) => (
            <span key={value}>{value}</span>
          ))}
        </div>
        <div className="magnitude-scale-track">
          {MAGNITUDE_SCALE_LEVELS.map((level) => {
            const fill = magnitude === null ? 0 : clampNumber(normalizedMagnitude - (level - 1), 0, 1);
            const bandMagnitude = Math.max(0.5, level - 0.5);
            return (
              <span className="magnitude-scale-segment" key={level}>
                <i
                  style={{
                    background: magnitudeCssColor(bandMagnitude),
                    opacity: fill > 0 ? 1 : 0.18,
                    transform: `scaleY(${fill})`
                  }}
                />
              </span>
            );
          })}
        </div>
      </div>
      <span className="magnitude-scale-caption">
        {magnitude === null
          ? "Sin dato"
          : (MAGNITUDE_BANDS.find((band) => magnitude < band.max)?.label ??
            MAGNITUDE_BANDS[MAGNITUDE_BANDS.length - 1].label)}
      </span>
    </div>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  useCountryGeocoder();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [utcNow, setUtcNow] = useState(() => new Date());
  const [tourPaused, setTourPaused] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceEngine, setVoiceEngineState] = useState<VoiceEngine>(() => getVoiceEngine());
  const [engineAvailability, setEngineAvailability] = useState<Record<VoiceEngine, boolean>>(() => ({
    piper: false,
    xtts: false,
    browser: isEngineAvailable("browser")
  }));
  const [directorMode, setDirectorMode] = useState<DirectorMode>("off");
  const [overlaySegment, setOverlaySegment] = useState<BroadcastSegment | null>(null);
  const minMagnitude = DEFAULT_MIN_MAGNITUDE;
  const hours = DEFAULT_HOURS;

  const eventsQuery = useEventsQuery(minMagnitude, hours);
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const pendingVoiceIntroRef = useRef<{ eventId: string; intro: string } | null>(null);
  // Cola de sismos EN VIVO que llegaron mientras la voz narraba: se anuncian al terminar.
  const pendingLiveQueueRef = useRef<SeismicEvent[]>([]);
  const promotedLiveAtRef = useRef<number | null>(null);
  // Hasta cuando un sismo EN VIVO retiene el foco (el recorrido cede el turno mientras tanto).
  const liveHoldUntilRef = useRef(0);
  const statuses = useSourceStatusesQuery().data ?? [];
  const disasters = useDisastersQuery().data ?? [];
  const tsunamiProducts = useTsunamiQuery().data ?? [];
  const stationsQuery = useStationsQuery();
  const stations = stationsQuery.data ?? [];
  const seismicPresence = useSeismicPresenceQuery().data ?? null;
  const topMagnitude = useTopMagnitudeQuery().data ?? [];
  const error = eventsQuery.isError
    ? eventsQuery.error instanceof Error
      ? eventsQuery.error.message
      : "Error inesperado"
    : null;

  const selectedEvent = useMemo(() => findSelectedEvent(events, selectedEventId), [events, selectedEventId]);
  const focusEvent = selectedEvent ?? events[0] ?? null;
  // Identidad del sismo enfocado: la narracion se dispara por ID, no por la referencia del
  // objeto (que cambia en cada refresco de datos y reiniciaria la voz -> "eco").
  const focusEventId = focusEvent?.eventId ?? null;
  const focusEventRef = useRef(focusEvent);
  focusEventRef.current = focusEvent;
  const focusStatus = focusEvent ? getEventStatusBadge(focusEvent.status) : null;
  const focusContext = focusEvent
    ? (disasters.find((context) => context.eventId === focusEvent.eventId) ?? null)
    : null;
  const primaryStatus = statuses.find((status) => status.source === "USGS") ?? statuses[0] ?? null;
  const activeTsunami =
    tsunamiProducts.find(
      (product) =>
        product.status.toLowerCase() === "actual" &&
        (!product.expiresAtUtc || Date.parse(product.expiresAtUtc) >= utcNow.getTime())
    ) ?? null;

  const handleIncomingEvent = useCallback(
    (incomingEvent: SeismicEvent) => {
      const key = eventsQueryKey(minMagnitude, hours);
      const current = queryClient.getQueryData<SeismicEvent[]>(key) ?? [];
      const isNewLive =
        !current.some((item) => item.eventId === incomingEvent.eventId) &&
        (incomingEvent.magnitude === null || incomingEvent.magnitude >= minMagnitude);

      queryClient.setQueryData(key, (existing: SeismicEvent[] | undefined) =>
        mergeIncomingEvent(existing, incomingEvent, minMagnitude)
      );

      if (!isNewLive || tourPaused) return;

      // Encola SIEMPRE (el watcher los presenta de a uno, con tiempo minimo y sin tapar la
      // voz). Un tope evita que un lote grande de golpe genere una avalancha de anuncios;
      // los sobrantes quedan igualmente en la lista/globo y el recorrido los recorrera.
      const queue = pendingLiveQueueRef.current;
      if (queue.some((item) => item.eventId === incomingEvent.eventId) || queue.length >= MAX_LIVE_QUEUE) {
        return;
      }
      queue.push(incomingEvent);
      if (voiceEnabled) {
        prefetchSeismicNarration(incomingEvent, true, { intro: "Nuevo sismo detectado" });
      }
    },
    [queryClient, minMagnitude, hours, tourPaused, voiceEnabled]
  );

  const connectionState = useEventStream(handleIncomingEvent);

  useBroadcastDirector({
    mode: directorMode,
    voiceEnabled,
    events,
    pendingLiveQueueRef,
    onFocusEvent: setSelectedEventId,
    onSegment: setOverlaySegment
  });

  // Vigila la narracion en curso: cuando termina, promueve el siguiente sismo EN VIVO
  // encolado (lo muestra y lo anuncia como "Nuevo sismo detectado"), sin interrumpir.
  // Con el director activo, es el director quien gobierna la cola.
  useEffect(() => {
    if (directorMode !== "off") return;
    const intervalId = window.setInterval(() => {
      const queue = pendingLiveQueueRef.current;
      if (queue.length === 0) return;

      // 1) No tapar la voz: esperar a que termine la narracion en curso.
      if (voiceEnabled && isSeismicNarrationActive()) return;
      // 2) Piso de exhibicion: cada sismo permanece un minimo antes del siguiente (evita
      //    saltos erraticos aunque la voz este apagada o la narracion sea corta).
      const sincePromote =
        promotedLiveAtRef.current === null
          ? Number.POSITIVE_INFINITY
          : Date.now() - promotedLiveAtRef.current;
      if (sincePromote < MIN_LIVE_DISPLAY_MS) return;

      const next = queue.shift();
      if (!next) return;
      pendingVoiceIntroRef.current = voiceEnabled
        ? { eventId: next.eventId, intro: "Nuevo sismo detectado" }
        : null;
      promotedLiveAtRef.current = Date.now();
      liveHoldUntilRef.current = Date.now() + MIN_LIVE_DISPLAY_MS;
      setSelectedEventId(next.eventId);
    }, 400);
    return () => window.clearInterval(intervalId);
  }, [voiceEnabled, directorMode]);
  const handleStationState = useCallback(
    (incoming: StationState) => {
      queryClient.setQueryData<SeismicStation[]>(["stations"], (current = []) =>
        current.map((station) => {
          if (station.stationId !== incoming.stationId) return station;
          if (station.sequence !== null && incoming.sequence <= station.sequence) return station;
          return {
            ...station,
            status: incoming.status,
            phase: incoming.phase,
            latencyMs: incoming.latencyMs,
            triggerValue: incoming.triggerValue,
            observedAtUtc: incoming.observedAtUtc,
            sequence: incoming.sequence,
            engine: incoming.engine
          };
        })
      );
    },
    [queryClient]
  );
  useStationStream(handleStationState);

  useEffect(() => {
    const intervalId = window.setInterval(() => setUtcNow(new Date()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const toggleTour = useCallback(() => setTourPaused((paused) => !paused), []);
  const toggleSound = useCallback(() => {
    const nextEnabled = !soundEnabled;
    setSoundEnabled(nextEnabled);
    void setSeismicAudioEnabled(nextEnabled).catch(() => undefined);
  }, [soundEnabled]);
  const speakVisibleContent = useCallback(
    (enabled: boolean) => {
      if (!enabled) return;
      if (directorMode !== "off" && overlaySegment) {
        speakText(overlaySegment.text, {
          cue: overlaySegment.cue,
          kind: overlaySegment.kind
        });
        return;
      }
      if (focusEvent) speakSeismicNarration(focusEvent, true, { force: true });
    },
    [directorMode, focusEvent, overlaySegment]
  );
  const toggleVoice = useCallback(() => {
    const nextEnabled = !voiceEnabled;
    setVoiceEnabled(nextEnabled);
    const ready = setSeismicVoiceEnabled(nextEnabled);
    if (nextEnabled && ready) speakVisibleContent(true);
  }, [speakVisibleContent, voiceEnabled]);
  const replayVoice = useCallback(() => {
    speakVisibleContent(voiceEnabled);
  }, [speakVisibleContent, voiceEnabled]);
  const handleVoiceEngineChange = useCallback(
    (engine: VoiceEngine) => {
      setVoiceEngine(engine);
      setVoiceEngineState(engine);
      speakVisibleContent(voiceEnabled);
    },
    [speakVisibleContent, voiceEnabled]
  );

  useEffect(() => {
    if (!soundEnabled) {
      void setSeismicAudioEnabled(false).catch(() => undefined);
      return;
    }

    const unlockAudio = () => {
      void setSeismicAudioEnabled(true).catch(() => undefined);
    };

    window.addEventListener("pointerdown", unlockAudio, true);
    window.addEventListener("keydown", unlockAudio, true);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio, true);
      window.removeEventListener("keydown", unlockAudio, true);
    };
  }, [soundEnabled]);

  useEffect(() => {
    const primeVoices = () => {
      setVoiceSupported(isSeismicVoiceSupported());
      primeSeismicVoices();
    };

    primeVoices();
    window.addEventListener("pointerdown", primeVoices, true);
    window.addEventListener("keydown", primeVoices, true);
    return () => {
      window.removeEventListener("pointerdown", primeVoices, true);
      window.removeEventListener("keydown", primeVoices, true);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshTtsHealth().then(() => {
      if (cancelled) return;
      setEngineAvailability({
        piper: isEngineAvailable("piper"),
        xtts: isEngineAvailable("xtts"),
        browser: isEngineAvailable("browser")
      });
      // refreshTtsHealth puede autoseleccionar un motor neural disponible.
      setVoiceEngineState(getVoiceEngine());
      setVoiceSupported(isSeismicVoiceSupported());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const event = focusEventRef.current;
    // Con el director activo, es el director quien narra (no este efecto de foco).
    if (!voiceEnabled || !event || directorMode !== "off") return;
    const pendingVoiceIntro =
      pendingVoiceIntroRef.current?.eventId === event.eventId
        ? pendingVoiceIntroRef.current.intro
        : undefined;
    if (pendingVoiceIntro) {
      pendingVoiceIntroRef.current = null;
    }
    speakSeismicNarration(event, true, pendingVoiceIntro ? { force: true, intro: pendingVoiceIntro } : {});
    // Solo por cambio de sismo (ID) o de habilitacion; NO por refrescos de datos.
  }, [focusEventId, voiceEnabled, directorMode]);

  useEffect(() => {
    const event = focusEventRef.current;
    if (!voiceEnabled || tourPaused || voiceEngine === "browser" || !event || directorMode !== "off") return;
    // Cachea la narracion del sismo actual y del siguiente para que suene sincronizada.
    prefetchSeismicNarration(event, true);
    const tour = eventsRef.current.slice(0, 15);
    if (tour.length < 2) return;
    const index = tour.findIndex((item) => item.eventId === event.eventId);
    const nextEvent = tour[(index + 1) % tour.length] ?? tour[0];
    if (nextEvent && nextEvent.eventId !== event.eventId) prefetchSeismicNarration(nextEvent, true);
  }, [focusEventId, tourPaused, voiceEnabled, voiceEngine, directorMode]);

  // Arranca el recorrido: selecciona el primer sismo en cuanto hay datos.
  useEffect(() => {
    if (selectedEventId === null && events.length > 0) {
      setSelectedEventId(events[0].eventId);
    }
  }, [events, selectedEventId]);

  // Auto-recorrido: cada ~16 s (13 s de visualizacion + ~3 s de vuelo) pasa al siguiente
  // de los ultimos 15 sismos. El timer es estable (no se reinicia con cada refresco de
  // datos); lee la lista vigente desde una ref.
  useEffect(() => {
    if (tourPaused || directorMode !== "off") return;
    const intervalId = window.setInterval(() => {
      // Cede el turno mientras se presentan sismos EN VIVO (cola o hold vigente).
      if (pendingLiveQueueRef.current.length > 0 || Date.now() < liveHoldUntilRef.current) return;
      const tour = eventsRef.current.slice(0, 15);
      if (tour.length === 0) return;
      setSelectedEventId((current) => {
        const index = tour.findIndex((event) => event.eventId === current);
        return tour[(index + 1) % tour.length].eventId;
      });
    }, 16_000);
    return () => window.clearInterval(intervalId);
  }, [tourPaused, directorMode]);

  return (
    <main className={activeTsunami ? "monitor-shell has-tsunami" : "monitor-shell"}>
      <header className="monitor-topbar">
        <strong className="topbar-brand">SISMICA // MONITOR MULTIFUENTE</strong>
        <div className="topbar-center">
          UTC · ultimos eventos M{minMagnitude.toFixed(1)}+ · datos oficiales normalizados
        </div>
        <div className="topbar-meta">
          <button
            type="button"
            className={soundEnabled ? "sound-toggle is-on" : "sound-toggle"}
            aria-pressed={soundEnabled}
            onClick={toggleSound}
            title={soundEnabled ? "Pulso sonoro de ondas activo" : "Activar pulso sonoro de ondas"}
          >
            SONIDO {soundEnabled ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            className={voiceEnabled ? "sound-toggle voice-toggle is-on" : "sound-toggle voice-toggle"}
            aria-pressed={voiceEnabled}
            disabled={!voiceSupported}
            onClick={toggleVoice}
            title={
              voiceSupported
                ? voiceEnabled
                  ? "Narracion TTS local activa"
                  : "Activar narracion TTS local"
                : "El navegador no expone speechSynthesis en este equipo"
            }
          >
            VOZ {voiceEnabled ? "ON" : "OFF"}
          </button>
          <label className="voice-engine" title="Motor de sintesis de voz para la narracion">
            <span className="voice-engine-label">MOTOR</span>
            <select
              className="voice-engine-select"
              value={voiceEngine}
              onChange={(event) => handleVoiceEngineChange(event.target.value as VoiceEngine)}
            >
              {VOICE_ENGINES.map((engine) => (
                <option key={engine} value={engine} disabled={!engineAvailability[engine]}>
                  {VOICE_ENGINE_LABELS[engine]}
                  {engine !== "browser" && !engineAvailability[engine] ? " (no disp.)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="voice-engine" title="Director del directo: recorrido, por reglas o con IA">
            <span className="voice-engine-label">DIRECTOR</span>
            <select
              className="voice-engine-select"
              value={directorMode}
              onChange={(event) => setDirectorMode(event.target.value as DirectorMode)}
            >
              {DIRECTOR_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {DIRECTOR_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="sound-toggle voice-repeat"
            disabled={!voiceSupported || !voiceEnabled || !focusEvent}
            onClick={replayVoice}
            title="Repetir la narracion del evento enfocado"
          >
            REPETIR
          </button>
          <span className={`connection-state state-${connectionState}`}>{connectionState.toUpperCase()}</span>
          <span className="topbar-clock">{formatUtcClock(utcNow)} UTC</span>
        </div>
      </header>

      {activeTsunami ? (
        <a
          className="tsunami-banner"
          href={activeTsunami.sourceUrl ?? undefined}
          rel="noreferrer"
          target="_blank"
        >
          {activeTsunami.source.replace("NOAA_", "NOAA ")} · {activeTsunami.event} ·{" "}
          {activeTsunami.severity ?? "sin severidad"}
        </a>
      ) : null}

      <section className="monitor-stage">
        {directorMode !== "off" && overlaySegment ? (
          <div
            className={`director-overlay director-${overlaySegment.kind}`}
            style={directorOverlayStyle(overlaySegment.text)}
          >
            <header className="director-overlay-header">
              <strong>{SEGMENT_TITLES[overlaySegment.kind]}</strong>
              <span className="director-overlay-kind">{SEGMENT_LABELS[overlaySegment.kind]}</span>
            </header>
            <div className="director-overlay-body">
              <span className="director-overlay-text">{overlaySegment.text}</span>
            </div>
          </div>
        ) : null}
        <MapPanel
          disasters={disasters}
          events={events}
          stations={stations}
          experimentalOrigins={[]}
          seismicPresence={seismicPresence}
          topMagnitude={topMagnitude}
          selectedEventId={selectedEventId}
          soundEnabled={soundEnabled}
          onSelect={setSelectedEventId}
          tourPaused={tourPaused}
          onToggleTour={toggleTour}
        />

        <section className="overlay-column overlay-left">
          <article className="event-console">
            <header className="event-console-title">
              <strong>{focusEvent ? "Evento sismico detectado" : "Sin eventos"}</strong>
              <span>
                {focusEvent
                  ? `${Math.max(1, events.findIndex((event) => event.eventId === focusEvent.eventId) + 1)}/${events.length}`
                  : "0/0"}
              </span>
            </header>

            {focusEvent ? (
              <div className="event-console-body">
                <div className="event-identity">
                  <div className="intensity-box" title="Color del punto en el mapa">
                    <small>Intensidad</small>
                    <strong>{normalizedIntensity(focusEvent)}</strong>
                  </div>
                  <div className="event-headline">
                    <strong>
                      <CountryFlag event={focusEvent} className="event-flag" />
                      <Marquee text={normalizedPlace(focusEvent, resolveCountryCode(focusEvent))} />
                    </strong>
                    <span>{formatUtcDateTime(focusEvent.eventTimeUtc)} UTC</span>
                    <span>
                      lat: {formatCoordinate(focusEvent.latitude, "lat")} lon:{" "}
                      {formatCoordinate(focusEvent.longitude, "lon")}
                    </span>
                    <span>Profundidad: {formatDepth(focusEvent.depthKm)}</span>
                  </div>
                  <div
                    className="event-magnitude-display"
                    style={{ color: magnitudeCssColor(focusEvent.magnitude) }}
                    title="Magnitud del evento"
                  >
                    <span>{formatMagnitude(focusEvent.magnitude)}</span>
                  </div>
                  <span
                    className={`event-status-badge ${focusStatus?.tone}`}
                    title="Estado publicado por la fuente"
                  >
                    {focusStatus?.label}
                  </span>
                </div>

                <div className="event-technical-layout">
                  <MagnitudeScale magnitude={focusEvent.magnitude} />
                  <div className="technical-panel">
                    <div className="technical-row technical-wide">
                      <span>Fuentes</span>
                      <strong>{focusEvent.sources.join(" + ")}</strong>
                    </div>
                    <div className="technical-row">
                      <span>Estaciones usadas</span>
                      <strong>{formatMetric(focusEvent.stationCount, "", 0)}</strong>
                    </div>
                    <div className="technical-row">
                      <span>Estado</span>
                      <strong>{focusStatus?.description ?? "N/D"}</strong>
                    </div>
                    <div className="technical-row">
                      <span>Gap azimutal</span>
                      <strong>{formatMetric(focusEvent.azimuthalGapDeg, "°", 0)}</strong>
                    </div>
                    <div className="technical-row">
                      <span>Dmin</span>
                      <strong>{formatMetric(focusEvent.nearestStationDeg, "°", 2)}</strong>
                    </div>
                    <div className="technical-row">
                      <span>RMS</span>
                      <strong>{formatMetric(focusEvent.rmsSec, " s", 2)}</strong>
                    </div>
                    <div className="technical-row">
                      <span>CDI</span>
                      <strong>{formatMetric(focusEvent.cdi, "", 1)}</strong>
                    </div>
                    <div className="technical-row">
                      <span>Significancia</span>
                      <strong>{formatMetric(focusEvent.significance, "", 0)}</strong>
                    </div>
                    <div className="technical-row">
                      <span>Reportes sentidos</span>
                      <strong>{formatMetric(focusEvent.feltReports, "", 0)}</strong>
                    </div>
                    <div className="technical-row">
                      <span>PAGER</span>
                      <strong>{focusEvent.alertLevel?.toUpperCase() ?? "N/D"}</strong>
                    </div>
                    <div className="technical-row">
                      <span>Tsunami USGS</span>
                      <strong>{focusEvent.tsunami ? "INDICADO" : "NO"}</strong>
                    </div>
                  </div>
                </div>

                {focusContext ? (
                  <a
                    className={`gdacs-context level-${focusContext.alertLevel?.toLowerCase() ?? "green"}`}
                    href={focusContext.sourceUrl ?? undefined}
                    rel="noreferrer"
                    target="_blank"
                  >
                    GDACS {focusContext.alertLevel ?? "N/D"} · score{" "}
                    {formatMetric(focusContext.alertScore, "", 1)}
                  </a>
                ) : null}

                {focusEvent.sourceUrl ? (
                  <a
                    className="official-source-link"
                    href={focusEvent.sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Abrir reporte oficial {focusEvent.source}
                  </a>
                ) : null}
              </div>
            ) : (
              <div className="empty-state">Esperando eventos.</div>
            )}
          </article>

          <SourceStatusCard statuses={statuses} />
          {error ? <div className="error-banner">{error}</div> : null}
        </section>

        <aside className="overlay-column overlay-right">
          <EventList events={events} selectedEventId={selectedEventId} onSelect={setSelectedEventId} />
        </aside>

        <footer className="monitor-footer">
          <span>Primaria: {primaryStatus?.source ?? "USGS"}</span>
          <span>
            Ingesta: {formatUtcDateTime(primaryStatus?.lastRunFinishedAt ?? focusEvent?.ingestedAt ?? null)}
          </span>
          <span>
            {events.length} eventos / {hours} h
          </span>
          <span>{disasters.length} contextos GDACS</span>
          <span>{tsunamiProducts.length} productos NOAA recientes</span>
          <span className="footer-disclaimer">
            Informativo. Confirme decisiones con autoridades oficiales.
          </span>
        </footer>
      </section>
    </main>
  );
}
