import { buildEventId, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchText } from "./http.js";
import { type SeismicProvider } from "./types.js";

type IgnFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    evid?: string;
    mag?: string;
    magtype?: string;
    intensidad?: string;
    depth?: string;
    fecha?: string;
    loc?: string;
  };
};

type IgnFeatureCollection = { features?: IgnFeature[] };

function finiteNumber(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseIgnUtcDateTime(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function extractNamedJsonObject(payload: string, variableName: string): unknown {
  const marker = `var ${variableName}`;
  const start = payload.indexOf(marker);
  if (start < 0) {
    throw new Error(`IGN: variable ${variableName} no encontrada en el recurso oficial`);
  }

  const braceStart = payload.indexOf("{", start);
  if (braceStart < 0) {
    throw new Error(`IGN: objeto JSON de ${variableName} no encontrado`);
  }

  let depth = 0;
  let inString = false;
  let stringQuote = "";
  let escaped = false;

  for (let index = braceStart; index < payload.length; index += 1) {
    const char = payload[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(payload.slice(braceStart, index + 1));
      }
    }
  }

  throw new Error(`IGN: no se pudo cerrar el objeto ${variableName}`);
}

function selectIgnCollectionName(windowHours: number): "dias3" | "dias10" | "dias30" {
  if (windowHours <= 72) return "dias3";
  if (windowHours <= 240) return "dias10";
  return "dias30";
}

export function normalizeIgnFeature(feature: IgnFeature, ingestedAt: string): SeismicEvent | null {
  const props = feature.properties;
  const sourceEventId = props?.evid?.trim();
  const coordinates = feature.geometry?.coordinates;
  const eventTimeUtc = parseIgnUtcDateTime(props?.fecha);
  const longitude = coordinates?.[0];
  const latitude = coordinates?.[1];

  if (
    !sourceEventId ||
    !eventTimeUtc ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    typeof latitude !== "number" ||
    !Number.isFinite(latitude)
  ) {
    return null;
  }

  const magnitude = finiteNumber(props?.mag);
  const location = props?.loc?.trim() || "Espana";
  const detailUrl = `https://www.ign.es/web/ign/portal/ultimos-terremotos/-/ultimos-terremotos/getDetails?evid=${encodeURIComponent(
    sourceEventId
  )}`;

  return {
    eventId: buildEventId("IGN", sourceEventId),
    source: "IGN",
    sourceEventId,
    title: `${magnitude === null ? "Sismo" : `M${magnitude.toFixed(1)}`} - ${location}`,
    magnitude,
    magnitudeType: trimToNull(props?.magtype),
    latitude,
    longitude,
    depthKm: finiteNumber(props?.depth),
    mmi: null,
    cdi: null,
    intensityText: trimToNull(props?.intensidad),
    stationCount: null,
    azimuthalGapDeg: null,
    nearestStationDeg: null,
    rmsSec: null,
    significance: null,
    feltReports: null,
    alertLevel: null,
    tsunami: false,
    networkCode: "IGN",
    providerEventCode: sourceEventId,
    eventType: "earthquake",
    detailUrl,
    sources: ["IGN"],
    sourceCount: 1,
    eventTimeUtc,
    updatedAtUtc: null,
    status: "official",
    sourceUrl: detailUrl,
    ingestedAt
  };
}

export const ignProvider: SeismicProvider = {
  code: "IGN",
  async fetchEvents() {
    const payload = await fetchText(env.ignEarthquakesJsUrl);
    const collectionName = selectIgnCollectionName(env.sourceWindowHours);
    const collection = extractNamedJsonObject(payload, collectionName) as IgnFeatureCollection;
    const ingestedAt = new Date().toISOString();
    const cutoff = Date.now() - env.sourceWindowHours * 3_600_000;

    return (collection.features ?? []).flatMap((feature) => {
      const event = normalizeIgnFeature(feature, ingestedAt);
      return event && Date.parse(event.eventTimeUtc) >= cutoff ? [{ event, rawPayload: feature }] : [];
    });
  }
};
