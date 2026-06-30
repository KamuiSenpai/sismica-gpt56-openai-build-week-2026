import { buildEventId, isFiniteNumber, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchJson } from "./http.js";
import { assertShape, emscResponseSchema } from "./schemas.js";
import { type SeismicProvider } from "./types.js";

type EmscFeature = {
  id?: string;
  geometry?: { coordinates?: [number, number, number?] };
  properties?: {
    unid?: string;
    source_id?: string;
    source_catalog?: string;
    lastupdate?: string;
    time?: string;
    flynn_region?: string;
    lat?: number;
    lon?: number;
    depth?: number;
    evtype?: string;
    auth?: string;
    mag?: number;
    magtype?: string;
  };
};

type EmscResponse = { features?: EmscFeature[] };

export function normalizeEmscFeature(feature: EmscFeature, ingestedAt: string): SeismicEvent | null {
  const props = feature.properties;
  const sourceEventId = props?.unid ?? feature.id;
  const longitude = props?.lon ?? feature.geometry?.coordinates?.[0];
  const latitude = props?.lat ?? feature.geometry?.coordinates?.[1];
  if (!sourceEventId || !isFiniteNumber(longitude) || !isFiniteNumber(latitude) || !props?.time) {
    return null;
  }

  const magnitude = isFiniteNumber(props.mag) ? props.mag : null;
  return {
    eventId: buildEventId("EMSC", sourceEventId),
    source: "EMSC",
    sourceEventId,
    title: `${magnitude === null ? "Sismo" : `M${magnitude.toFixed(1)}`} - ${props.flynn_region ?? "Region sin nombre"}`,
    magnitude,
    magnitudeType: props.magtype ?? null,
    latitude,
    longitude,
    depthKm: isFiniteNumber(props.depth) ? props.depth : null,
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
    networkCode: props.auth ?? null,
    providerEventCode: props.source_id ?? null,
    eventType: props.evtype ?? "earthquake",
    detailUrl: null,
    sources: ["EMSC"],
    sourceCount: 1,
    eventTimeUtc: new Date(props.time).toISOString(),
    updatedAtUtc: props.lastupdate ? new Date(props.lastupdate).toISOString() : null,
    status: "automatic",
    sourceUrl: `https://www.seismicportal.eu/eventdetails.html?unid=${encodeURIComponent(sourceEventId)}`,
    ingestedAt
  };
}

export const emscProvider: SeismicProvider = {
  code: "EMSC",
  async fetchEvents() {
    const starttime = new Date(Date.now() - env.sourceWindowHours * 3_600_000).toISOString();
    const params = new URLSearchParams({
      format: "json",
      starttime,
      minmagnitude: "2.5",
      limit: "1000",
      orderby: "time"
    });
    const payload = await fetchJson<EmscResponse>(`${env.emscFdsnUrl}?${params.toString()}`);
    assertShape(emscResponseSchema, payload, "EMSC");
    const ingestedAt = new Date().toISOString();
    return (payload.features ?? []).flatMap((feature) => {
      const event = normalizeEmscFeature(feature, ingestedAt);
      return event ? [{ event, rawPayload: feature }] : [];
    });
  }
};
