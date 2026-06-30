import { createHash } from "node:crypto";

import { buildEventId, type SeismicEvent } from "@sismica/shared";
import { XMLParser } from "fast-xml-parser";

import { env } from "../config/env.js";
import { fetchXml } from "./http.js";
import { type SeismicProvider } from "./types.js";

type SsnRssItem = {
  title?: string;
  description?: string;
  link?: string;
  lat?: number | string;
  long?: number | string;
};

type SsnRss = {
  rss?: {
    channel?: {
      item?: SsnRssItem | SsnRssItem[];
    };
  };
};

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true
});

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function collapseSpaces(value: string | undefined): string | null {
  const collapsed = value?.replace(/\s+/g, " ").trim();
  return collapsed ? collapsed : null;
}

function parseMagnitudeAndLocation(
  title: string | undefined
): { magnitude: number | null; location: string } | null {
  const collapsed = collapseSpaces(title);
  if (!collapsed) return null;

  const match = /^([0-9]+(?:\.[0-9]+)?),\s*(.+)$/.exec(collapsed);
  if (!match) {
    return { magnitude: null, location: collapsed };
  }

  return {
    magnitude: finiteNumber(match[1]),
    location: match[2]
  };
}

function parseMexicoLocalDateTime(description: string | undefined): string | null {
  const match = /Fecha:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i.exec(description ?? "");
  if (!match) return null;
  return new Date(`${match[1]}T${match[2]}-06:00`).toISOString();
}

function parseDepthKm(description: string | undefined): number | null {
  const match = /Profundidad:\s*([0-9.]+)\s*km/i.exec(description ?? "");
  return match ? finiteNumber(match[1]) : null;
}

function buildSsnSourceEventId(
  eventTimeUtc: string,
  latitude: number,
  longitude: number,
  magnitude: number | null,
  location: string
): string {
  const identity = [
    eventTimeUtc,
    latitude.toFixed(3),
    longitude.toFixed(3),
    magnitude?.toFixed(1) ?? "na",
    location
  ].join("|");
  return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}

export function normalizeSsnItem(item: SsnRssItem, ingestedAt: string): SeismicEvent | null {
  const locationData = parseMagnitudeAndLocation(item.title);
  const eventTimeUtc = parseMexicoLocalDateTime(item.description);
  const latitude = finiteNumber(item.lat);
  const longitude = finiteNumber(item.long);

  if (!locationData || !eventTimeUtc || latitude === null || longitude === null) {
    return null;
  }

  const sourceEventId = buildSsnSourceEventId(
    eventTimeUtc,
    latitude,
    longitude,
    locationData.magnitude,
    locationData.location
  );
  const detailUrl = collapseSpaces(item.link);

  return {
    eventId: buildEventId("SSN", sourceEventId),
    source: "SSN",
    sourceEventId,
    title: `${locationData.magnitude === null ? "Sismo" : `M${locationData.magnitude.toFixed(1)}`} - ${locationData.location}`,
    magnitude: locationData.magnitude,
    magnitudeType: null,
    latitude,
    longitude,
    depthKm: parseDepthKm(item.description),
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
    networkCode: "SSN",
    providerEventCode: sourceEventId,
    eventType: "earthquake",
    detailUrl,
    sources: ["SSN"],
    sourceCount: 1,
    eventTimeUtc,
    updatedAtUtc: null,
    status: "official",
    sourceUrl: detailUrl ?? env.ssnRssUrl,
    ingestedAt
  };
}

export const ssnProvider: SeismicProvider = {
  code: "SSN",
  async fetchEvents() {
    const xml = await fetchXml(env.ssnRssUrl);
    const parsed = parser.parse(xml) as SsnRss;
    const items = Array.isArray(parsed.rss?.channel?.item)
      ? parsed.rss.channel.item
      : parsed.rss?.channel?.item
        ? [parsed.rss.channel.item]
        : [];
    const ingestedAt = new Date().toISOString();
    const cutoff = Date.now() - env.sourceWindowHours * 3_600_000;

    return items.flatMap((item) => {
      const event = normalizeSsnItem(item, ingestedAt);
      return event && Date.parse(event.eventTimeUtc) >= cutoff ? [{ event, rawPayload: item }] : [];
    });
  }
};
