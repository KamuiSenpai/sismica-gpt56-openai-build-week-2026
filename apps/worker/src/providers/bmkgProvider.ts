import { createHash } from "node:crypto";

import { buildEventId, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchJson } from "./http.js";
import { assertShape, bmkgResponseSchema } from "./schemas.js";
import { type SeismicProvider } from "./types.js";
import { normalizeSourceLocationText } from "../services/locationTextNormalizer.js";

export type BmkgRecord = {
  Tanggal?: string;
  Jam?: string;
  DateTime?: string;
  Coordinates?: string;
  Lintang?: string;
  Bujur?: string;
  Magnitude?: string;
  Kedalaman?: string;
  Wilayah?: string;
  Potensi?: string;
  Dirasakan?: string;
};

type BmkgResponse = { Infogempa: { gempa: BmkgRecord[] } };

function finiteNumber(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^0-9+.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCoordinates(value: string | undefined): { latitude: number; longitude: number } | null {
  if (!value) return null;
  const [latitudeValue, longitudeValue] = value.split(",").map((part) => Number.parseFloat(part.trim()));
  if (
    !Number.isFinite(latitudeValue) ||
    !Number.isFinite(longitudeValue) ||
    latitudeValue < -90 ||
    latitudeValue > 90 ||
    longitudeValue < -180 ||
    longitudeValue > 180
  ) {
    return null;
  }
  return { latitude: latitudeValue, longitude: longitudeValue };
}

function hasTsunamiPotential(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLocaleLowerCase("id-ID").replace(/\s+/g, " ").trim();
  if (/tidak\s+berpotensi\s+tsunami/.test(normalized)) return false;
  return /berpotensi\s+tsunami/.test(normalized);
}

export function buildBmkgSourceEventId(eventTimeUtc: string, latitude: number, longitude: number): string {
  const identity = [eventTimeUtc, latitude.toFixed(3), longitude.toFixed(3)].join("|");
  return createHash("sha256").update(identity).digest("hex").slice(0, 20);
}

export function normalizeBmkgRecord(record: BmkgRecord, ingestedAt: string): SeismicEvent | null {
  const eventTime = record.DateTime ? new Date(record.DateTime) : null;
  const coordinates = parseCoordinates(record.Coordinates);
  if (!eventTime || Number.isNaN(eventTime.getTime()) || !coordinates) return null;

  const eventTimeUtc = eventTime.toISOString();
  const sourceEventId = buildBmkgSourceEventId(eventTimeUtc, coordinates.latitude, coordinates.longitude);
  const magnitude = finiteNumber(record.Magnitude);
  const rawRegion = record.Wilayah?.replace(/\s+/g, " ").trim() || "Indonesia";
  const region = normalizeSourceLocationText("BMKG", rawRegion);

  return {
    eventId: buildEventId("BMKG", sourceEventId),
    source: "BMKG",
    sourceEventId,
    title: `${magnitude === null ? "Sismo" : `M${magnitude.toFixed(1)}`} - ${region}`,
    magnitude,
    magnitudeType: null,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    depthKm: finiteNumber(record.Kedalaman),
    mmi: null,
    cdi: null,
    intensityText: record.Dirasakan?.replace(/\s+/g, " ").trim() || null,
    stationCount: null,
    azimuthalGapDeg: null,
    nearestStationDeg: null,
    rmsSec: null,
    significance: null,
    feltReports: null,
    alertLevel: null,
    tsunami: hasTsunamiPotential(record.Potensi),
    networkCode: "BMKG",
    providerEventCode: sourceEventId,
    eventType: "earthquake",
    detailUrl: null,
    sources: ["BMKG"],
    sourceCount: 1,
    eventTimeUtc,
    updatedAtUtc: null,
    status: "official",
    sourceUrl: "https://data.bmkg.go.id/gempabumi/",
    ingestedAt
  };
}

export function mergeBmkgRecords(records: BmkgRecord[]): BmkgRecord[] {
  const merged = new Map<string, BmkgRecord>();
  for (const record of records) {
    const event = normalizeBmkgRecord(record, "1970-01-01T00:00:00.000Z");
    if (!event) continue;
    const previous = merged.get(event.sourceEventId);
    merged.set(
      event.sourceEventId,
      previous
        ? {
            ...previous,
            ...record,
            Potensi: record.Potensi || previous.Potensi,
            Dirasakan: record.Dirasakan || previous.Dirasakan
          }
        : record
    );
  }
  return [...merged.values()];
}

export const bmkgProvider: SeismicProvider = {
  code: "BMKG",
  async fetchEvents() {
    const [latest, felt] = await Promise.all([
      fetchJson<BmkgResponse>(env.bmkgLatestUrl),
      fetchJson<BmkgResponse>(env.bmkgFeltUrl)
    ]);
    assertShape(bmkgResponseSchema, latest, "BMKG M5+");
    assertShape(bmkgResponseSchema, felt, "BMKG felt");

    const cutoff = Date.now() - env.sourceWindowHours * 3_600_000;
    const ingestedAt = new Date().toISOString();
    return mergeBmkgRecords([...latest.Infogempa.gempa, ...felt.Infogempa.gempa]).flatMap((record) => {
      const event = normalizeBmkgRecord(record, ingestedAt);
      return event && Date.parse(event.eventTimeUtc) >= cutoff ? [{ event, rawPayload: record }] : [];
    });
  }
};
