import { env } from "../config/env.js";
import { fetchText } from "./http.js";

export const GEOFON_STATION_SOURCE_URL = "https://geofon.gfz.de/fdsnws/station/1/";

export type StationCatalogRecord = {
  stationId: string;
  source: "GEOFON";
  networkCode: string;
  stationCode: string;
  siteName: string | null;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  startTimeUtc: string | null;
  endTimeUtc: string | null;
  sourceUrl: string;
  rawPayload: Record<string, string>;
};

function finiteCoordinate(value: string | undefined, min: number, max: number): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function isoOrNull(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function parseFdsnStationText(payload: string): StationCatalogRecord[] {
  const lines = payload.split(/\r?\n/).map((line) => line.trim());
  const headerLine = lines.find((line) => line.startsWith("#") && line.includes("|"));
  if (!headerLine) throw new Error("FDSN station response has no named header");

  const columns = headerLine
    .slice(1)
    .split("|")
    .map((column) => column.trim().toLowerCase());
  const records: StationCatalogRecord[] = [];

  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const values = line.split("|").map((value) => value.trim());
    const row = Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
    const networkCode = row.network?.toUpperCase();
    const stationCode = row.station?.toUpperCase();
    const latitude = finiteCoordinate(row.latitude, -90, 90);
    const longitude = finiteCoordinate(row.longitude, -180, 180);
    if (!networkCode || !stationCode || latitude === null || longitude === null) continue;

    const elevation = Number(row.elevation);
    records.push({
      stationId: `GEOFON:${networkCode}.${stationCode}`,
      source: "GEOFON",
      networkCode,
      stationCode,
      siteName: row.sitename || null,
      latitude,
      longitude,
      elevationM: Number.isFinite(elevation) ? elevation : null,
      startTimeUtc: isoOrNull(row.starttime),
      endTimeUtc: isoOrNull(row.endtime),
      sourceUrl: GEOFON_STATION_SOURCE_URL,
      rawPayload: row
    });
  }

  return records;
}

export async function fetchGeofonStations(now = new Date()): Promise<StationCatalogRecord[]> {
  const params = new URLSearchParams({
    net: "GE",
    level: "station",
    format: "text",
    starttime: now.toISOString(),
    includeRestricted: "false"
  });
  const payload = await fetchText(`${env.geofonFdsnStationUrl}?${params.toString()}`);
  return parseFdsnStationText(payload);
}
