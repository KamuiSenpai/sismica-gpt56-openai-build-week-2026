import { buildEventId, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchJson } from "./http.js";
import { assertShape, igpResponseSchema } from "./schemas.js";
import { type SeismicProvider } from "./types.js";

export type IgpRecord = {
  codigo?: string;
  fecha_utc?: string;
  hora_utc?: string;
  latitud?: string;
  longitud?: string;
  magnitud?: string;
  profundidad?: number | string;
  referencia?: string;
  tipomagnitud?: string;
  updatedAt?: string;
  createdAt?: string;
  intensidad?: string | null;
  publicado?: string;
};

function finiteFromString(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function combineUtcDateAndTime(dateValue: string, timeValue: string): string | null {
  const date = new Date(dateValue);
  const time = new Date(timeValue);
  if (Number.isNaN(date.getTime()) || Number.isNaN(time.getTime())) return null;
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    time.getUTCHours(),
    time.getUTCMinutes(),
    time.getUTCSeconds()
  )).toISOString();
}

export function normalizeIgpRecord(record: IgpRecord, ingestedAt: string): SeismicEvent | null {
  const sourceEventId = record.codigo;
  const latitude = finiteFromString(record.latitud);
  const longitude = finiteFromString(record.longitud);
  const eventTimeUtc = record.fecha_utc && record.hora_utc
    ? combineUtcDateAndTime(record.fecha_utc, record.hora_utc)
    : null;
  if (!sourceEventId || latitude === null || longitude === null || !eventTimeUtc) return null;

  const magnitude = finiteFromString(record.magnitud);
  return {
    eventId: buildEventId("IGP", sourceEventId),
    source: "IGP",
    sourceEventId,
    title: `${magnitude === null ? "Sismo" : `M${magnitude.toFixed(1)}`} - ${record.referencia ?? "Peru"}`,
    magnitude,
    magnitudeType: record.tipomagnitud || "Mw",
    latitude,
    longitude,
    depthKm: finiteFromString(record.profundidad),
    mmi: null,
    cdi: null,
    intensityText: record.intensidad ?? null,
    stationCount: null,
    azimuthalGapDeg: null,
    nearestStationDeg: null,
    rmsSec: null,
    significance: null,
    feltReports: null,
    alertLevel: null,
    tsunami: false,
    networkCode: "IGP/CENSIS",
    providerEventCode: sourceEventId,
    eventType: "earthquake",
    detailUrl: null,
    sources: ["IGP"],
    sourceCount: 1,
    eventTimeUtc,
    updatedAtUtc: record.updatedAt ? new Date(record.updatedAt).toISOString() : null,
    status: record.publicado === "1" ? "official" : "preliminary",
    sourceUrl: `https://ultimosismo.igp.gob.pe/evento/${encodeURIComponent(sourceEventId)}`,
    ingestedAt
  };
}

export const igpProvider: SeismicProvider = {
  code: "IGP",
  async fetchEvents() {
    const year = new Date().getUTCFullYear();
    const url = env.igpFeedUrlTemplate.replace("{year}", String(year));
    const records = await fetchJson<IgpRecord[]>(url);
    assertShape(igpResponseSchema, records, "IGP");
    const ingestedAt = new Date().toISOString();
    const cutoff = Date.now() - env.sourceWindowHours * 3_600_000;
    return records.flatMap((record) => {
      const event = normalizeIgpRecord(record, ingestedAt);
      return event && Date.parse(event.eventTimeUtc) >= cutoff ? [{ event, rawPayload: record }] : [];
    });
  }
};
