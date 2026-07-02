import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  VOICE_ENGINE_LABELS,
  VOICE_ENGINES,
  type VoiceEngine
} from "./lib/seismicVoice";
import { CountryFlag } from "./components/CountryFlag";
import { Marquee } from "./components/Marquee";

function findSelectedEvent(events: SeismicEvent[], selectedEventId: string | null): SeismicEvent | null {
  return selectedEventId ? (events.find((event) => event.eventId === selectedEventId) ?? null) : null;
}

const MAGNITUDE_SCALE_LEVELS = [9, 8, 7, 6, 5, 4, 3, 2, 1] as const;

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
  const sawNarrationRef = useRef(false);
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

      // Pre-sintetiza ya la narracion del nuevo sismo para anunciarlo al instante.
      if (isNewLive && !tourPaused && voiceEnabled) {
        prefetchSeismicNarration(incomingEvent, true, { intro: "Nuevo sismo detectado" });
      }
      queryClient.setQueryData(key, (existing: SeismicEvent[] | undefined) =>
        mergeIncomingEvent(existing, incomingEvent, minMagnitude)
      );

      if (!isNewLive || tourPaused) return;

      // Si la voz esta narrando, NO interrumpe: encola el sismo para anunciarlo al terminar.
      if (voiceEnabled && isSeismicNarrationActive()) {
        const queue = pendingLiveQueueRef.current;
        if (!queue.some((item) => item.eventId === incomingEvent.eventId)) {
          queue.push(incomingEvent);
        }
        return;
      }

      // Silencio (o voz apagada): muestra el nuevo sismo y lo anuncia de inmediato.
      if (voiceEnabled) {
        pendingVoiceIntroRef.current = { eventId: incomingEvent.eventId, intro: "Nuevo sismo detectado" };
      }
      setSelectedEventId(incomingEvent.eventId);
    },
    [queryClient, minMagnitude, hours, tourPaused, voiceEnabled]
  );

  const connectionState = useEventStream(handleIncomingEvent);

  // Vigila la narracion en curso: cuando termina, promueve el siguiente sismo EN VIVO
  // encolado (lo muestra y lo anuncia como "Nuevo sismo detectado"), sin interrumpir.
  useEffect(() => {
    const START_GRACE_MS = 6_000;
    const intervalId = window.setInterval(() => {
      const queue = pendingLiveQueueRef.current;
      if (queue.length === 0) return;

      if (voiceEnabled && isSeismicNarrationActive()) {
        sawNarrationRef.current = true;
        return;
      }
      // Tras promover, da margen a que su narracion arranque (XTTS puede tardar) antes del siguiente.
      if (
        promotedLiveAtRef.current !== null &&
        !sawNarrationRef.current &&
        Date.now() - promotedLiveAtRef.current < START_GRACE_MS
      ) {
        return;
      }

      const next = queue.shift();
      if (!next) return;
      pendingVoiceIntroRef.current = { eventId: next.eventId, intro: "Nuevo sismo detectado" };
      promotedLiveAtRef.current = Date.now();
      sawNarrationRef.current = false;
      setSelectedEventId(next.eventId);
    }, 400);
    return () => window.clearInterval(intervalId);
  }, [voiceEnabled]);
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
  const toggleVoice = useCallback(() => {
    const nextEnabled = !voiceEnabled;
    setVoiceEnabled(nextEnabled);
    const ready = setSeismicVoiceEnabled(nextEnabled);
    if (nextEnabled && ready && focusEvent) {
      speakSeismicNarration(focusEvent, true, { force: true });
    }
  }, [focusEvent, voiceEnabled]);
  const replayVoice = useCallback(() => {
    if (!focusEvent) return;
    speakSeismicNarration(focusEvent, voiceEnabled, { force: true });
  }, [focusEvent, voiceEnabled]);
  const handleVoiceEngineChange = useCallback(
    (engine: VoiceEngine) => {
      setVoiceEngine(engine);
      setVoiceEngineState(engine);
      if (voiceEnabled && focusEvent) {
        speakSeismicNarration(focusEvent, true, { force: true });
      }
    },
    [voiceEnabled, focusEvent]
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
    if (!voiceEnabled || !event) return;
    const pendingVoiceIntro =
      pendingVoiceIntroRef.current?.eventId === event.eventId
        ? pendingVoiceIntroRef.current.intro
        : undefined;
    if (pendingVoiceIntro) {
      pendingVoiceIntroRef.current = null;
    }
    speakSeismicNarration(event, true, pendingVoiceIntro ? { force: true, intro: pendingVoiceIntro } : {});
    // Solo por cambio de sismo (ID) o de habilitacion; NO por refrescos de datos.
  }, [focusEventId, voiceEnabled]);

  useEffect(() => {
    const event = focusEventRef.current;
    if (!voiceEnabled || tourPaused || voiceEngine === "browser" || !event) return;
    // Cachea la narracion del sismo actual y del siguiente para que suene sincronizada.
    prefetchSeismicNarration(event, true);
    const tour = eventsRef.current.slice(0, 15);
    if (tour.length < 2) return;
    const index = tour.findIndex((item) => item.eventId === event.eventId);
    const nextEvent = tour[(index + 1) % tour.length] ?? tour[0];
    if (nextEvent && nextEvent.eventId !== event.eventId) prefetchSeismicNarration(nextEvent, true);
  }, [focusEventId, tourPaused, voiceEnabled, voiceEngine]);

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
    if (tourPaused) return;
    const intervalId = window.setInterval(() => {
      const tour = eventsRef.current.slice(0, 15);
      if (tour.length === 0) return;
      setSelectedEventId((current) => {
        const index = tour.findIndex((event) => event.eventId === current);
        return tour[(index + 1) % tour.length].eventId;
      });
    }, 16_000);
    return () => window.clearInterval(intervalId);
  }, [tourPaused]);

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
