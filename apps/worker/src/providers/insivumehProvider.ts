import { buildEventId, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchTextAllowInvalidTls } from "./http.js";
import {
  finiteNumber,
  isValidCoordinate,
  localDateTimeToUtc,
  stripHtml,
  collapseSpaces
} from "./regionalUtils.js";
import { type SeismicProvider } from "./types.js";

export type InsivumehMarkerRecord = {
  latitude: number;
  longitude: number;
  sourceEventId: string | null;
  magnitude: number | null;
  eventTimeUtc: string | null;
  depthKm: number | null;
  stationCount: number | null;
  rmsSec: number | null;
  azimuthalGapDeg: number | null;
  sourceUrl: string | null;
};

type ReferencePoint = {
  label: string;
  latitude: number;
  longitude: number;
};

type NearestReference = ReferencePoint & {
  distanceKm: number;
  bearingDeg: number;
};

const INSIVUMEH_PACIFIC_COAST_LINE: ReferencePoint[] = [
  { label: "Costa oeste", latitude: 14.85, longitude: -93.5 },
  { label: "Costa suroeste", latitude: 14.25, longitude: -92.1 },
  { label: "Costa central", latitude: 13.9, longitude: -90.8 },
  { label: "Costa este", latitude: 13.35, longitude: -89.3 }
];

const INSIVUMEH_COASTAL_SECTORS: ReferencePoint[] = [
  { label: "San Marcos", latitude: 14.2, longitude: -92.3 },
  { label: "Retalhuleu", latitude: 14.0, longitude: -91.75 },
  { label: "Escuintla", latitude: 13.85, longitude: -90.95 },
  { label: "Santa Rosa", latitude: 13.65, longitude: -90.35 },
  { label: "Jutiapa", latitude: 13.55, longitude: -89.85 }
];

