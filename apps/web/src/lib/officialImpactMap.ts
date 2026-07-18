import type { SeismicEvent } from "@sismica/shared";

import type { SeaLevelStation } from "./seaLevel";

const EARTH_RADIUS_KM = 6371;
const SEQUENCE_RADIUS_KM = 250;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export type SeismicSequenceMember = {
  event: SeismicEvent;
  role: "principal" | "posterior";
  distanceKm: number;
  hoursAfterPrincipal: number;
};

export type SeismicSequenceSummary = {
  principal: SeismicSequenceMember;
  posterior: SeismicSequenceMember[];
  count6h: number;
  count24h: number;
  radiusKm: number;
};

export type PrioritySeaLevelStation = {
  station: SeaLevelStation;
  distanceKm: number;
};

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function geodesicDistanceKm(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number }
): number {
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function buildSeismicSequence(
  events: readonly SeismicEvent[],
  selectedEventId: string | null,
  radiusKm = SEQUENCE_RADIUS_KM
): SeismicSequenceSummary | null {
  if (!selectedEventId) return null;
  const anchor = events.find((event) => event.eventId === selectedEventId);
  if (!anchor) return null;
  const anchorTime = Date.parse(anchor.eventTimeUtc);
  if (!Number.isFinite(anchorTime)) return null;

  const candidates = events.filter((event) => {
    const eventTime = Date.parse(event.eventTimeUtc);
    return (
      Number.isFinite(eventTime) &&
      eventTime >= anchorTime &&
      eventTime - anchorTime <= TWENTY_FOUR_HOURS_MS &&
      geodesicDistanceKm(anchor, event) <= radiusKm
    );
  });
  if (candidates.length < 2) return null;

  const principal = [...candidates].sort((left, right) => {
    const magnitudeDelta =
      (right.magnitude ?? Number.NEGATIVE_INFINITY) - (left.magnitude ?? Number.NEGATIVE_INFINITY);
    if (magnitudeDelta !== 0) return magnitudeDelta;
    return Date.parse(left.eventTimeUtc) - Date.parse(right.eventTimeUtc);
  })[0];
  if (!principal) return null;
  const principalTime = Date.parse(principal.eventTimeUtc);
  const posterior = candidates
    .filter((event) => Date.parse(event.eventTimeUtc) > principalTime)
    .map((event) => {
      const elapsedMs = Date.parse(event.eventTimeUtc) - principalTime;
      return {
        event,
        role: "posterior" as const,
        distanceKm: geodesicDistanceKm(principal, event),
        hoursAfterPrincipal: elapsedMs / (60 * 60 * 1000)
      };
    })
    .filter((member) => member.hoursAfterPrincipal <= 24 && member.distanceKm <= radiusKm)
    .sort((left, right) => left.hoursAfterPrincipal - right.hoursAfterPrincipal);
  if (posterior.length === 0) return null;

  return {
    principal: {
      event: principal,
      role: "principal",
      distanceKm: 0,
      hoursAfterPrincipal: 0
    },
    posterior,
    count6h: posterior.filter((member) => member.hoursAfterPrincipal * 60 * 60 * 1000 <= SIX_HOURS_MS).length,
    count24h: posterior.length,
    radiusKm
  };
}

export function selectPrioritySeaLevelStations(
  event: SeismicEvent | null,
  stations: readonly SeaLevelStation[],
  limit = 4
): PrioritySeaLevelStation[] {
  if (!event?.tsunami || limit <= 0) return [];
  const statusOrder: Record<SeaLevelStation["status"], number> = { online: 0, delayed: 1, offline: 2 };

  return stations
    .map((station) => ({ station, distanceKm: geodesicDistanceKm(event, station) }))
    .filter((entry) => Number.isFinite(entry.distanceKm))
    .sort(
      (left, right) =>
        statusOrder[left.station.status] - statusOrder[right.station.status] ||
        left.distanceKm - right.distanceKm ||
        left.station.stationCode.localeCompare(right.station.stationCode)
    )
    .slice(0, Math.max(0, Math.trunc(limit)));
}
