import { buildEventId, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchText } from "./http.js";
import { collapseSpaces, finiteNumber, isValidCoordinate, localDateTimeToUtc } from "./regionalUtils.js";
import { type SeismicProvider } from "./types.js";

export type IgepnCsvRecord = {
  latitude: string;
  longitude: string;
  mag: string;
  depth: string;
  time: string;
  status: string;
  id: string;
  place: string;
};

const IGEPN_SOURCE_URL = "https://www.igepn.edu.ec/mapa-ultimos-sismos";

export function parseIgepnCsv(csv: string): IgepnCsvRecord[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(1).flatMap((line) => {
    const cols = line.split(",");
    if (cols.length < 8) return [];
    return [
      {
        latitude: cols[0],
        longitude: cols[1],
        mag: cols[2],
        depth: cols[3],
        time: cols[4],
        status: cols[5],
        id: cols[6],
        place: cols.slice(7).join(",")
      }
    ];
  });
}

export function normalizeIgepnRecord(record: IgepnCsvRecord, ingestedAt: string): SeismicEvent | null {
  const latitude = finiteNumber(record.latitude);
  const longitude = finiteNumber(record.longitude);
  const magnitude = finiteNumber(record.mag);
  const depthKm = finiteNumber(record.depth);
  const place = collapseSpaces(record.place);
  const sourceEventId = collapseSpaces(record.id);
  const timeMatch = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2}:\d{2})$/.exec(record.time.trim());
  const eventTimeUtc = timeMatch
    ? localDateTimeToUtc(`${timeMatch[1]}-${timeMatch[2]}-${timeMatch[3]}`, timeMatch[4], "-05:00")
    : null;

  if (!sourceEventId || !eventTimeUtc || !isValidCoordinate(latitude, longitude)) return null;

  return {
    eventId: buildEventId("IGEPN", sourceEventId),
    source: "IGEPN",
    sourceEventId,
    title: `${magnitude === null ? "Sismo" : `M${magnitude.toFixed(1)}`} - ${place ?? "Ecuador"}`,
    magnitude,
    magnitudeType: null,
    latitude: latitude!,
    longitude: longitude!,
    depthKm,
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
    networkCode: "IGEPN",
    providerEventCode: sourceEventId,
    eventType: "earthquake",
    detailUrl: IGEPN_SOURCE_URL,
    sources: ["IGEPN"],
    sourceCount: 1,
    eventTimeUtc,
    updatedAtUtc: null,
    status: record.status.trim().toLowerCase() === "confirmed" ? "official" : "automatic",
    sourceUrl: IGEPN_SOURCE_URL,
    ingestedAt
  };
}

export const igepnProvider: SeismicProvider = {
  code: "IGEPN",
  async fetchEvents() {
    const csv = await fetchText(env.igepnEventsCsvUrl);
    const ingestedAt = new Date().toISOString();
    const cutoff = Date.now() - env.sourceWindowHours * 3_600_000;

    return parseIgepnCsv(csv).flatMap((record) => {
      const event = normalizeIgepnRecord(record, ingestedAt);
      return event && Date.parse(event.eventTimeUtc) >= cutoff ? [{ event, rawPayload: record }] : [];
    });
  }
};
