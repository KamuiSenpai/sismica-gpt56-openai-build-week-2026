import { buildEventId, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchTextAllowInvalidTls } from "./http.js";
import {
  finiteNumber,
  isValidCoordinate,
  localDateTimeToUtc,
  stripHtml,
  collapseSpaces
} from "./regionalUtils.js";
import { type SeismicProvider } from "./types.js";

export type InsivumehMarkerRecord = {
  latitude: number;
  longitude: number;
  sourceEventId: string | null;
  magnitude: number | null;
  eventTimeUtc: string | null;
  depthKm: number | null;
  stationCount: number | null;
  rmsSec: number | null;
  azimuthalGapDeg: number | null;
  sourceUrl: string | null;
};

export function parseInsivumehMarkers(html: string): InsivumehMarkerRecord[] {
  return html
    .split(/var circle_marker_/)
    .slice(1)
    .flatMap((chunk) => {
      const coordMatch = /L\.circleMarker\(\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/.exec(
        chunk
      );
      if (!coordMatch) return [];

      const text = collapseSpaces(stripHtml(chunk)) ?? "";
      const sourceEventId =
        /ID:\s*(insivumeh[a-z0-9]+)/i.exec(text)?.[1] ??
        /HISTORICO\/(insivumeh[a-z0-9]+)/i.exec(chunk)?.[1] ??
        null;
      const dateMatch = /Tiempo de Origen:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i.exec(text);
      const eventTimeUtc = dateMatch ? localDateTimeToUtc(dateMatch[1], dateMatch[2], "-06:00") : null;

      return [
        {
          latitude: Number(coordMatch[1]),
          longitude: Number(coordMatch[2]),
          sourceEventId,
          magnitude: finiteNumber(/Magnitud:\s*([0-9.]+)/i.exec(text)?.[1]),
          eventTimeUtc,
          depthKm: finiteNumber(/Profundidad:\s*([0-9.]+)\s*km/i.exec(text)?.[1]),
          stationCount: finiteNumber(/NST:\s*([0-9]+)/i.exec(text)?.[1]),
          rmsSec: finiteNumber(/RMS:\s*([0-9.]+)/i.exec(text)?.[1]),
          azimuthalGapDeg: finiteNumber(/GAP:\s*([0-9.]+)/i.exec(text)?.[1]),
          sourceUrl: sourceEventId ? `https://geo.insivumeh.gob.gt/IMM/HISTORICO/${sourceEventId}` : null
        }
      ];
    });
}

export function normalizeInsivumehRecord(
  record: InsivumehMarkerRecord,
  ingestedAt: string
): SeismicEvent | null {
  if (
    !record.sourceEventId ||
    !record.eventTimeUtc ||
    !isValidCoordinate(record.latitude, record.longitude)
  ) {
    return null;
  }

  return {
    eventId: buildEventId("INSIVUMEH", record.sourceEventId),
    source: "INSIVUMEH",
    sourceEventId: record.sourceEventId,
    title: `${record.magnitude === null ? "Sismo" : `M${record.magnitude.toFixed(1)}`} - Guatemala`,
    magnitude: record.magnitude,
    magnitudeType: null,
    latitude: record.latitude,
    longitude: record.longitude,
    depthKm: record.depthKm,
    mmi: null,
    cdi: null,
    intensityText: null,
    stationCount: record.stationCount,
    azimuthalGapDeg: record.azimuthalGapDeg,
    nearestStationDeg: null,
    rmsSec: record.rmsSec,
    significance: null,
    feltReports: null,
    alertLevel: null,
    tsunami: false,
    networkCode: "INSIVUMEH",
    providerEventCode: record.sourceEventId,
    eventType: "earthquake",
    detailUrl: record.sourceUrl ?? env.insivumehMapUrl,
    sources: ["INSIVUMEH"],
    sourceCount: 1,
    eventTimeUtc: record.eventTimeUtc,
    updatedAtUtc: null,
    status: "official",
    sourceUrl: record.sourceUrl ?? env.insivumehMapUrl,
    ingestedAt
  };
}

export const insivumehProvider: SeismicProvider = {
  code: "INSIVUMEH",
  async fetchEvents() {
    const html = await fetchTextAllowInvalidTls(env.insivumehMapUrl);
    const ingestedAt = new Date().toISOString();
    const cutoff = Date.now() - env.sourceWindowHours * 3_600_000;

    return parseInsivumehMarkers(html).flatMap((record) => {
      const event = normalizeInsivumehRecord(record, ingestedAt);
      return event && Date.parse(event.eventTimeUtc) >= cutoff ? [{ event, rawPayload: record }] : [];
    });
  }
};
