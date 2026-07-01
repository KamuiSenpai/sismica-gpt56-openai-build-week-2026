import { buildEventId, type SeismicEvent, type SourceCode } from "@sismica/shared";

import { env } from "../config/env.js";
import { parseFdsnText, type FdsnTextRecord } from "./geofonProvider.js";
import { fetchText } from "./http.js";
import { type SeismicProvider } from "./types.js";

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

// FDSN sin milisegundos: algunos servidores (p. ej. ISC) rechazan la fraccion de segundo.
function fdsnTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "");
}

type FdsnProviderOptions = {
  code: SourceCode;
  baseUrl: string;
  network: string; // etiqueta de red por defecto
  minMagnitude?: number;
  windowHours?: number;
  limit?: number;
};

function textField(record: FdsnTextRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (value && value.trim().length > 0) return value;
  }
  return undefined;
}

function normalizeEventType(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "eq") return "earthquake";
  return normalized;
}

export function normalizeFdsnRecord(
  record: FdsnTextRecord,
  code: SourceCode,
  network: string,
  baseUrl: string,
  ingestedAt: string
): SeismicEvent | null {
  const sourceEventId = record.EventID?.trim();
  const eventTimeUtc = utcIso(record.Time?.replace(/\//g, "-").replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T"));
  const latitude = finiteNumber(record.Latitude);
  const longitude = finiteNumber(textField(record, ["Longitude", "Longtitude"]));
  if (!sourceEventId || !eventTimeUtc || latitude === null || longitude === null) return null;

  const magnitude = finiteNumber(record.Magnitude);
  const location = record.EventLocationName?.trim() || "Region sin nombre";
  const eventType = normalizeEventType(record.EventType ?? record.ET) ?? "earthquake";
  return {
    eventId: buildEventId(code, sourceEventId),
    source: code,
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
    networkCode: textField(record, ["Author", "Contributor", "Catalog", "MagAuthor"])?.trim() || network,
    providerEventCode: record.ContributorID?.trim() || sourceEventId,
    eventType,
    detailUrl: null,
    sources: [code],
    sourceCount: 1,
    eventTimeUtc,
    updatedAtUtc: null,
    status: "published",
    sourceUrl: `${baseUrl}?eventid=${encodeURIComponent(sourceEventId)}`,
    ingestedAt
  };
}

// Provider FDSN generico (fdsnws-event, format=text). Cualquier centro FDSN se
// agrega solo pasando su URL base. Reutiliza el parser de texto de GEOFON.
export function createFdsnProvider(options: FdsnProviderOptions): SeismicProvider {
  const {
    code,
    baseUrl,
    network,
    minMagnitude = 2.5,
    windowHours = env.sourceWindowHours,
    limit = 1000
  } = options;
  return {
    code,
    async fetchEvents() {
      const endtime = new Date();
      const starttime = new Date(endtime.getTime() - windowHours * 3_600_000);
      const params = new URLSearchParams({
        format: "text",
        starttime: fdsnTime(starttime),
        endtime: fdsnTime(endtime),
        minmagnitude: String(minMagnitude),
        orderby: "time",
        limit: String(limit)
      });
      const payload = await fetchText(`${baseUrl}?${params.toString()}`);
      const ingestedAt = new Date().toISOString();
      return parseFdsnText(payload).flatMap((record) => {
        const event = normalizeFdsnRecord(record, code, network, baseUrl, ingestedAt);
        return event ? [{ event, rawPayload: record }] : [];
      });
    }
  };
}

export const sedProvider = createFdsnProvider({ code: "SED", baseUrl: env.sedFdsnUrl, network: "SED" });
export const renassProvider = createFdsnProvider({
  code: "RENASS",
  baseUrl: env.renassFdsnUrl,
  network: "RENASS"
});
export const iscProvider = createFdsnProvider({ code: "ISC", baseUrl: env.iscFdsnUrl, network: "ISC" });
export const gaProvider = createFdsnProvider({ code: "GA", baseUrl: env.gaFdsnUrl, network: "GA" });
export const nrcanProvider = createFdsnProvider({
  code: "NRCAN",
  baseUrl: env.nrcanFdsnUrl,
  network: "NRCAN"
});
export const ncedcProvider = createFdsnProvider({
  code: "NCEDC",
  baseUrl: env.ncedcFdsnUrl,
  network: "NCEDC",
  windowHours: 48,
  limit: 500
});
export const knmiProvider = createFdsnProvider({
  code: "KNMI",
  baseUrl: env.knmiFdsnUrl,
  network: "KNMI",
  minMagnitude: 1
});
export const scedcProvider = createFdsnProvider({
  code: "SCEDC",
  baseUrl: env.scedcFdsnUrl,
  network: "SCEDC",
  windowHours: 48,
  limit: 500
});
