import { buildEventId, type SeismicEvent } from "@sismica/shared";
import { XMLParser } from "fast-xml-parser";

import { env } from "../config/env.js";
import { fetchXml } from "./http.js";
import {
  absoluteUrl,
  collapseSpaces,
  finiteNumber,
  isValidCoordinate,
  localDateTimeToUtc
} from "./regionalUtils.js";
import { type SeismicProvider } from "./types.js";

export type InpresXmlItem = {
  idSismo?: string | number;
  fecha?: string;
  hora?: string;
  latitud?: string | number;
  longitud?: string | number;
  prof?: string | number;
  mg?: string | number;
  prov?: string;
  link?: string;
};

type InpresXml = {
  lista?: {
    item?: InpresXmlItem | InpresXmlItem[];
  };
};

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
const INPRES_BASE_URL = "http://contenidos.inpres.gob.ar/sismologia/";

function inferInpresDate(dayMonth: string, now: Date): string | null {
  const match = /^(\d{2})\/(\d{2})$/.exec(dayMonth.trim());
  if (!match) return null;
  let year = now.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
  if (candidate.getTime() - now.getTime() > 7 * 24 * 3_600_000) {
    year -= 1;
    candidate = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
  }
  if (Number.isNaN(candidate.getTime())) return null;
  return `${year}-${match[2]}-${match[1]}`;
}

export function parseInpresXml(xml: string): InpresXmlItem[] {
  const parsed = parser.parse(xml) as InpresXml;
  const items = parsed.lista?.item;
  return Array.isArray(items) ? items : items ? [items] : [];
}

export function normalizeInpresItem(
  item: InpresXmlItem,
  ingestedAt: string,
  now = new Date()
): SeismicEvent | null {
  const sourceEventId = collapseSpaces(String(item.idSismo ?? ""));
  const datePart = item.fecha ? inferInpresDate(String(item.fecha), now) : null;
  const timePart = collapseSpaces(String(item.hora ?? ""));
  const eventTimeUtc = datePart && timePart ? localDateTimeToUtc(datePart, timePart, "-03:00") : null;
  const latitude = finiteNumber(item.latitud);
  const longitude = finiteNumber(item.longitud);
  const magnitude = finiteNumber(item.mg);
  const depthKm = finiteNumber(item.prof);
  const place = collapseSpaces(item.prov) ?? "Argentina";
  const sourceUrl = absoluteUrl(INPRES_BASE_URL, String(item.link ?? "")) ?? env.inpresSismosXmlUrl;

  if (!sourceEventId || !eventTimeUtc || !isValidCoordinate(latitude, longitude)) return null;

  return {
    eventId: buildEventId("INPRES", sourceEventId),
    source: "INPRES",
    sourceEventId,
    title: `${magnitude === null ? "Sismo" : `M${magnitude.toFixed(1)}`} - ${place}`,
    magnitude,
    magnitudeType: null,
    latitude: latitude!,
    longitude: longitude!,
    depthKm,
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
    networkCode: "INPRES",
    providerEventCode: sourceEventId,
    eventType: "earthquake",
    detailUrl: sourceUrl,
    sources: ["INPRES"],
    sourceCount: 1,
    eventTimeUtc,
    updatedAtUtc: null,
    status: "official",
    sourceUrl,
    ingestedAt
  };
}

export const inpresProvider: SeismicProvider = {
  code: "INPRES",
  async fetchEvents() {
    const xml = await fetchXml(env.inpresSismosXmlUrl);
    const ingestedAt = new Date().toISOString();
    const cutoff = Date.now() - env.sourceWindowHours * 3_600_000;

    return parseInpresXml(xml).flatMap((item) => {
      const event = normalizeInpresItem(item, ingestedAt);
      return event && Date.parse(event.eventTimeUtc) >= cutoff ? [{ event, rawPayload: item }] : [];
    });
  }
};
