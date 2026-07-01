import {
  normalizeUsgsFeature,
  type DisasterContext,
  type SeismicEvent,
  type TsunamiProduct,
  type UsgsGeoJson
} from "@sismica/shared";

import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { ingestDisasterContexts, ingestTsunamiProducts } from "../services/auxiliaryIngestionService.js";
import { ingestSeismicRecords, type SeismicIngestionStats } from "../services/eventAssociationService.js";
import { fetchJson, fetchText, fetchXml } from "../providers/http.js";
import { normalizeEmscFeature } from "../providers/emscProvider.js";
import { createFdsnProvider, normalizeFdsnRecord } from "../providers/fdsnProvider.js";
import { normalizeGdacsFeature, type GdacsFeature } from "../providers/gdacsProvider.js";
import { normalizeGeofonRecord, parseFdsnText, type FdsnTextRecord } from "../providers/geofonProvider.js";
import { normalizeIgepnRecord, parseIgepnCsv } from "../providers/igepnProvider.js";
import { normalizeIgnFeature, extractNamedJsonObject } from "../providers/ignProvider.js";
import { normalizeIgpRecord, type IgpRecord } from "../providers/igpProvider.js";
import { normalizeIngvRecord } from "../providers/ingvProvider.js";
import { normalizeInpresItem, parseInpresXml } from "../providers/inpresProvider.js";
import { parseNoaaCap } from "../providers/noaaProvider.js";
import { assertShape, emscResponseSchema, gdacsResponseSchema, usgsGeoJsonSchema } from "../providers/schemas.js";
import { type SeismicRecord } from "../providers/types.js";

type EmscFeature = Parameters<typeof normalizeEmscFeature>[0];
type IgnFeatureCollection = { features?: Parameters<typeof normalizeIgnFeature>[0][] };
type GdacsResponse = { features?: GdacsFeature[] };

type AuxiliaryRecord<T> = { item: T; rawPayload: unknown };

type Totals = {
  fetched: number;
  inserted: number;
  updated: number;
  associated: number;
  windows: number;
};

type HistoricalSeismicSource = {
  code: string;
  limit: number;
  minWindowMs: number;
  fetchWindow: (start: Date, end: Date, limit: number) => Promise<SeismicRecord[]>;
};

type HistoricalAuxSource<T> = {
  code: string;
  limit: number;
  minWindowMs: number;
  fetchWindow: (start: Date, end: Date, limit: number) => Promise<Array<AuxiliaryRecord<T>>>;
  persist: (records: Array<AuxiliaryRecord<T>>) => Promise<SeismicIngestionStats>;
};

type OneShotSeismicSource = {
  code: string;
  fetchAll: () => Promise<SeismicRecord[]>;
};

const USGS_FDSN_QUERY_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const NOAA_PREVIOUS_EVENTS_URL = "https://www.tsunami.gov/php/prevEventresults.php";
const NOAA_PRODUCT_CODES = [
  "WEPA41",
  "WEPA43",
  "WEAK51",
  "WEAK53",
  "SEAK71",
  "SEUS71",
  "WEXX20",
  "WEXX22",
  "WEXX30",
  "WEXX32",
  "SEXX60",
  "WECA40",
  "WECA41",
  "WECA42",
  "WECA43",
  "WEGM40",
  "WEGM42",
  "WEHW40",
  "WEHW42",
  "WEPA40",
  "WEPA42",
  "WEZS40",
  "WEZS42"
] as const;

type PreviousBulletin = {
  eventID?: string;
  bulletinNumber?: number;
  TWCID?: "PAAQ" | "PHEB";
  WMOID?: string;
  bulletinURL?: string;
};

