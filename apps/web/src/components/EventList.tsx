import { type SeismicEvent } from "@sismica/shared";

import {
  EVENT_STATUS_LEGEND,
  formatDepth,
  formatMagnitude,
  formatUtcDateTime,
  getEventPlace,
  getEventStatusBadge
} from "../lib/presentation";

type EventListProps = {
  events: SeismicEvent[];
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
};

export function EventList({ events, selectedEventId, onSelect }: EventListProps) {
  return (
    <section className="feed-card">
      <header className="feed-heading">
        <strong>Feed global</strong>
        <span>{events.length} eventos</span>
      </header>

      <div className="feed-status-legend" aria-label="Leyenda de estados del feed">
        {EVENT_STATUS_LEGEND.map((item) => (
          <span className="feed-status-legend-item" key={item.label} title={item.description}>
            <span className={`feed-status ${item.tone}`}>{item.label}</span>
            <small>{item.description}</small>
          </span>
        ))}
      </div>

      <div className="event-feed">
        {events.map((event) => {
          const status = getEventStatusBadge(event.status);
          return (
            <button
              key={event.eventId}
              className={
                event.eventId === selectedEventId ? "event-feed-item is-selected" : "event-feed-item"
              }
              onClick={() => onSelect(event.eventId)}
              type="button"
            >
              <span className="feed-source-mark">{event.source.slice(0, 2)}</span>
              <span className="feed-event-copy">
                <strong>{getEventPlace(event.title)}</strong>
                <small>{formatUtcDateTime(event.eventTimeUtc)} UTC</small>
              </span>
              <span className="feed-event-values">
                <strong>{formatMagnitude(event.magnitude)}</strong>
                <small>{formatDepth(event.depthKm)}</small>
              </span>
              <span className={`feed-status ${status.tone}`} title={status.description}>
                {status.label}
              </span>
              {event.sourceCount > 1 ? (
                <span className="feed-source-count" title={event.sources.join(", ")}>
                  +{event.sourceCount - 1}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
