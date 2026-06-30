import { buildEventId, type SeismicEvent } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchJson } from "./http.js";
import { assertShape, jmaListSchema } from "./schemas.js";
import { type SeismicProvider } from "./types.js";

// Feed JSON oficial de la JMA (bosai). Incluye nombre de region en ingles (en_anm),
// coordenadas en ISO 6709 y un id de evento estable (eid).
export type JmaRecord = {
  eid?: string;
  ctt?: string;
  at?: string; // hora de origen, con huso +09:00
  rdt?: string; // hora del reporte
  cod?: string; // ISO 6709, p. ej. "+25.0+125.6-50000/"
  mag?: string;
  maxi?: string; // intensidad maxima JMA (shindo): 1..7 con 5-/5+/6-/6+
  anm?: string; // region (japones)
  en_anm?: string; // region (ingles)
  json?: string; // archivo de detalle
};

// ISO 6709 simplificado "+lat+lon-profm/" -> grados decimales y profundidad en km.
function parseIso6709(
  value: string | undefined
): { latitude: number; longitude: number; depthKm: number | null } | null {
  if (!value) return null;
  const match = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?\/?$/.exec(value.trim());
  if (!match) return null;
  const latitude = Number.parseFloat(match[1]);
  const longitude = Number.parseFloat(match[2]);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  const depthMeters = match[3] ? Number.parseFloat(match[3]) : null;
  const depthKm = depthMeters !== null && Number.isFinite(depthMeters) ? Math.abs(depthMeters) / 1000 : null;
  return { latitude, longitude, depthKm };
}

function finiteNumber(value: string | undefined): number | null {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function validIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// La intensidad JMA (shindo) es una escala distinta de magnitud/MMI; se guarda como texto.
function shindoLabel(maxi: string | undefined): string | null {
  const value = maxi?.trim();
  return value ? `JMA ${value}` : null;
}

export function normalizeJmaRecord(record: JmaRecord, ingestedAt: string): SeismicEvent | null {
  const sourceEventId = record.eid?.trim();
  const coords = parseIso6709(record.cod);
  const eventTimeUtc = validIsoDate(record.at);
  const magnitude = finiteNumber(record.mag);
  if (!sourceEventId || !coords || !eventTimeUtc || magnitude === null) {
    return null;
  }

  const region = record.en_anm?.trim() || record.anm?.trim() || "Japan";
  return {
    eventId: buildEventId("JMA", sourceEventId),
    source: "JMA",
    sourceEventId,
    title: `M${magnitude.toFixed(1)} - ${region}`,
    magnitude,
    magnitudeType: null,
    latitude: coords.latitude,
    longitude: coords.longitude,
    depthKm: coords.depthKm,
    mmi: null,
    cdi: null,
    intensityText: shindoLabel(record.maxi),
    stationCount: null,
    azimuthalGapDeg: null,
    nearestStationDeg: null,
    rmsSec: null,
    significance: null,
    feltReports: null,
    alertLevel: null,
    tsunami: false,
    networkCode: "JMA",
    providerEventCode: sourceEventId,
    eventType: "earthquake",
    detailUrl: record.json ? `https://www.jma.go.jp/bosai/quake/data/${record.json}` : null,
    sources: ["JMA"],
    sourceCount: 1,
    eventTimeUtc,
    updatedAtUtc: validIsoDate(record.rdt),
    status: "official",
    sourceUrl: "https://www.jma.go.jp/bosai/map.html#contents=earthquake",
    ingestedAt
  };
}

export type ConsolidatedJmaRecord = {
  record: JmaRecord;
  reports: JmaRecord[];
};

// Un sismo genera varios reportes. La base usa el ultimo reporte con hipocentro
// y conserva la intensidad mas reciente aunque venga en otro reporte.
export function consolidateJmaRecords(records: JmaRecord[]): ConsolidatedJmaRecord[] {
  const byEid = new Map<string, JmaRecord[]>();
  for (const record of records) {
    const eid = record.eid?.trim();
    if (!eid) continue;
    const group = byEid.get(eid) ?? [];
    group.push(record);
    byEid.set(eid, group);
  }

  return [...byEid.values()].flatMap((reports) => {
    const newestFirst = [...reports].sort((a, b) => (b.ctt ?? "").localeCompare(a.ctt ?? ""));
    const located = newestFirst.find((record) => record.cod && record.mag);
    if (!located) return [];
    const intensity = newestFirst.find((record) => record.maxi?.trim());
    return [
      {
        record: intensity ? { ...located, maxi: intensity.maxi } : located,
        reports
      }
    ];
  });
}

export const jmaProvider: SeismicProvider = {
  code: "JMA",
  async fetchEvents() {
    const records = await fetchJson<JmaRecord[]>(env.jmaListUrl);
    assertShape(jmaListSchema, records, "JMA");

    const cutoff = Date.now() - env.sourceWindowHours * 3_600_000;
    const ingestedAt = new Date().toISOString();
    return consolidateJmaRecords(records).flatMap(({ record, reports }) => {
      const event = normalizeJmaRecord(record, ingestedAt);
      return event && Date.parse(event.eventTimeUtc) >= cutoff ? [{ event, rawPayload: reports }] : [];
    });
  }
};