function parseArg(flag: string, fallback: string): string {
  const prefix = `--${flag}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function parseSourceSelection(): Set<string> | null {
  const raw = parseArg("sources", "").trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
  );
}

function startOfUtcDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfUtcDay(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function midpoint(start: Date, end: Date): Date {
  return new Date(Math.floor((start.getTime() + end.getTime()) / 2));
}

function addTotals(target: Totals, partial: Totals): Totals {
  return {
    fetched: target.fetched + partial.fetched,
    inserted: target.inserted + partial.inserted,
    updated: target.updated + partial.updated,
    associated: target.associated + partial.associated,
    windows: target.windows + partial.windows
  };
}

function emptyTotals(): Totals {
  return { fetched: 0, inserted: 0, updated: 0, associated: 0, windows: 0 };
}

function summarizeSeismicStats(stats: SeismicIngestionStats, fetched: number): Totals {
  return {
    fetched,
    inserted: stats.inserted,
    updated: stats.updated,
    associated: stats.associated,
    windows: 1
  };
}

function uniqueSeismicRecords(records: SeismicRecord[]): SeismicRecord[] {
  const byId = new Map<string, SeismicRecord>();
  for (const record of records) {
    byId.set(record.event.eventId, record);
  }
  return [...byId.values()].sort(
    (left, right) => Date.parse(left.event.eventTimeUtc) - Date.parse(right.event.eventTimeUtc)
  );
}

function uniqueAuxiliaryRecords<T>(
  records: Array<AuxiliaryRecord<T>>,
  keyOf: (record: AuxiliaryRecord<T>) => string
): Array<AuxiliaryRecord<T>> {
  const byKey = new Map<string, AuxiliaryRecord<T>>();
  for (const record of records) {
    byKey.set(keyOf(record), record);
  }
  return [...byKey.values()];
}

async function withRetry<T>(label: string, job: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await job();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[retry ${attempt}/${attempts - 1}] ${label}: ${message}`);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label}: unknown error`);
}

async function persistSeismic(records: SeismicRecord[]): Promise<SeismicIngestionStats> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stats = await ingestSeismicRecords(client, uniqueSeismicRecords(records), env.streamChannel, {
      notify: false
    });
    await client.query("COMMIT");
    return stats;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function persistContexts(
  records: Array<AuxiliaryRecord<DisasterContext>>
): Promise<SeismicIngestionStats> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stats = await ingestDisasterContexts(
      client,
      uniqueAuxiliaryRecords(records, (record) => record.item.contextId)
    );
    await client.query("COMMIT");
    return stats;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function persistTsunami(records: Array<AuxiliaryRecord<TsunamiProduct>>): Promise<SeismicIngestionStats> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stats = await ingestTsunamiProducts(
      client,
      uniqueAuxiliaryRecords(records, (record) => record.item.productId)
    );
    await client.query("COMMIT");
    return stats;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function logWindow(source: string, start: Date, end: Date, fetched: number, stats: SeismicIngestionStats): void {
  console.log(
    `${source} ${formatDateOnly(start)}..${formatDateOnly(end)} fetched=${fetched} inserted=${stats.inserted} updated=${stats.updated} associated=${stats.associated}`
  );
}

async function runAdaptiveSeismicSource(
  source: HistoricalSeismicSource,
  start: Date,
  end: Date
): Promise<Totals> {
  const records = await withRetry(`${source.code} ${start.toISOString()} ${end.toISOString()}`, () =>
    source.fetchWindow(start, end, source.limit)
  );

  if (records.length >= source.limit && end.getTime() - start.getTime() > source.minWindowMs) {
    const split = midpoint(start, end);
    const left = await runAdaptiveSeismicSource(source, start, split);
    const right = await runAdaptiveSeismicSource(source, split, end);
    return addTotals(left, right);
  }

  const stats = await persistSeismic(records);
  logWindow(source.code, start, end, records.length, stats);
  return summarizeSeismicStats(stats, records.length);
}

async function runAdaptiveAuxSource<T>(
  source: HistoricalAuxSource<T>,
  start: Date,
  end: Date
): Promise<Totals> {
  const records = await withRetry(`${source.code} ${formatDateOnly(start)} ${formatDateOnly(end)}`, () =>
    source.fetchWindow(start, end, source.limit)
  );

  if (records.length >= source.limit && end.getTime() - start.getTime() > source.minWindowMs) {
    const split = midpoint(start, end);
    const left = await runAdaptiveAuxSource(source, start, split);
    const right = await runAdaptiveAuxSource(source, split, end);
    return addTotals(left, right);
  }

  const stats = await source.persist(records);
  logWindow(source.code, start, end, records.length, stats);
  return summarizeSeismicStats(stats, records.length);
}

function buildFdsnWindowSource(config: {
  code: Parameters<typeof createFdsnProvider>[0]["code"];
  baseUrl: string;
  network: string;
  minMagnitude?: number;
  limit?: number;
  minWindowMs?: number;
}): HistoricalSeismicSource {
  return {
    code: config.code,
    limit: config.limit ?? 1000,
    minWindowMs: config.minWindowMs ?? 12 * 3_600_000,
    async fetchWindow(start, end, limit) {
      const params = new URLSearchParams({
        format: "text",
        starttime: start.toISOString().replace(/\.\d{3}Z$/, ""),
        endtime: end.toISOString().replace(/\.\d{3}Z$/, ""),
        minmagnitude: String(config.minMagnitude ?? 2.5),
        orderby: "time",
        limit: String(limit)
      });
      const payload = await fetchText(`${config.baseUrl}?${params.toString()}`);
      const ingestedAt = new Date().toISOString();
      return parseFdsnText(payload).flatMap((record) => {
        const event = normalizeFdsnRecord(record, config.code, config.network, config.baseUrl, ingestedAt);
        return event ? [{ event, rawPayload: record }] : [];
      });
    }
  };
}

const usgsHistoricalSource: HistoricalSeismicSource = {
  code: "USGS",
  limit: 1500,
  minWindowMs: 6 * 3_600_000,
  async fetchWindow(start, end, limit) {
    const params = new URLSearchParams({
      format: "geojson",
      starttime: start.toISOString(),
      endtime: end.toISOString(),
      minmagnitude: "2.5",
      orderby: "time",
      limit: String(limit)
    });
    const payload = await fetchJson<UsgsGeoJson>(
      `${USGS_FDSN_QUERY_URL}?${params.toString()}`,
      "application/geo+json, application/json;q=0.9"
    );
    assertShape(usgsGeoJsonSchema, payload, "USGS");
    const ingestedAt = new Date().toISOString();
    return payload.features.map((feature) => ({
      event: normalizeUsgsFeature(feature, ingestedAt),
      rawPayload: feature
    }));
  }
};

const emscHistoricalSource: HistoricalSeismicSource = {
  code: "EMSC",
  limit: 1500,
  minWindowMs: 6 * 3_600_000,
  async fetchWindow(start, end, limit) {
    const params = new URLSearchParams({
      format: "json",
      starttime: start.toISOString(),
      endtime: end.toISOString(),
      minmagnitude: "2.5",
      orderby: "time",
      limit: String(limit)
    });
    const payload = await fetchJson<{ features?: EmscFeature[] }>(`${env.emscFdsnUrl}?${params.toString()}`);
    assertShape(emscResponseSchema, payload, "EMSC");
    const ingestedAt = new Date().toISOString();
    return (payload.features ?? []).flatMap((feature) => {
      const event = normalizeEmscFeature(feature, ingestedAt);
      return event ? [{ event, rawPayload: feature }] : [];
    });
  }
};

const geofonHistoricalSource: HistoricalSeismicSource = {
  code: "GEOFON",
  limit: 1500,
  minWindowMs: 6 * 3_600_000,
  async fetchWindow(start, end, limit) {
    const params = new URLSearchParams({
      format: "text",
      starttime: start.toISOString(),
      endtime: end.toISOString(),
      minmagnitude: "2.5",
      orderby: "time",
      limit: String(limit)
    });
    const payload = await fetchText(`${env.geofonFdsnUrl}?${params.toString()}`);
    const ingestedAt = new Date().toISOString();
    return parseFdsnText(payload).flatMap((record) => {
      const event = normalizeGeofonRecord(record, ingestedAt);
      return event ? [{ event, rawPayload: record }] : [];
    });
  }
};

const ingvHistoricalSource: HistoricalSeismicSource = {
  code: "INGV",
  limit: 1000,
  minWindowMs: 12 * 3_600_000,
  async fetchWindow(start, end, limit) {
    const params = new URLSearchParams({
      format: "text",
      starttime: start.toISOString().replace(/\.\d{3}Z$/, ""),
      endtime: end.toISOString().replace(/\.\d{3}Z$/, ""),
      orderby: "time",
      limit: String(limit)
    });
    const payload = await fetchText(`${env.ingvFdsnUrl}?${params.toString()}`);
    const ingestedAt = new Date().toISOString();
    return parseFdsnText(payload).flatMap((record) => {
      const event = normalizeIngvRecord(record, ingestedAt);
      return event ? [{ event, rawPayload: record }] : [];
    });
  }
};

const gdacsHistoricalSource: HistoricalAuxSource<DisasterContext> = {
  code: "GDACS",
  limit: 100,
  minWindowMs: 24 * 3_600_000,
  async fetchWindow(start, end, limit) {
    const params = new URLSearchParams({
      eventlist: "EQ",
      fromdate: formatDateOnly(start),
      todate: formatDateOnly(end),
      pagesize: String(limit)
    });
    const payload = await fetchJson<GdacsResponse>(`${env.gdacsApiUrl}?${params.toString()}`);
    assertShape(gdacsResponseSchema, payload, "GDACS");
    return (payload.features ?? []).flatMap((feature) => {
      const item = normalizeGdacsFeature(feature);
      return item ? [{ item, rawPayload: feature }] : [];
    });
  },
  persist: persistContexts
};

function parsePreviousBulletins(html: string): PreviousBulletin[] {
  if (/No Previous Event Messages found/i.test(html)) return [];
  const match = html.match(/var\s+prevBulletins\s*=\s*\{\s*'previous'\s*:\s*(\[[\s\S]*?\])\s*\};/);
  if (!match) return [];
  return JSON.parse(match[1]) as PreviousBulletin[];
}

async function fetchNoaaProducts(start: Date, end: Date, limit: number): Promise<Array<AuxiliaryRecord<TsunamiProduct>>> {
  const params = new URLSearchParams({
    start_date: formatDateOnly(start),
    end_date: formatDateOnly(end),
    bulletin_count: String(limit)
  });
  for (const product of NOAA_PRODUCT_CODES) {
    params.append("products[]", product);
  }
  const html = await fetchText(`${NOAA_PREVIOUS_EVENTS_URL}?${params.toString()}`);
  const entries = parsePreviousBulletins(html);
  const capPaths = new Map<string, "NOAA_PTWC" | "NOAA_NTWC">();

  for (const entry of entries) {
    if (!entry.bulletinURL || !entry.TWCID || !entry.WMOID) continue;
    const source = entry.TWCID === "PHEB" ? "NOAA_PTWC" : "NOAA_NTWC";
    const capUrl = `https://www.tsunami.gov${entry.bulletinURL}/${entry.WMOID}/${entry.TWCID}CAP.xml`;
    capPaths.set(capUrl, source);
  }

  const records: Array<AuxiliaryRecord<TsunamiProduct>> = [];
  for (const [capUrl, source] of capPaths.entries()) {
    try {
      const xml = await fetchXml(capUrl);
      records.push({
        item: parseNoaaCap(xml, source, capUrl),
        rawPayload: xml
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`NOAA skip ${capUrl}: ${message}`);
    }
  }
  return records;
}

