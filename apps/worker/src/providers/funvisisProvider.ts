import { createHash } from "node:crypto";

import { buildEventId, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchJson } from "./http.js";
import { assertShape, funvisisResponseSchema } from "./schemas.js";
import { type SeismicProvider } from "./types.js";

export type FunvisisFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    phoneFormatted?: string;
    phone?: string;
    address?: string;
    city?: string;
    postalCode?: string;
    state?: string;
    lat?: string;
    long?: string;
  };
};

type FunvisisResponse = { features?: FunvisisFeature[] };

function finiteFromString(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^0-9+.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseVenezuelaLocalTime(dateValue: string, timeValue: string): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dateValue);
  const time = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeValue);
  if (!match || !time) return null;
  const [, day, month, year] = match;
  const [, hour, minute, second = "00"] = time;
  return new Date(Date.UTC(+year, +month - 1, +day, +hour + 4, +minute, +second)).toISOString();
}

export function normalizeFunvisisFeature(feature: FunvisisFeature, ingestedAt: string): SeismicEvent | null {
  const props = feature.properties;
  const longitude = feature.geometry?.coordinates?.[0] ?? finiteFromString(props?.long);
  const latitude = feature.geometry?.coordinates?.[1] ?? finiteFromString(props?.lat);
  const eventTimeUtc = props?.postalCode && props.city
    ? parseVenezuelaLocalTime(props.postalCode, props.city)
    : null;
  if (longitude === null || longitude === undefined || latitude === null || latitude === undefined || !eventTimeUtc) {
    return null;
  }

  const magnitude = finiteFromString(props?.phone);
  const depthKm = finiteFromString(props?.phoneFormatted ?? props?.state);
  const identity = [eventTimeUtc, latitude.toFixed(3), longitude.toFixed(3), magnitude?.toFixed(1) ?? "na"].join("|");
  const sourceEventId = createHash("sha256").update(identity).digest("hex").slice(0, 20);

  return {
    eventId: buildEventId("FUNVISIS", sourceEventId),
    source: "FUNVISIS",
    sourceEventId,
    title: `${magnitude === null ? "Sismo" : `M${magnitude.toFixed(1)}`} - ${props?.address?.replace(/\s+/g, " ").trim() ?? "Venezuela"}`,
    magnitude,
    magnitudeType: null,
    latitude,
    longitude,
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
    networkCode: "FUNVISIS",
    providerEventCode: sourceEventId,
    eventType: "earthquake",
    detailUrl: null,
    sources: ["FUNVISIS"],
    sourceCount: 1,
    eventTimeUtc,
    updatedAtUtc: null,
    status: "official",
    sourceUrl: "http://www.funvisis.gob.ve/",
    ingestedAt
  };
}

export const funvisisProvider: SeismicProvider = {
  code: "FUNVISIS",
  async fetchEvents() {
    const payload = await fetchJson<FunvisisResponse>(env.funvisisFeedUrl);
    assertShape(funvisisResponseSchema, payload, "FUNVISIS");
    const ingestedAt = new Date().toISOString();
    return (payload.features ?? []).flatMap((feature) => {
      const event = normalizeFunvisisFeature(feature, ingestedAt);
      return event ? [{ event, rawPayload: feature }] : [];
    });
  }
};
