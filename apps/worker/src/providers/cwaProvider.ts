import { createHash } from "node:crypto";

import { buildEventId, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchJson } from "./http.js";
import { assertShape, cwaResponseSchema } from "./schemas.js";
import { type SeismicProvider } from "./types.js";

export type CwaStation = {
  StationName?: string;
  StationID?: string;
  SeismicIntensity?: string;
  StationLatitude?: number;
  StationLongitude?: number;
};

export type CwaShakingArea = {
  AreaDesc?: string;
  CountyName?: string;
  InfoStatus?: string;
  AreaIntensity?: string;
  EqStation?: CwaStation[];
};

export type CwaRecord = {
  IssueTime?: string;
  EarthquakeNo?: number;
  ReportType?: string;
  ReportColor?: string;
  ReportContent?: string;
  ReportImageURI?: string;
  ReportRemark?: string;
  Web?: string;
  EarthquakeInfo?: {
    OriginTime?: string;
    Source?: string;
    FocalDepth?: number;
    Epicenter?: {
      Location?: string;
      EpicenterLatitude?: number;
      EpicenterLongitude?: number;
    };
    EarthquakeMagnitude?: {
      MagnitudeType?: string;
      MagnitudeValue?: number;
    };
  };
  Intensity?: {
    ShakingArea?: CwaShakingArea[];
  };
};

type CwaResponse = {
  success: string;
  records: {
    Earthquake: CwaRecord[];
  };
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function extractCwaSlug(url: string | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;
  const match = /\/details\/([^/?#]+)/.exec(value);
  return match?.[1] ?? null;
}

export function buildCwaSourceEventId(record: CwaRecord): string | null {
  const slug = extractCwaSlug(record.Web);
  if (slug) return slug;

  const eventTimeUtc = validIsoDate(record.EarthquakeInfo?.OriginTime);
  const latitude = finiteNumber(record.EarthquakeInfo?.Epicenter?.EpicenterLatitude);
  const longitude = finiteNumber(record.EarthquakeInfo?.Epicenter?.EpicenterLongitude);
  const magnitude = finiteNumber(record.EarthquakeInfo?.EarthquakeMagnitude?.MagnitudeValue);
  if (!eventTimeUtc || latitude === null || longitude === null || magnitude === null) return null;

  const identity = [eventTimeUtc, latitude.toFixed(3), longitude.toFixed(3), magnitude.toFixed(1)].join("|");
  return createHash("sha256").update(identity).digest("hex").slice(0, 20);
}

function intensityRank(value: string | undefined): number {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return -1;
  const aliases: Record<string, number> = {
    "1": 10,
    "2": 20,
    "3": 30,
    "4": 40,
    "5": 50,
    "5 weak": 51,
    "5 lower": 51,
    "5-": 51,
    "5弱": 51,
    "5 strong": 52,
    "5 upper": 52,
    "5+": 52,
    "5強": 52,
    "6 weak": 61,
    "6 lower": 61,
    "6-": 61,
    "6弱": 61,
    "6 strong": 62,
    "6 upper": 62,
    "6+": 62,
    "6強": 62,
    "7": 70
  };
  if (normalized in aliases) return aliases[normalized];
  const plain = Number.parseFloat(normalized);
  return Number.isFinite(plain) ? plain * 10 : -1;
}

function maxCwaIntensity(shakingAreas: CwaShakingArea[] | undefined): string | null {
  if (!shakingAreas?.length) return null;
  let best: string | null = null;
  let bestRank = -1;
  for (const area of shakingAreas) {
    const intensity = area.AreaIntensity?.trim();
    const rank = intensityRank(intensity);
    if (rank > bestRank && intensity) {
      bestRank = rank;
      best = intensity;
    }
  }
  return best ? `CWA ${best}` : null;
}

function countStations(shakingAreas: CwaShakingArea[] | undefined): number | null {
  if (!shakingAreas?.length) return null;
  const stations = new Set<string>();
  for (const area of shakingAreas) {
    for (const station of area.EqStation ?? []) {
      const key =
        station.StationID?.trim() ||
        `${station.StationName ?? "station"}|${station.StationLatitude ?? "?"}|${station.StationLongitude ?? "?"}`;
      stations.add(key);
    }
  }
  return stations.size || null;
}

export function normalizeCwaRecord(record: CwaRecord, ingestedAt: string): SeismicEvent | null {
  const sourceEventId = buildCwaSourceEventId(record);
  const eventTimeUtc = validIsoDate(record.EarthquakeInfo?.OriginTime);
  const updatedAtUtc = validIsoDate(record.IssueTime);
  const latitude = finiteNumber(record.EarthquakeInfo?.Epicenter?.EpicenterLatitude);
  const longitude = finiteNumber(record.EarthquakeInfo?.Epicenter?.EpicenterLongitude);
  const magnitude = finiteNumber(record.EarthquakeInfo?.EarthquakeMagnitude?.MagnitudeValue);
  const depthKm = finiteNumber(record.EarthquakeInfo?.FocalDepth);
  if (
    !sourceEventId ||
    !eventTimeUtc ||
    latitude === null ||
    longitude === null ||
    magnitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  const location = record.EarthquakeInfo?.Epicenter?.Location?.trim() || "Taiwan";
  const sourceUrl = record.Web?.trim() || "https://scweb.cwa.gov.tw/en-US/earthquake";
  const shakingAreas = record.Intensity?.ShakingArea;

  return {
    eventId: buildEventId("CWA", sourceEventId),
    source: "CWA",
    sourceEventId,
    title: `M${magnitude.toFixed(1)} - ${location}`,
    magnitude,
    magnitudeType: record.EarthquakeInfo?.EarthquakeMagnitude?.MagnitudeType?.trim() || null,
    latitude,
    longitude,
    depthKm,
    mmi: null,
    cdi: null,
    intensityText: maxCwaIntensity(shakingAreas),
    stationCount: countStations(shakingAreas),
    azimuthalGapDeg: null,
    nearestStationDeg: null,
    rmsSec: null,
    significance: null,
    feltReports: null,
    alertLevel: null,
    tsunami: false,
    networkCode: "CWA",
    providerEventCode: String(record.EarthquakeNo ?? sourceEventId),
    eventType: "earthquake",
    detailUrl: sourceUrl,
    sources: ["CWA"],
    sourceCount: 1,
    eventTimeUtc,
    updatedAtUtc,
    status: "official",
    sourceUrl,
    ingestedAt
  };
}

export const cwaProvider: SeismicProvider = {
  code: "CWA",
  async fetchEvents() {
    if (!env.cwaAuthorization) {
      throw new Error("CWA: falta CWA_AUTHORIZATION");
    }

    const payload = await fetchJson<CwaResponse>(env.cwaEarthquakeUrl, "application/json", {
      Authorization: env.cwaAuthorization
    });
    assertShape(cwaResponseSchema, payload, "CWA");

    const cutoff = Date.now() - env.sourceWindowHours * 3_600_000;
    const ingestedAt = new Date().toISOString();
    return payload.records.Earthquake.flatMap((record) => {
      const event = normalizeCwaRecord(record, ingestedAt);
      return event && Date.parse(event.eventTimeUtc) >= cutoff ? [{ event, rawPayload: record }] : [];
    });
  }
};