const noaaHistoricalSource: HistoricalAuxSource<TsunamiProduct> = {
  code: "NOAA_CAP",
  limit: 200,
  minWindowMs: 24 * 3_600_000,
  fetchWindow: fetchNoaaProducts,
  persist: persistTsunami
};

const oneShotSources: OneShotSeismicSource[] = [
  {
    code: "IGP",
    async fetchAll() {
      const records = await fetchJson<IgpRecord[]>(env.igpFeedUrlTemplate.replace("{year}", "2026"));
      const ingestedAt = new Date().toISOString();
      return records.flatMap((record) => {
        const event = normalizeIgpRecord(record, ingestedAt);
        return event ? [{ event, rawPayload: record }] : [];
      });
    }
  },
  {
    code: "IGEPN",
    async fetchAll() {
      const csv = await fetchText(env.igepnEventsCsvUrl);
      const ingestedAt = new Date().toISOString();
      return parseIgepnCsv(csv).flatMap((record) => {
        const event = normalizeIgepnRecord(record, ingestedAt);
        return event ? [{ event, rawPayload: record }] : [];
      });
    }
  },
  {
    code: "INPRES",
    async fetchAll() {
      const xml = await fetchXml(env.inpresSismosXmlUrl);
      const ingestedAt = new Date().toISOString();
      return parseInpresXml(xml).flatMap((record) => {
        const event = normalizeInpresItem(record, ingestedAt);
        return event ? [{ event, rawPayload: record }] : [];
      });
    }
  },
  {
    code: "IGN",
    async fetchAll() {
      const payload = await fetchText(env.ignEarthquakesJsUrl);
      const collection = extractNamedJsonObject(payload, "dias30") as IgnFeatureCollection;
      const ingestedAt = new Date().toISOString();
      return (collection.features ?? []).flatMap((record) => {
        const event = normalizeIgnFeature(record, ingestedAt);
        return event ? [{ event, rawPayload: record }] : [];
      });
    }
  }
];

