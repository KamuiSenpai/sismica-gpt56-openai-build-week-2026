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
import { CountryFlag } from "./components/CountryFlag";

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
  const minMagnitude = DEFAULT_MIN_MAGNITUDE;
  const hours = DEFAULT_HOURS;

  const eventsQuery = useEventsQuery(minMagnitude, hours);
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const statuses = useSourceStatusesQuery().data ?? [];
  const disasters = useDisastersQuery().data ?? [];
  const tsunamiProducts = useTsunamiQuery().data ?? [];
  const stationsQuery = useStationsQuery();
  const stations = stationsQuery.data ?? [];
  const seismicPresence = useSeismicPresenceQuery().data ?? null;
  const error = eventsQuery.isError
    ? eventsQuery.error instanceof Error
      ? eventsQuery.error.message
      : "Error inesperado"
    : null;

  const selectedEvent = useMemo(() => findSelectedEvent(events, selectedEventId), [events, selectedEventId]);
  const focusEvent = selectedEvent ?? events[0] ?? null;
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
      // Un sismo EN VIVO (nuevo) interrumpe el recorrido y se muestra de inmediato.
      if (isNewLive && !tourPaused) {
        setSelectedEventId(incomingEvent.eventId);
      }
    },
    [queryClient, minMagnitude, hours, tourPaused]
  );

  const connectionState = useEventStream(handleIncomingEvent);
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

  // Arranca el recorrido: selecciona el primer sismo en cuanto hay datos.
  useEffect(() => {
    if (selectedEventId === null && events.length > 0) {
      setSelectedEventId(events[0].eventId);
    }
  }, [events, selectedEventId]);

  // Auto-recorrido: cada ~18 s (15 s de visualizacion + ~3 s de vuelo) pasa al siguiente
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
    }, 18_200);
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
          selectedEventId={selectedEventId}
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
                      <CountryFlag event={focusEvent} className="event-flag" />{" "}
                      {normalizedPlace(focusEvent, resolveCountryCode(focusEvent))}
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
