import { buildEventId, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchText } from "./http.js";
import {
  collapseSpaces,
  extractTableCells,
  finiteNumber,
  isValidCoordinate,
  localDateTimeToUtc,
  stableSourceId
} from "./regionalUtils.js";
import { type SeismicProvider } from "./types.js";

export type MarnHtmlRecord = {
  date: string;
  time: string;
  latitude: string;
  longitude: string;
  location: string;
  intensity: string;
  magnitude: string;
  depthKm: string;
};

export function parseMarnHtml(html: string): MarnHtmlRecord[] {
  return [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].flatMap((match) => {
    const cells = extractTableCells(match[0]);
    if (cells.length < 9 || !/^\d{4}-\d{2}-\d{2}$/.test(cells[1])) return [];
    return [
      {
        date: cells[1],
        time: cells[2],
        latitude: cells[3],
        longitude: cells[4],
        location: cells[5],
        intensity: cells[6],
        magnitude: cells[7],
        depthKm: cells[8]
      }
    ];
  });
}

export function normalizeMarnRecord(record: MarnHtmlRecord, ingestedAt: string): SeismicEvent | null {
  const eventTimeUtc = localDateTimeToUtc(record.date, record.time, "-06:00");
  const latitude = finiteNumber(record.latitude);
  const longitude = finiteNumber(record.longitude);
  const magnitude = finiteNumber(record.magnitude);
  const depthKm = finiteNumber(record.depthKm);
  const location = collapseSpaces(record.location) ?? "El Salvador";
  const intensityText = collapseSpaces(record.intensity);
  const sourceEventId = stableSourceId([eventTimeUtc, latitude, longitude, magnitude, location]);

  if (!eventTimeUtc || !isValidCoordinate(latitude, longitude)) return null;

  return {
    eventId: buildEventId("MARN", sourceEventId),
    source: "MARN",
    sourceEventId,
    title: `${magnitude === null ? "Sismo" : `M${magnitude.toFixed(1)}`} - ${location}`,
    magnitude,
    magnitudeType: null,
    latitude: latitude!,
    longitude: longitude!,
    depthKm,
    mmi: null,
    cdi: null,
    intensityText,
    stationCount: null,
    azimuthalGapDeg: null,
    nearestStationDeg: null,
    rmsSec: null,
    significance: null,
    feltReports: null,
    alertLevel: null,
    tsunami: false,
    networkCode: "MARN",
    providerEventCode: sourceEventId,
    eventType: "earthquake",
    detailUrl: env.marnLastTenUrl,
    sources: ["MARN"],
    sourceCount: 1,
    eventTimeUtc,
    updatedAtUtc: null,
    status: "official",
    sourceUrl: env.marnLastTenUrl,
    ingestedAt
  };
}

export const marnProvider: SeismicProvider = {
  code: "MARN",
  async fetchEvents() {
    const html = await fetchText(env.marnLastTenUrl);
    const ingestedAt = new Date().toISOString();
    const cutoff = Date.now() - env.sourceWindowHours * 3_600_000;

    return parseMarnHtml(html).flatMap((record) => {
      const event = normalizeMarnRecord(record, ingestedAt);
      return event && Date.parse(event.eventTimeUtc) >= cutoff ? [{ event, rawPayload: record }] : [];
    });
  }
};