const historicalSeismicSources: HistoricalSeismicSource[] = [
  usgsHistoricalSource,
  emscHistoricalSource,
  geofonHistoricalSource,
  buildFdsnWindowSource({ code: "SED", baseUrl: env.sedFdsnUrl, network: "SED" }),
  buildFdsnWindowSource({ code: "RENASS", baseUrl: env.renassFdsnUrl, network: "RENASS" }),
  buildFdsnWindowSource({ code: "ISC", baseUrl: env.iscFdsnUrl, network: "ISC" }),
  buildFdsnWindowSource({ code: "GA", baseUrl: env.gaFdsnUrl, network: "GA" }),
  buildFdsnWindowSource({ code: "NRCAN", baseUrl: env.nrcanFdsnUrl, network: "NRCAN" }),
  buildFdsnWindowSource({
    code: "NCEDC",
    baseUrl: env.ncedcFdsnUrl,
    network: "NCEDC",
    limit: 1000,
    minWindowMs: 24 * 3_600_000
  }),
  buildFdsnWindowSource({
    code: "KNMI",
    baseUrl: env.knmiFdsnUrl,
    network: "KNMI",
    minMagnitude: 1,
    limit: 1000,
    minWindowMs: 24 * 3_600_000
  }),
  buildFdsnWindowSource({
    code: "SCEDC",
    baseUrl: env.scedcFdsnUrl,
    network: "SCEDC",
    limit: 1000,
    minWindowMs: 24 * 3_600_000
  }),
  ingvHistoricalSource
];

