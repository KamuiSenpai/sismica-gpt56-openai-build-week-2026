import { buildEventId, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchText } from "./http.js";
import { type SeismicProvider } from "./types.js";

export type FdsnTextRecord = Record<string, string>;

function finiteNumber(value: string | undefined): number | null {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function utcIso(value: string | undefined): string | null {
  if (!value) return null;
  const explicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const date = new Date(explicitZone ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseFdsnText(payload: string): FdsnTextRecord[] {
  const lines = payload.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  // Cabecera tolerante a espacios alrededor de las barras (RENASS: "# EventID | Time |").
  const headerIndex = lines.findIndex((line) => /^#?\s*EventID\s*\|/i.test(line));
  if (headerIndex < 0) return [];

  const headers = lines[headerIndex].replace(/^#/, "").split("|").map((header) => header.trim());
  return lines.slice(headerIndex + 1).flatMap((line) => {
    if (line.startsWith("#")) return [];
    const values = line.split("|").map((value) => value.trim());
    if (values.length < headers.length) return [];
    return [Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))];
  });
}

export function normalizeGeofonRecord(record: FdsnTextRecord, ingestedAt: string): SeismicEvent | null {
  const sourceEventId = record.EventID?.trim();
  const eventTimeUtc = utcIso(record.Time);
  const latitude = finiteNumber(record.Latitude);
  const longitude = finiteNumber(record.Longitude);
  if (!sourceEventId || !eventTimeUtc || latitude === null || longitude === null) return null;

  const magnitude = finiteNumber(record.Magnitude);
  const location = record.EventLocationName?.trim() || "Region sin nombre";
  return {
    eventId: buildEventId("GEOFON", sourceEventId),
    source: "GEOFON",
    sourceEventId,
    title: `${magnitude === null ? "Sismo" : `M${magnitude.toFixed(1)}`} - ${location}`,
    magnitude,
    magnitudeType: record.MagType?.trim() || null,
    latitude,
    longitude,
    depthKm: finiteNumber(record["Depth/km"]),
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
    networkCode: record.Author?.trim() || record.Contributor?.trim() || "GFZ",
    providerEventCode: record.ContributorID?.trim() || sourceEventId,
    eventType: record.EventType?.trim() || "earthquake",
    detailUrl: null,
    sources: ["GEOFON"],
    sourceCount: 1,
    eventTimeUtc,
    updatedAtUtc: null,
    status: "published",
    sourceUrl: `${env.geofonFdsnUrl}?eventid=${encodeURIComponent(sourceEventId)}`,
    ingestedAt
  };
}

export const geofonProvider: SeismicProvider = {
  code: "GEOFON",
  async fetchEvents() {
    const endtime = new Date();
    const starttime = new Date(endtime.getTime() - env.sourceWindowHours * 3_600_000);
    const params = new URLSearchParams({
      format: "text",
      starttime: starttime.toISOString(),
      endtime: endtime.toISOString(),
      minmagnitude: "2.5",
      limit: "1000",
      orderby: "time"
    });
    const payload = await fetchText(`${env.geofonFdsnUrl}?${params.toString()}`);
    const ingestedAt = new Date().toISOString();
    return parseFdsnText(payload).flatMap((record) => {
      const event = normalizeGeofonRecord(record, ingestedAt);
      return event ? [{ event, rawPayload: record }] : [];
    });
  }
};
