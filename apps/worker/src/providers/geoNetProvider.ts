import { buildEventId, isFiniteNumber, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchJson } from "./http.js";
import { assertShape, geoNetResponseSchema } from "./schemas.js";
import { type SeismicProvider } from "./types.js";

export type GeoNetFeature = {
  geometry?: { type?: string; coordinates?: [number, number] };
  properties?: {
    publicID?: string;
    time?: string;
    depth?: number;
    magnitude?: number;
    mmi?: number;
    locality?: string;
    quality?: string;
  };
};

type GeoNetResponse = { features?: GeoNetFeature[] };

export function normalizeGeoNetFeature(feature: GeoNetFeature, ingestedAt: string): SeismicEvent | null {
  const props = feature.properties;
  const sourceEventId = props?.publicID?.trim();
  const longitude = feature.geometry?.coordinates?.[0];
  const latitude = feature.geometry?.coordinates?.[1];
  const eventTime = props?.time ? new Date(props.time) : null;
  if (
    !props
    || !sourceEventId
    || !isFiniteNumber(longitude)
    || !isFiniteNumber(latitude)
    || !eventTime
    || Number.isNaN(eventTime.getTime())
    || props?.quality === "deleted"
  ) {
    return null;
  }

  const magnitude = isFiniteNumber(props.magnitude) ? props.magnitude : null;
  return {
    eventId: buildEventId("GEONET", sourceEventId),
    source: "GEONET",
    sourceEventId,
    title: `${magnitude === null ? "Sismo" : `M${magnitude.toFixed(1)}`} - ${props.locality ?? "New Zealand"}`,
    magnitude,
    magnitudeType: null,
    latitude,
    longitude,
    depthKm: isFiniteNumber(props.depth) ? props.depth : null,
    mmi: isFiniteNumber(props.mmi) && props.mmi >= 0 ? props.mmi : null,
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
    networkCode: "GEONET",
    providerEventCode: sourceEventId,
    eventType: "earthquake",
    detailUrl: `https://api.geonet.org.nz/quake/${encodeURIComponent(sourceEventId)}`,
    sources: ["GEONET"],
    sourceCount: 1,
    eventTimeUtc: eventTime.toISOString(),
    updatedAtUtc: null,
    status: props.quality ?? null,
    sourceUrl: `https://www.geonet.org.nz/earthquake/${encodeURIComponent(sourceEventId)}`,
    ingestedAt
  };
}

export const geoNetProvider: SeismicProvider = {
  code: "GEONET",
  async fetchEvents() {
    const payload = await fetchJson<GeoNetResponse>(
      env.geoNetQuakeUrl,
      "application/vnd.geo+json;version=2"
    );
    assertShape(geoNetResponseSchema, payload, "GEONET");
    const cutoff = Date.now() - env.sourceWindowHours * 3_600_000;
    const ingestedAt = new Date().toISOString();
    return (payload.features ?? []).flatMap((feature) => {
      const event = normalizeGeoNetFeature(feature, ingestedAt);
      return event
        && Date.parse(event.eventTimeUtc) >= cutoff
        && (event.magnitude ?? 0) >= 2.5
        ? [{ event, rawPayload: feature }]
        : [];
    });
  }
};
