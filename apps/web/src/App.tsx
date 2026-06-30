import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { DEFAULT_HOURS, DEFAULT_MIN_MAGNITUDE, clampNumber, type SeismicEvent } from "@sismica/shared";

import { EventList } from "./components/EventList";
import { MapPanel } from "./components/MapPanel";
import { SourceStatusCard } from "./components/SourceStatusCard";
import { useEventStream } from "./hooks/useEventStream";
import {
  eventsQueryKey,
  mergeIncomingEvent,
  useDisastersQuery,
  useEventsQuery,
  useSourceStatusesQuery,
  useTsunamiQuery
} from "./hooks/queries";
import {
  formatCoordinate,
  formatDepth,
  formatMagnitude,
  formatMetric,
  formatUtcClock,
  formatUtcDateTime,
  getEventPlace,
  getEventStatusBadge
} from "./lib/presentation";

function findSelectedEvent(events: SeismicEvent[], selectedEventId: string | null): SeismicEvent | null {
  return selectedEventId ? events.find((event) => event.eventId === selectedEventId) ?? null : null;
}

function MagnitudeScale({ magnitude }: { magnitude: number | null }) {
  const height = `${clampNumber(((magnitude ?? 0) / 9) * 100, 0, 100)}%`;
  return (
    <div className="magnitude-scale" aria-label={`Escala de magnitud ${magnitude ?? "no disponible"}`}>
      <div className="magnitude-scale-numbers">
        {[9, 8, 7, 6, 5, 4, 3, 2, 1].map((value) => <span key={value}>{value}</span>)}
      </div>
      <div className="magnitude-scale-track">
        <i style={{ height }} />
      </div>
    </div>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [utcNow, setUtcNow] = useState(() => new Date());
  const minMagnitude = DEFAULT_MIN_MAGNITUDE;
  const hours = DEFAULT_HOURS;

  const eventsQuery = useEventsQuery(minMagnitude, hours);
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const statuses = useSourceStatusesQuery().data ?? [];
  const disasters = useDisastersQuery().data ?? [];
  const tsunamiProducts = useTsunamiQuery().data ?? [];
  const error = eventsQuery.isError
    ? eventsQuery.error instanceof Error
      ? eventsQuery.error.message
      : "Error inesperado"
    : null;

  const selectedEvent = useMemo(() => findSelectedEvent(events, selectedEventId), [events, selectedEventId]);
  const focusEvent = selectedEvent ?? events[0] ?? null;
  const focusStatus = focusEvent ? getEventStatusBadge(focusEvent.status) : null;
  const focusContext = focusEvent ? disasters.find((context) => context.eventId === focusEvent.eventId) ?? null : null;
  const primaryStatus = statuses.find((status) => status.source === "USGS") ?? statuses[0] ?? null;
  const activeTsunami = tsunamiProducts.find((product) => (
    product.status.toLowerCase() === "actual"
    && (!product.expiresAtUtc || Date.parse(product.expiresAtUtc) >= utcNow.getTime())
  )) ?? null;

  const handleIncomingEvent = useCallback(
    (incomingEvent: SeismicEvent) => {
      queryClient.setQueryData(eventsQueryKey(minMagnitude, hours), (current: SeismicEvent[] | undefined) =>
        mergeIncomingEvent(current, incomingEvent, minMagnitude)
      );
    },
    [queryClient, minMagnitude, hours]
  );

  const connectionState = useEventStream(handleIncomingEvent);

  useEffect(() => {
    const intervalId = window.setInterval(() => setUtcNow(new Date()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <main className={activeTsunami ? "monitor-shell has-tsunami" : "monitor-shell"}>
      <header className="monitor-topbar">
        <strong className="topbar-brand">SISMICA // MONITOR MULTIFUENTE</strong>
        <div className="topbar-center">UTC · ultimos eventos M{minMagnitude.toFixed(1)}+ · datos oficiales normalizados</div>
        <div className="topbar-meta">
          <span className={`connection-state state-${connectionState}`}>{connectionState.toUpperCase()}</span>
          <span className="topbar-clock">{formatUtcClock(utcNow)} UTC</span>
        </div>
      </header>

      {activeTsunami ? (
        <a className="tsunami-banner" href={activeTsunami.sourceUrl ?? undefined} rel="noreferrer" target="_blank">
          {activeTsunami.source.replace("NOAA_", "NOAA ")} · {activeTsunami.event} · {activeTsunami.severity ?? "sin severidad"}
        </a>
      ) : null}

      <section className="monitor-stage">
        <MapPanel
          disasters={disasters}
          events={events}
          selectedEventId={selectedEventId}
          onSelect={setSelectedEventId}
        />

        <section className="overlay-column overlay-left">
          <article className="event-console">
            <header className="event-console-title">
              <strong>{focusEvent ? `${formatMagnitude(focusEvent.magnitude)} Evento sismico detectado` : "Sin eventos"}</strong>
              <span>{focusEvent ? `${Math.max(1, events.findIndex((event) => event.eventId === focusEvent.eventId) + 1)}/${events.length}` : "0/0"}</span>
            </header>

            {focusEvent ? (
              <div className="event-console-body">
                <div className="event-identity">
                  <div className="intensity-box">
                    <small>Intensidad</small>
                    <strong>{focusEvent.intensityText ?? formatMetric(focusEvent.mmi, "", 1)}</strong>
                    <span>MMI</span>
                  </div>
                  <div className="event-headline">
                    <strong>{getEventPlace(focusEvent.title)}</strong>
                    <span>{formatUtcDateTime(focusEvent.eventTimeUtc)} UTC</span>
                    <span>lat: {formatCoordinate(focusEvent.latitude, "lat")} lon: {formatCoordinate(focusEvent.longitude, "lon")}</span>
                    <span>Profundidad: {formatDepth(focusEvent.depthKm)}</span>
                  </div>
                  <span className={`event-status-badge ${focusStatus?.tone}`} title="Estado publicado por la fuente">
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
                    <div className="technical-row"><span>Estaciones usadas</span><strong>{formatMetric(focusEvent.stationCount, "", 0)}</strong></div>
                    <div className="technical-row"><span>Estado</span><strong>{focusStatus?.description ?? "N/D"}</strong></div>
                    <div className="technical-row"><span>Gap azimutal</span><strong>{formatMetric(focusEvent.azimuthalGapDeg, "°", 0)}</strong></div>
                    <div className="technical-row"><span>Dmin</span><strong>{formatMetric(focusEvent.nearestStationDeg, "°", 2)}</strong></div>
                    <div className="technical-row"><span>RMS</span><strong>{formatMetric(focusEvent.rmsSec, " s", 2)}</strong></div>
                    <div className="technical-row"><span>CDI</span><strong>{formatMetric(focusEvent.cdi, "", 1)}</strong></div>
                    <div className="technical-row"><span>Significancia</span><strong>{formatMetric(focusEvent.significance, "", 0)}</strong></div>
                    <div className="technical-row"><span>Reportes sentidos</span><strong>{formatMetric(focusEvent.feltReports, "", 0)}</strong></div>
                    <div className="technical-row"><span>PAGER</span><strong>{focusEvent.alertLevel?.toUpperCase() ?? "N/D"}</strong></div>
                    <div className="technical-row"><span>Tsunami USGS</span><strong>{focusEvent.tsunami ? "INDICADO" : "NO"}</strong></div>
                  </div>
                </div>

                {focusContext ? (
                  <a className={`gdacs-context level-${focusContext.alertLevel?.toLowerCase() ?? "green"}`} href={focusContext.sourceUrl ?? undefined} rel="noreferrer" target="_blank">
                    GDACS {focusContext.alertLevel ?? "N/D"} · score {formatMetric(focusContext.alertScore, "", 1)}
                  </a>
                ) : null}

                {focusEvent.sourceUrl ? (
                  <a className="official-source-link" href={focusEvent.sourceUrl} rel="noreferrer" target="_blank">
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
          <span>Ingesta: {formatUtcDateTime(primaryStatus?.lastRunFinishedAt ?? focusEvent?.ingestedAt ?? null)}</span>
          <span>{events.length} eventos / {hours} h</span>
          <span>{disasters.length} contextos GDACS</span>
          <span>{tsunamiProducts.length} productos NOAA recientes</span>
          <span className="footer-disclaimer">Informativo. Confirme decisiones con autoridades oficiales.</span>
        </footer>
      </section>
    </main>
  );
}