const INSIVUMEH_CITY_REFERENCES: ReferencePoint[] = [
  { label: "Ciudad de Guatemala", latitude: 14.6349, longitude: -90.5069 },
  { label: "Escuintla", latitude: 14.305, longitude: -90.785 },
  { label: "Quetzaltenango", latitude: 14.8347, longitude: -91.5186 },
  { label: "Retalhuleu", latitude: 14.536, longitude: -91.6775 },
  { label: "Huehuetenango", latitude: 15.3197, longitude: -91.472 },
  { label: "Cobán", latitude: 15.4691, longitude: -90.3797 },
  { label: "Flores", latitude: 16.9333, longitude: -89.8833 },
  { label: "Chiquimula", latitude: 14.7978, longitude: -89.5458 },
  { label: "Jutiapa", latitude: 14.291, longitude: -89.895 }
];

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineKm(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(toLat - fromLat);
  const dLon = toRadians(toLon - fromLon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);
  const dLon = toRadians(toLon - fromLon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function spanishBearingLabel(bearing: number): string {
  const normalized = ((bearing % 360) + 360) % 360;
  if (normalized < 22.5 || normalized >= 337.5) return "norte";
  if (normalized < 67.5) return "noreste";
  if (normalized < 112.5) return "este";
  if (normalized < 157.5) return "sureste";
  if (normalized < 202.5) return "sur";
  if (normalized < 247.5) return "suroeste";
  if (normalized < 292.5) return "oeste";
  return "noroeste";
}

function findNearestReference(
  latitude: number,
  longitude: number,
  references: ReferencePoint[]
): NearestReference {
  return references.reduce<NearestReference>(
    (nearest, reference) => {
      const distanceKm = haversineKm(reference.latitude, reference.longitude, latitude, longitude);
      const bearingDeg = bearingDegrees(reference.latitude, reference.longitude, latitude, longitude);
      if (distanceKm >= nearest.distanceKm) return nearest;
      return { ...reference, distanceKm, bearingDeg };
    },
    {
      ...references[0],
      distanceKm: haversineKm(references[0].latitude, references[0].longitude, latitude, longitude),
      bearingDeg: bearingDegrees(references[0].latitude, references[0].longitude, latitude, longitude)
    }
  );
}

function pacificCoastLatitude(longitude: number): number | null {
  if (
    longitude < INSIVUMEH_PACIFIC_COAST_LINE[0].longitude ||
    longitude > INSIVUMEH_PACIFIC_COAST_LINE[INSIVUMEH_PACIFIC_COAST_LINE.length - 1].longitude
  ) {
    return null;
  }

  for (let index = 0; index < INSIVUMEH_PACIFIC_COAST_LINE.length - 1; index += 1) {
    const start = INSIVUMEH_PACIFIC_COAST_LINE[index];
    const end = INSIVUMEH_PACIFIC_COAST_LINE[index + 1];
    if (longitude < start.longitude || longitude > end.longitude) continue;
    const progress = (longitude - start.longitude) / (end.longitude - start.longitude);
    return start.latitude + (end.latitude - start.latitude) * progress;
  }

  return null;
}

function isPacificOffshore(latitude: number, longitude: number): boolean {
  const coastLatitude = pacificCoastLatitude(longitude);
  return coastLatitude !== null && latitude < coastLatitude - 0.05;
}

function fallbackGuatemalaRegion(latitude: number, longitude: number): string {
  if (latitude >= 15.8) return "norte de Guatemala";
  if (latitude >= 15.1 && longitude <= -91) return "occidente de Guatemala";
  if (latitude >= 15.1) return "centro-norte de Guatemala";
  if (longitude <= -91.3) return "suroccidente de Guatemala";
  if (longitude >= -89.9) return "oriente de Guatemala";
  if (latitude < 14.5) return "centro-sur de Guatemala";
  return "centro de Guatemala";
}

export function describeInsivumehLocation(latitude: number, longitude: number): string {
  if (isPacificOffshore(latitude, longitude)) {
    const coastalSector = findNearestReference(latitude, longitude, INSIVUMEH_COASTAL_SECTORS);
    return `frente a la costa de ${coastalSector.label}`;
  }

  const nearestCity = findNearestReference(latitude, longitude, INSIVUMEH_CITY_REFERENCES);
  if (nearestCity.distanceKm < 8) return nearestCity.label;
  if (nearestCity.distanceKm <= 85) {
    return `${Math.round(nearestCity.distanceKm)} km al ${spanishBearingLabel(nearestCity.bearingDeg)} de ${nearestCity.label}`;
  }

  return fallbackGuatemalaRegion(latitude, longitude);
}

export function parseInsivumehMarkers(html: string): InsivumehMarkerRecord[] {
  return html
    .split(/var circle_marker_/)
    .slice(1)
    .flatMap((chunk) => {
      const coordMatch = /L\.circleMarker\(\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/.exec(
        chunk
      );
      if (!coordMatch) return [];

      const text = collapseSpaces(stripHtml(chunk)) ?? "";
      const sourceEventId =
        /ID:\s*(insivumeh[a-z0-9]+)/i.exec(text)?.[1] ??
        /HISTORICO\/(insivumeh[a-z0-9]+)/i.exec(chunk)?.[1] ??
        null;
      const dateMatch = /Tiempo de Origen:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i.exec(text);
      const eventTimeUtc = dateMatch ? localDateTimeToUtc(dateMatch[1], dateMatch[2], "-06:00") : null;

      return [
        {
          latitude: Number(coordMatch[1]),
          longitude: Number(coordMatch[2]),
          sourceEventId,
          magnitude: finiteNumber(/Magnitud:\s*([0-9.]+)/i.exec(text)?.[1]),
          eventTimeUtc,
          depthKm: finiteNumber(/Profundidad:\s*([0-9.]+)\s*km/i.exec(text)?.[1]),
          stationCount: finiteNumber(/NST:\s*([0-9]+)/i.exec(text)?.[1]),
          rmsSec: finiteNumber(/RMS:\s*([0-9.]+)/i.exec(text)?.[1]),
          azimuthalGapDeg: finiteNumber(/GAP:\s*([0-9.]+)/i.exec(text)?.[1]),
          sourceUrl: sourceEventId ? `https://geo.insivumeh.gob.gt/IMM/HISTORICO/${sourceEventId}` : null
        }
      ];
    });
}

export function normalizeInsivumehRecord(
  record: InsivumehMarkerRecord,
  ingestedAt: string
): SeismicEvent | null {
  if (
    !record.sourceEventId ||
    !record.eventTimeUtc ||
    !isValidCoordinate(record.latitude, record.longitude)
  ) {
    return null;
  }

  return {
    eventId: buildEventId("INSIVUMEH", record.sourceEventId),
    source: "INSIVUMEH",
    sourceEventId: record.sourceEventId,
    title: `${record.magnitude === null ? "Sismo" : `M${record.magnitude.toFixed(1)}`} - ${describeInsivumehLocation(record.latitude, record.longitude)}`,
    magnitude: record.magnitude,
    magnitudeType: null,
    latitude: record.latitude,
    longitude: record.longitude,
    depthKm: record.depthKm,
    mmi: null,
    cdi: null,
    intensityText: null,
    stationCount: record.stationCount,
    azimuthalGapDeg: record.azimuthalGapDeg,
    nearestStationDeg: null,
    rmsSec: record.rmsSec,
    significance: null,
    feltReports: null,
    alertLevel: null,
    tsunami: false,
    networkCode: "INSIVUMEH",
    providerEventCode: record.sourceEventId,
    eventType: "earthquake",
    detailUrl: record.sourceUrl ?? env.insivumehMapUrl,
    sources: ["INSIVUMEH"],
    sourceCount: 1,
    eventTimeUtc: record.eventTimeUtc,
    updatedAtUtc: null,
    status: "official",
    sourceUrl: record.sourceUrl ?? env.insivumehMapUrl,
    ingestedAt
  };
}

export const insivumehProvider: SeismicProvider = {
  code: "INSIVUMEH",
  async fetchEvents() {
    const html = await fetchTextAllowInvalidTls(env.insivumehMapUrl);
    const ingestedAt = new Date().toISOString();
    const cutoff = Date.now() - env.sourceWindowHours * 3_600_000;

    return parseInsivumehMarkers(html).flatMap((record) => {
      const event = normalizeInsivumehRecord(record, ingestedAt);
      return event && Date.parse(event.eventTimeUtc) >= cutoff ? [{ event, rawPayload: record }] : [];
    });
  }
};
