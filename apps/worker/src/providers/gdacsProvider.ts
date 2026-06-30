import { type DisasterContext } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchJson } from "./http.js";
import { assertShape, gdacsResponseSchema } from "./schemas.js";
import { type AuxiliaryProvider } from "./types.js";

export type GdacsFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    eventid?: number | string;
    title?: string;
    name?: string;
    description?: string;
    alertlevel?: string;
    alertscore?: number;
    country?: string;
    fromdate?: string;
    datemodified?: string;
    url?: { report?: string };
  };
};

type GdacsResponse = { features?: GdacsFeature[] };

export function normalizeGdacsFeature(feature: GdacsFeature): DisasterContext | null {
  const props = feature.properties;
  const sourceEventId = props?.eventid === undefined ? null : String(props.eventid);
  const longitude = feature.geometry?.coordinates?.[0];
  const latitude = feature.geometry?.coordinates?.[1];
  if (!sourceEventId || typeof longitude !== "number" || typeof latitude !== "number" || !props?.fromdate) {
    return null;
  }

  return {
    contextId: `GDACS:${sourceEventId}`,
    source: "GDACS",
    sourceEventId,
    eventId: null,
    title: props.name ?? props.description ?? props.title ?? "Contexto GDACS",
    alertLevel: props.alertlevel ?? null,
    alertScore: typeof props.alertscore === "number" ? props.alertscore : null,
    country: props.country ?? null,
    latitude,
    longitude,
    eventTimeUtc: new Date(`${props.fromdate}Z`.replace("ZZ", "Z")).toISOString(),
    updatedAtUtc: props.datemodified
      ? new Date(`${props.datemodified}Z`.replace("ZZ", "Z")).toISOString()
      : null,
    sourceUrl: props.url?.report ?? null
  };
}

export const gdacsProvider: AuxiliaryProvider<DisasterContext> = {
  code: "GDACS",
  async fetchItems() {
    const fromdate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const todate = new Date().toISOString().slice(0, 10);
    const params = new URLSearchParams({
      eventlist: "EQ",
      fromdate,
      todate,
      pagesize: "100"
    });
    const payload = await fetchJson<GdacsResponse>(`${env.gdacsApiUrl}?${params.toString()}`);
    assertShape(gdacsResponseSchema, payload, "GDACS");
    return (payload.features ?? []).flatMap((feature) => {
      const item = normalizeGdacsFeature(feature);
      return item ? [{ item, rawPayload: feature }] : [];
    });
  }
};
