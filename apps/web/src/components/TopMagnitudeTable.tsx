import { useMemo } from "react";

import { type SeismicEvent } from "@sismica/shared";

import { resolveCountryCode } from "../lib/countryGeocoder";
import { countryNameEs, formatMagnitude, magnitudeCssColor, topMagnitudePlace } from "../lib/presentation";
import { CountryFlag } from "./CountryFlag";
import { Marquee } from "./Marquee";

type TopMagnitudeTableProps = {
  historical: SeismicEvent[];
  liveEvents: SeismicEvent[];
};

// "En vivo": ocurrido en la ultima hora. Solo un evento gigante (M8.3+) entraria
// al top-10, y en ese caso se resalta.
const LIVE_WINDOW_MS = 60 * 60 * 1000;

// Top-10 de mayor magnitud (2000-actualidad). El historico llega del backend y
// se mezcla con los eventos en vivo (SSE): si uno nuevo supera al #10, entra
// automaticamente.
export function TopMagnitudeTable({ historical, liveEvents }: TopMagnitudeTableProps) {
  const rows = useMemo(() => {
    const byId = new Map<string, SeismicEvent>();
    for (const event of historical) {
      if (event.magnitude !== null) byId.set(event.eventId, event);
    }
    for (const event of liveEvents) {
      if (event.magnitude !== null && !byId.has(event.eventId)) byId.set(event.eventId, event);
    }
    return Array.from(byId.values())
      .sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0))
      .slice(0, 10);
  }, [historical, liveEvents]);

  const now = Date.now();

  return (
    <div className="map-legend legend-top-mag">
      <div className="top-mag-heading">
        <span className="legend-title">Top 10 terremotos</span>
        <strong>2000 - 2026</strong>
      </div>
      <ol className="top-mag-list">
        {rows.length === 0 ? (
          <li className="top-mag-empty">Cargando</li>
        ) : (
          rows.map((event, index) => {
            const isLive = now - new Date(event.eventTimeUtc).getTime() < LIVE_WINDOW_MS;
            const place = topMagnitudePlace(event);
            const code = place.code ?? resolveCountryCode(event);
            const country = countryNameEs(code);
            // Anexa "- Pais" si corresponde y no esta ya en el texto del lugar.
            const label =
              country && !place.place.toLowerCase().includes(country.toLowerCase())
                ? `${place.place} - ${country}`
                : place.place;
            return (
              <li key={event.eventId} className={isLive ? "top-mag-row is-live" : "top-mag-row"}>
                <span className="top-mag-rank">{index + 1}</span>
                <span className="top-mag-mag" style={{ color: magnitudeCssColor(event.magnitude) }}>
                  {formatMagnitude(event.magnitude)}
                </span>
                <CountryFlag event={event} code={code} className="top-mag-flag" />
                <Marquee text={label} className="top-mag-place-marquee" />
                {isLive ? (
                  <span className="top-mag-live">EN VIVO</span>
                ) : (
                  <span className="top-mag-year">{event.eventTimeUtc.slice(0, 4)}</span>
                )}
              </li>
            );
          })
        )}
      </ol>
    </div>
  );
}
