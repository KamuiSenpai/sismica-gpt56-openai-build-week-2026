import { buildEventId, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchText } from "./http.js";
import {
  absoluteUrl,
  collapseSpaces,
  finiteNumber,
  isValidCoordinate,
  localDateTimeToUtc,
  stableSourceId,
  stripHtml
} from "./regionalUtils.js";
import { type SeismicProvider } from "./types.js";

export type OvsicoriMarkerRecord = {
  latitude: number;
  longitude: number;
  sourceEventId: string;
  magnitude: number | null;
  eventTimeUtc: string | null;
  depthKm: number | null;
  location: string | null;
  reviewed: boolean;
  sourceUrl: string | null;
};

function extractValue(text: string, label: string, nextLabels: string[]): string | null {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedNext = nextLabels.map((next) => next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = new RegExp(`${escapedLabel}:\\s*(.+?)(?:\\s+(?:${escapedNext}):|$)`, "i").exec(text);
  return collapseSpaces(match?.[1]);
}

export function parseOvsicoriMarkers(html: string): OvsicoriMarkerRecord[] {
  return html
    .split(/L\.marker\(/)
    .slice(1)
    .flatMap((chunk) => {
      const coordMatch = /^\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/.exec(chunk);
      if (!coordMatch) return [];

      const latitude = Number(coordMatch[1]);
      const longitude = Number(coordMatch[2]);
      const cleanedChunk = chunk.replace(/\\'/g, "'").replace(/\\"/g, '"');
      const text = collapseSpaces(stripHtml(cleanedChunk)) ?? "";
      const href = /href=["']([^"']+)["']/i.exec(cleanedChunk)?.[1] ?? null;
      const linkedEventId = href ? /[?&]eqid=([^&#"']+)/i.exec(href)?.[1] : null;
      const inlineEventId = /[?&]eqid=([^&#"']+)/i.exec(cleanedChunk)?.[1] ?? null;
      const dateMatch = /Fecha y Hora Local:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i.exec(text);
      const eventTimeUtc = dateMatch ? localDateTimeToUtc(dateMatch[1], dateMatch[2], "-06:00") : null;
      const magnitude = finiteNumber(/Magnitud:\s*([0-9.]+)/i.exec(text)?.[1]);
      const sourceEventId =
        linkedEventId ??
        inlineEventId ??
        stableSourceId([eventTimeUtc, latitude, longitude, magnitude, "OVSICORI"]);

      return [
        {
          latitude,
          longitude,
          sourceEventId,
          magnitude,
          eventTimeUtc,
          depthKm: finiteNumber(/Prof\.\s*\[km\]:\s*([0-9.]+)/i.exec(text)?.[1]),
          location: extractValue(text, "Ubicacion", [
            "Prof. [km]",
            "Coordenadas",
            "Revisado",
            "Fecha y Hora Local",
            "Magnitud"
          ]),
          reviewed: /Revisado:\s*y\b/i.test(text),
          sourceUrl: href ? absoluteUrl(env.ovsicoriMapUrl, href) : null
        }
      ];
    });
}

export function normalizeOvsicoriRecord(
  record: OvsicoriMarkerRecord,
  ingestedAt: string
): SeismicEvent | null {
  if (!record.eventTimeUtc || !isValidCoordinate(record.latitude, record.longitude)) return null;

  const location = record.location ?? "Costa Rica";

  return {
    eventId: buildEventId("OVSICORI", record.sourceEventId),
    source: "OVSICORI",
    sourceEventId: record.sourceEventId,
    title: `${record.magnitude === null ? "Sismo" : `M${record.magnitude.toFixed(1)}`} - ${location}`,
    magnitude: record.magnitude,
    magnitudeType: null,
    latitude: record.latitude,
    longitude: record.longitude,
    depthKm: record.depthKm,
    mmi: null,
    cdi: null,
    intensityText: null,
    stationCount: null,
    azimuthalGapDeg: null,
    nearestStationDeg: null,
    rmsSec: null,
    significance: null,
    feltReports: null,
    alertLevel: null,
    tsunami: false,
    networkCode: "OVSICORI",
    providerEventCode: record.sourceEventId,
    eventType: "earthquake",
    detailUrl: record.sourceUrl ?? env.ovsicoriMapUrl,
    sources: ["OVSICORI"],
    sourceCount: 1,
    eventTimeUtc: record.eventTimeUtc,
    updatedAtUtc: null,
    status: record.reviewed ? "reviewed" : "automatic",
    sourceUrl: record.sourceUrl ?? env.ovsicoriMapUrl,
    ingestedAt
  };
}

export const ovsicoriProvider: SeismicProvider = {
  code: "OVSICORI",
  async fetchEvents() {
    const html = await fetchText(env.ovsicoriMapUrl);
    const ingestedAt = new Date().toISOString();
    const cutoff = Date.now() - env.sourceWindowHours * 3_600_000;

    return parseOvsicoriMarkers(html).flatMap((record) => {
      const event = normalizeOvsicoriRecord(record, ingestedAt);
      return event && Date.parse(event.eventTimeUtc) >= cutoff ? [{ event, rawPayload: record }] : [];
    });
  }
};
