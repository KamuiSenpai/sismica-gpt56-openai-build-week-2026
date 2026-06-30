import { buildEventId, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchJson } from "./http.js";
import { assertShape, sgcResponseSchema } from "./schemas.js";
import { type SeismicProvider } from "./types.js";

type SgcFeature = {
  id?: string;
  geometry?: { coordinates?: [number, number, number?] };
  properties?: {
    agency?: string;
    cdi?: number;
    felt?: number;
    gap?: number;
    mag?: number;
    magType?: string;
    mmi?: number;
    nst?: number;
    place?: string;
    rms?: number;
    status?: string;
    type?: string;
    updated?: string;
    utcTime?: string;
  };
};

type SgcResponse = { features?: SgcFeature[] };

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUtcDateTime(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(`${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseColombiaLocalDateTime(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(`${normalized}-05:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeSgcStatus(status: string | undefined): SeismicEvent["status"] {
  switch (status?.trim().toLowerCase()) {
    case "manual":
      return "official";
    case "automatic":
      return "automatic";
    default:
      return status?.trim().toLowerCase() ?? "official";
  }
}

function extractSgcCoordinates(
  feature: SgcFeature
): { latitude: number; longitude: number; depthKm: number | null } | null {
  const coordinates = feature.geometry?.coordinates;
  if (!coordinates || coordinates.length < 2) return null;

  const [first, second, depth] = coordinates;
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  // El feed oficial SGC expone [lat, lon, depth] en la muestra validada,
  // aunque el contenedor se declare como GeoJSON.
  const useLatLonOrder = Math.abs(first) <= 25 && Math.abs(second) >= 30;
  const latitude = useLatLonOrder ? first : second;
  const longitude = useLatLonOrder ? second : first;

  return { latitude, longitude, depthKm: finiteNumber(depth) };
}

export function normalizeSgcFeature(feature: SgcFeature, ingestedAt: string): SeismicEvent | null {
  const props = feature.properties;
  const sourceEventId = feature.id?.trim();
  const eventTimeUtc = parseUtcDateTime(props?.utcTime);
  const geometry = extractSgcCoordinates(feature);
  if (!sourceEventId || !eventTimeUtc || !geometry) return null;

  const magnitude = finiteNumber(props?.mag);
  const place = props?.place?.trim() || "Colombia";
  const mmi = finiteNumber(props?.mmi);
  const feltReports = finiteNumber(props?.felt);
  const detailUrl = `https://www.sgc.gov.co/detallesismo/${encodeURIComponent(sourceEventId)}`;

  return {
    eventId: buildEventId("SGC", sourceEventId),
    source: "SGC",
    sourceEventId,
    title: `${magnitude === null ? "Sismo" : `M${magnitude.toFixed(1)}`} - ${place}`,
    magnitude,
    magnitudeType: props?.magType?.trim() || null,
    latitude: geometry.latitude,
    longitude: geometry.longitude,
    depthKm: geometry.depthKm,
    mmi: mmi && mmi > 0 ? mmi : null,
    cdi: finiteNumber(props?.cdi),
    intensityText: mmi && mmi > 0 ? `MMI ${mmi.toFixed(0)}` : null,
    stationCount: finiteNumber(props?.nst),
    azimuthalGapDeg: finiteNumber(props?.gap),
    nearestStationDeg: null,
    rmsSec: finiteNumber(props?.rms),
    significance: null,
    feltReports: feltReports && feltReports > 0 ? feltReports : null,
    alertLevel: null,
    tsunami: false,
    networkCode: props?.agency?.trim() || "SGC",
    providerEventCode: sourceEventId,
    eventType: props?.type?.trim() || "earthquake",
    detailUrl,
    sources: ["SGC"],
    sourceCount: 1,
    eventTimeUtc,
    updatedAtUtc: parseColombiaLocalDateTime(props?.updated),
    status: normalizeSgcStatus(props?.status),
    sourceUrl: detailUrl,
    ingestedAt
  };
}

export const sgcProvider: SeismicProvider = {
  code: "SGC",
  async fetchEvents() {
    const payload = await fetchJson<SgcResponse>(env.sgcFiveDaysAllUrl);
    assertShape(sgcResponseSchema, payload, "SGC");
    const ingestedAt = new Date().toISOString();
    const cutoff = Date.now() - env.sourceWindowHours * 3_600_000;

    return (payload.features ?? []).flatMap((feature) => {
      const event = normalizeSgcFeature(feature, ingestedAt);
      return event && Date.parse(event.eventTimeUtc) >= cutoff ? [{ event, rawPayload: feature }] : [];
    });
  }
};
