import { buildEventId, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchText } from "./http.js";
import { parseFdsnText, type FdsnTextRecord } from "./geofonProvider.js";
import { type SeismicProvider } from "./types.js";

const INGV_REGION_BOUNDS = { minLat: 34, maxLat: 48.5, minLon: 5, maxLon: 20.5 };
const DAY_MS = 24 * 3_600_000;

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

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function endOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 23, 59, 59));
}

export function formatIngvUtcDateTime(value: Date): string {
  return [
    `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`,
    `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`
  ].join("T");
}

export function buildIngvQueryWindows(
  referenceNow: Date,
  sourceWindowHours: number
): Array<{
  starttime: string;
  endtime: string;
}> {
  const cutoff = new Date(referenceNow.getTime() - sourceWindowHours * 3_600_000);
  const windows: Array<{ starttime: string; endtime: string }> = [];
  for (
    let cursor = startOfUtcDay(cutoff);
    cursor.getTime() <= startOfUtcDay(referenceNow).getTime();
    cursor = new Date(cursor.getTime() + DAY_MS)
  ) {
    windows.push({
      starttime: formatIngvUtcDateTime(startOfUtcDay(cursor)),
      endtime: formatIngvUtcDateTime(endOfUtcDay(cursor))
    });
  }
  return windows;
}

function withinIngvRegion(latitude: number, longitude: number): boolean {
  return (
    latitude >= INGV_REGION_BOUNDS.minLat &&
    latitude <= INGV_REGION_BOUNDS.maxLat &&
    longitude >= INGV_REGION_BOUNDS.minLon &&
    longitude <= INGV_REGION_BOUNDS.maxLon
  );
}

export function normalizeIngvRecord(record: FdsnTextRecord, ingestedAt: string): SeismicEvent | null {
  const sourceEventId = record.EventID?.trim();
  const eventTimeUtc = utcIso(record.Time);
  const latitude = finiteNumber(record.Latitude);
  const longitude = finiteNumber(record.Longitude);
  if (!sourceEventId || !eventTimeUtc || latitude === null || longitude === null) return null;
  if (!withinIngvRegion(latitude, longitude)) return null;

  const magnitude = finiteNumber(record.Magnitude);
  const location = record.EventLocationName?.trim() || "Italia";
  const detailUrl = `https://terremoti.ingv.it/event/${encodeURIComponent(sourceEventId)}?timezone=UTC`;

  return {
    eventId: buildEventId("INGV", sourceEventId),
    source: "INGV",
    sourceEventId,
    title: `${magnitude === null ? "Sismo" : `M${magnitude.toFixed(1)}`} - ${location}`,
    magnitude,
    magnitudeType: record.MagType?.trim() || null,
    latitude,
    longitude,
    depthKm: finiteNumber(record["Depth/Km"]),
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
    networkCode: record.Author?.trim() || "INGV",
    providerEventCode: record.ContributorID?.trim() || sourceEventId,
    eventType: record.EventType?.trim() || "earthquake",
    detailUrl,
    sources: ["INGV"],
    sourceCount: 1,
    eventTimeUtc,
    updatedAtUtc: null,
    status: "official",
    sourceUrl: detailUrl,
    ingestedAt
  };
}

async function fetchIngvWindow(starttime: string, endtime: string): Promise<string> {
  const attempts: Array<string | null> = [null, "100", "1000"];
  let lastError: unknown = null;

  for (const limit of attempts) {
    try {
      const params = new URLSearchParams({
        format: "text",
        starttime,
        endtime,
        orderby: "time"
      });
      if (limit) params.set("limit", limit);
      return await fetchText(`${env.ingvFdsnUrl}?${params.toString()}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("INGV: no se pudo consultar la ventana oficial");
}

export const ingvProvider: SeismicProvider = {
  code: "INGV",
  async fetchEvents() {
    const referenceNow = new Date();
    const cutoff = referenceNow.getTime() - env.sourceWindowHours * 3_600_000;
    const ingestedAt = referenceNow.toISOString();
    const windows = buildIngvQueryWindows(referenceNow, env.sourceWindowHours);
    const payloads = await Promise.all(
      windows.map(({ starttime, endtime }) => fetchIngvWindow(starttime, endtime))
    );

    const seen = new Set<string>();
    return payloads
      .flatMap((payload) => parseFdsnText(payload))
      .flatMap((record) => {
        const event = normalizeIngvRecord(record, ingestedAt);
        if (!event || Date.parse(event.eventTimeUtc) < cutoff || seen.has(event.sourceEventId)) {
          return [];
        }
        seen.add(event.sourceEventId);
        return [{ event, rawPayload: record }];
      })
      .sort((left, right) => Date.parse(right.event.eventTimeUtc) - Date.parse(left.event.eventTimeUtc));
  }
};
