import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { type SeismicEvent } from "@sismica/shared";
import { CountryFlag } from "./CountryFlag";

import {
  EVENT_STATUS_LEGEND,
  formatDepth,
  formatMagnitude,
  formatUtcDateTime,
  getEventPlace,
  getEventStatusBadge,
  magnitudeCssColor
} from "../lib/presentation";

type EventListProps = {
  events: SeismicEvent[];
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
};

const SOURCE_MARK_LABEL: Record<SeismicEvent["source"], string> = {
  USGS: "US",
  EMSC: "EM",
  SED: "CH",
  RENASS: "FR",
  ISC: "WW",
  GA: "AU",
  NRCAN: "CA",
  NCEDC: "NC",
  KNMI: "NL",
  SCEDC: "SC",
  IGP: "PE",
  FUNVISIS: "FU",
  GEOFON: "GF",
  GEONET: "GN",
  BMKG: "BM",
  JMA: "JM",
  CWA: "TW",
  SGC: "CO",
  IGN: "ES",
  SSN: "MX",
  CSN: "CL",
  INGV: "IT",
  IGEPN: "EC",
  INPRES: "AR",
  MARN: "SV",
  OVSICORI: "CR",
  INSIVUMEH: "GT"
};

const FEED_ROW_HEIGHT_PX = 48;

type FeedLayout = {
  height: number;
  rowHeight: number;
};

export function EventList({ events, selectedEventId, onSelect }: EventListProps) {
  const cardRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const [feedLayout, setFeedLayout] = useState<FeedLayout | null>(null);

  useLayoutEffect(() => {
    const updateFeedHeight = () => {
      const card = cardRef.current;
      const heading = headingRef.current;
      const legend = legendRef.current;
      if (!card || !heading || !legend) return;

      const availableHeight = Math.max(0, card.clientHeight - heading.offsetHeight - legend.offsetHeight);
      const rowCount = Math.max(1, Math.round(availableHeight / FEED_ROW_HEIGHT_PX));
      const rowHeight = availableHeight / rowCount;
      const nextLayout = {
        height: rowHeight * rowCount,
        rowHeight
      };
      setFeedLayout((current) =>
        current &&
        Math.abs(current.height - nextLayout.height) < 0.5 &&
        Math.abs(current.rowHeight - nextLayout.rowHeight) < 0.5
          ? current
          : nextLayout
      );
    };

    updateFeedHeight();

    const resizeObserver = new ResizeObserver(updateFeedHeight);
    if (cardRef.current) resizeObserver.observe(cardRef.current);
    if (headingRef.current) resizeObserver.observe(headingRef.current);
    if (legendRef.current) resizeObserver.observe(legendRef.current);
    window.addEventListener("resize", updateFeedHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateFeedHeight);
    };
  }, []);

  const feedStyle =
    feedLayout === null
      ? undefined
      : ({
          "--event-feed-row-height": `${feedLayout.rowHeight}px`,
          flex: "0 0 auto",
          height: `${feedLayout.height}px`
        } as CSSProperties);

  return (
    <section className="feed-card" ref={cardRef}>
      <header className="feed-heading" ref={headingRef}>
        <strong>Feed global</strong>
        <span>{events.length} eventos</span>
      </header>

      <div className="feed-status-legend" aria-label="Leyenda de estados del feed" ref={legendRef}>
        {EVENT_STATUS_LEGEND.map((item) => (
          <span className="feed-status-legend-item" key={item.label} title={item.description}>
            <span className={`feed-status ${item.tone}`}>{item.label}</span>
            <small>{item.description}</small>
          </span>
        ))}
      </div>

      <div className="event-feed" style={feedStyle}>
        {events.map((event) => {
          const status = getEventStatusBadge(event.status);
          const place = getEventPlace(event.title);
          return (
            <button
              key={event.eventId}
              className={
                event.eventId === selectedEventId ? "event-feed-item is-selected" : "event-feed-item"
              }
              onClick={() => onSelect(event.eventId)}
              type="button"
            >
              <span className="feed-source-mark">{SOURCE_MARK_LABEL[event.source]}</span>
              <span className="feed-event-copy">
                <strong title={place}>
                  <CountryFlag
                    event={event}
                    className="feed-flag"
                    style={{ width: "18px", height: "13px", borderRadius: "2px", objectFit: "cover" }}
                  />
                  <span className="feed-event-place">{place}</span>
                </strong>
                <small>{formatUtcDateTime(event.eventTimeUtc)} UTC</small>
              </span>
              <span className="feed-event-values">
                <strong style={{ color: magnitudeCssColor(event.magnitude) }}>
                  {formatMagnitude(event.magnitude)}
                </strong>
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