function inRange(event: SeismicEvent, from: Date, to: Date): boolean {
  const eventTime = Date.parse(event.eventTimeUtc);
  return eventTime >= from.getTime() && eventTime <= to.getTime();
}

async function runOneShotSource(source: OneShotSeismicSource, from: Date, to: Date): Promise<Totals> {
  const fetched = await withRetry(source.code, () => source.fetchAll());
  const records = fetched.filter((record) => inRange(record.event, from, to));
  const stats = await persistSeismic(records);
  console.log(
    `${source.code} one-shot fetched=${records.length} inserted=${stats.inserted} updated=${stats.updated} associated=${stats.associated}`
  );
  return summarizeSeismicStats(stats, records.length);
}

async function printDatabaseSummary(): Promise<void> {
  const events = await pool.query("SELECT COUNT(*)::int AS total FROM seismic_events");
  const refs = await pool.query("SELECT COUNT(*)::int AS total FROM event_source_refs");
  const contexts = await pool.query("SELECT COUNT(*)::int AS total FROM disaster_contexts");
  const tsunami = await pool.query("SELECT COUNT(*)::int AS total FROM tsunami_products");
  console.log("DB SUMMARY");
  console.log(`seismic_events=${events.rows[0]?.total ?? 0}`);
  console.log(`event_source_refs=${refs.rows[0]?.total ?? 0}`);
  console.log(`disaster_contexts=${contexts.rows[0]?.total ?? 0}`);
  console.log(`tsunami_products=${tsunami.rows[0]?.total ?? 0}`);
}

async function main(): Promise<void> {
  const from = startOfUtcDay(parseArg("from", "2026-01-01"));
  const to = endOfUtcDay(parseArg("to", new Date().toISOString().slice(0, 10)));
  const selectedSources = parseSourceSelection();
  const includeAux = parseArg("include-aux", "true").toLowerCase() !== "false";
  const includeSnapshots = parseArg("include-snapshots", "true").toLowerCase() !== "false";

  console.log(`Backfill 2026 from=${from.toISOString()} to=${to.toISOString()}`);

  let totals = emptyTotals();

  for (const source of historicalSeismicSources) {
    if (selectedSources && !selectedSources.has(source.code)) continue;
    totals = addTotals(totals, await runAdaptiveSeismicSource(source, from, to));
  }

  if (includeSnapshots) {
    for (const source of oneShotSources) {
      if (selectedSources && !selectedSources.has(source.code)) continue;
      totals = addTotals(totals, await runOneShotSource(source, from, to));
    }
  }

  if (includeAux && (!selectedSources || selectedSources.has("GDACS"))) {
    totals = addTotals(totals, await runAdaptiveAuxSource(gdacsHistoricalSource, from, to));
  }

  if (includeAux && (!selectedSources || selectedSources.has("NOAA_CAP"))) {
    totals = addTotals(totals, await runAdaptiveAuxSource(noaaHistoricalSource, from, to));
  }

  console.log("BACKFILL TOTALS");
  console.log(JSON.stringify(totals, null, 2));
  await printDatabaseSummary();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
