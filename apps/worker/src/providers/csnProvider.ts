import { buildEventId, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchText } from "./http.js";
import { type SeismicProvider } from "./types.js";

type CsnHomeEntry = {
  path: string;
  sourceEventId: string;
};

type CsnDetail = {
  sourceEventId: string;
  reference: string;
  eventTimeUtc: string;
  latitude: number;
  longitude: number;
  depthKm: number | null;
  magnitude: number | null;
  magnitudeType: string | null;
  detailUrl: string;
};

function collapseWhitespace(value: string | undefined): string | null {
  const collapsed = value?.replace(/\s+/g, " ").trim();
  return collapsed ? collapsed : null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCharCode(Number.parseInt(digits, 10)));
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsnUtcDateTime(value: string | undefined): string | null {
  const match = /(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(value ?? "");
  if (!match) return null;
  const [, hour, minute, second, day, month, year] = match;
  return new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second)).toISOString();
}

export function extractCsnHomeEntries(html: string): CsnHomeEntry[] {
  const entries: CsnHomeEntry[] = [];
  const seen = new Set<string>();
  const rowRegex = /href="(\/sismicidad\/informes\/\d{4}\/\d{2}\/(\d+)\.html)"/g;

  for (const match of html.matchAll(rowRegex)) {
    const path = match[1];
    const sourceEventId = match[2];
    if (!seen.has(sourceEventId)) {
      seen.add(sourceEventId);
      entries.push({ path, sourceEventId });
    }
  }

  return entries;
}

function extractLabeledRow(html: string, label: string): string | null {
  const regex = new RegExp(`<tr><td>\\s*${label}\\s*<\\/td>\\s*<td>([\\s\\S]*?)<\\/td><\\/tr>`, "i");
  const match = regex.exec(html);
  return match ? collapseWhitespace(decodeHtml(match[1].replace(/<br\s*\/?>/gi, " "))) : null;
}

export function parseCsnDetailPage(html: string, detailUrl: string): CsnDetail | null {
  const idMatch = /\/(\d+)\.html$/i.exec(detailUrl);
  const sourceEventId = idMatch?.[1];
  const reference = extractLabeledRow(html, "Referencia");
  const eventTimeUtc = parseCsnUtcDateTime(extractLabeledRow(html, "Hora UTC") ?? undefined);
  const latitude = finiteNumber(extractLabeledRow(html, "Latitud"));
  const longitude = finiteNumber(extractLabeledRow(html, "Longitud"));
  const depthKm = finiteNumber((extractLabeledRow(html, "Profundidad") ?? "").replace(/\s*km$/i, ""));
  const magnitudeField = extractLabeledRow(html, "Magnitud");
  const magnitudeMatch = /^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]+)?/.exec(magnitudeField ?? "");
  const magnitude = magnitudeMatch ? finiteNumber(magnitudeMatch[1]) : null;
  const magnitudeType = collapseWhitespace(magnitudeMatch?.[2]);

  if (!sourceEventId || !reference || !eventTimeUtc || latitude === null || longitude === null) {
    return null;
  }

  return {
    sourceEventId,
    reference,
    eventTimeUtc,
    latitude,
    longitude,
    depthKm,
    magnitude,
    magnitudeType,
    detailUrl
  };
}

export function normalizeCsnDetail(detail: CsnDetail, ingestedAt: string): SeismicEvent {
  return {
    eventId: buildEventId("CSN", detail.sourceEventId),
    source: "CSN",
    sourceEventId: detail.sourceEventId,
    title: `${detail.magnitude === null ? "Sismo" : `M${detail.magnitude.toFixed(1)}`} - ${detail.reference}`,
    magnitude: detail.magnitude,
    magnitudeType: detail.magnitudeType,
    latitude: detail.latitude,
    longitude: detail.longitude,
    depthKm: detail.depthKm,
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
    networkCode: "CSN",
    providerEventCode: detail.sourceEventId,
    eventType: "earthquake",
    detailUrl: detail.detailUrl,
    sources: ["CSN"],
    sourceCount: 1,
    eventTimeUtc: detail.eventTimeUtc,
    updatedAtUtc: null,
    status: "official",
    sourceUrl: detail.detailUrl,
    ingestedAt
  };
}

export const csnProvider: SeismicProvider = {
  code: "CSN",
  async fetchEvents() {
    const homeHtml = await fetchText(env.csnHomeUrl);
    const entries = extractCsnHomeEntries(homeHtml).slice(0, 20);
    const ingestedAt = new Date().toISOString();
    const cutoff = Date.now() - env.sourceWindowHours * 3_600_000;

    const details = await Promise.all(
      entries.map(async (entry) => {
        const detailUrl = new URL(entry.path, env.csnHomeUrl).toString();
        const detailHtml = await fetchText(detailUrl);
        return {
          detail: parseCsnDetailPage(detailHtml, detailUrl),
          rawPayload: {
            listPath: entry.path,
            detailUrl,
            detailHtml
          }
        };
      })
    );

    return details.flatMap(({ detail, rawPayload }) => {
      if (!detail) return [];
      const event = normalizeCsnDetail(detail, ingestedAt);
      return Date.parse(event.eventTimeUtc) >= cutoff ? [{ event, rawPayload }] : [];
    });
  }
};
