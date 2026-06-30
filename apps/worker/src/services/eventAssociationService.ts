import { type SeismicEvent, type SourceCode, type StreamEvent } from "@sismica/shared";
import { type PoolClient } from "pg";

import { type SeismicRecord } from "../providers/types.js";

export type SeismicIngestionStats = {
  inserted: number;
  updated: number;
  associated: number;
};

type MatchRow = {
  event_id: string;
  time_delta_seconds: number;
  distance_km: number;
  magnitude_delta: number | null;
  score: number;
};

type ExistingReference = {
  event_id: string;
  unchanged: boolean;
};

type CanonicalRow = {
  event_id: string;
  source: SourceCode;
  source_event_id: string;
  title: string;
  magnitude: number | null;
  magnitude_type: string | null;
  latitude: number;
  longitude: number;
  depth_km: number | null;
  mmi: number | null;
  cdi: number | null;
  intensity_text: string | null;
  station_count: number | null;
  azimuthal_gap_deg: number | null;
  nearest_station_deg: number | null;
  rms_sec: number | null;
  significance: number | null;
  felt_reports: number | null;
  alert_level: string | null;
  tsunami: boolean;
  network_code: string | null;
  provider_event_code: string | null;
  event_type: string | null;
  detail_url: string | null;
  event_time_utc: Date;
  updated_at_utc: Date | null;
  status: string | null;
  source_url: string | null;
  ingested_at: Date;
  sources: SourceCode[];
};

const PERU_BOUNDS = { minLat: -19.5, maxLat: 0.5, minLon: -82.5, maxLon: -68.5 };
const VENEZUELA_BOUNDS = { minLat: 0, maxLat: 13.5, minLon: -74.5, maxLon: -58.5 };
const NEW_ZEALAND_BOUNDS = { minLat: -49, maxLat: -28, minLon: 160, maxLon: 180 };
const KERMADEC_BOUNDS = { minLat: -37, maxLat: -20, minLon: -180, maxLon: -170 };
export const DEDUPLICATION_LIMITS = {
  timeSeconds: 60,
  distanceKm: 100,
  magnitudeDelta: 0.5
} as const;

export function isAssociationCandidate(
  timeDeltaSeconds: number,
  distanceKm: number,
  magnitudeDelta: number | null
): boolean {
  return timeDeltaSeconds <= DEDUPLICATION_LIMITS.timeSeconds
    && distanceKm < DEDUPLICATION_LIMITS.distanceKm
    && (magnitudeDelta === null || magnitudeDelta < DEDUPLICATION_LIMITS.magnitudeDelta);
}

function withinBounds(latitude: number, longitude: number, bounds: typeof PERU_BOUNDS): boolean {
  return latitude >= bounds.minLat && latitude <= bounds.maxLat
    && longitude >= bounds.minLon && longitude <= bounds.maxLon;
}

export function sourcePriority(source: SourceCode, latitude: number, longitude: number): number {
  if (withinBounds(latitude, longitude, PERU_BOUNDS)) {
    return { IGP: 100, USGS: 80, GEOFON: 75, EMSC: 70, FUNVISIS: 40, GEONET: 40 }[source];
  }
  if (withinBounds(latitude, longitude, VENEZUELA_BOUNDS)) {
    return { FUNVISIS: 100, USGS: 80, GEOFON: 75, EMSC: 70, IGP: 40, GEONET: 40 }[source];
  }
  if (
    withinBounds(latitude, longitude, NEW_ZEALAND_BOUNDS)
    || withinBounds(latitude, longitude, KERMADEC_BOUNDS)
  ) {
    return { GEONET: 100, USGS: 80, GEOFON: 75, EMSC: 70, IGP: 40, FUNVISIS: 40 }[source];
  }
  return { USGS: 80, GEOFON: 75, EMSC: 70, IGP: 50, FUNVISIS: 50, GEONET: 50 }[source];
}

function canonicalParams(event: SeismicEvent, rawPayload: unknown, priority: number): unknown[] {
  return [
    event.eventId,
    event.source,
    event.sourceEventId,
    event.title,
    event.magnitude,
    event.magnitudeType,
    event.depthKm,
    event.eventTimeUtc,
    event.updatedAtUtc,
    event.status,
    event.sourceUrl,
    event.longitude,
    event.latitude,
    JSON.stringify(rawPayload),
    event.mmi,
    event.cdi,
    event.intensityText,
    event.stationCount,
    event.azimuthalGapDeg,
    event.nearestStationDeg,
    event.rmsSec,
    event.significance,
    event.feltReports,
    event.alertLevel,
    event.tsunami,
    event.networkCode,
    event.providerEventCode,
    event.eventType,
    event.detailUrl,
    priority
  ];
}

async function insertCanonical(
  client: PoolClient,
  event: SeismicEvent,
  rawPayload: unknown,
  priority: number
): Promise<void> {
  await client.query(
    `
      INSERT INTO seismic_events (
        event_id, source, source_event_id, title, magnitude, magnitude_type,
        depth_km, event_time_utc, updated_at_utc, status, source_url, geom,
        raw_payload, mmi, cdi, intensity_text, station_count,
        azimuthal_gap_deg, nearest_station_deg, rms_sec, significance,
        felt_reports, alert_level, tsunami, network_code,
        provider_event_code, event_type, detail_url, preferred_source_priority,
        ingested_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        ST_SetSRID(ST_MakePoint($12, $13), 4326)::geography,
        $14::jsonb, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
        $25, $26, $27, $28, $29, $30, NOW()
      )
    `,
    canonicalParams(event, rawPayload, priority)
  );
}

async function updateCanonical(
  client: PoolClient,
  eventId: string,
  event: SeismicEvent,
  rawPayload: unknown,
  priority: number
): Promise<void> {
  const params = canonicalParams({ ...event, eventId }, rawPayload, priority);
  await client.query(
    `
      UPDATE seismic_events
      SET
        source = $2,
        source_event_id = $3,
        title = $4,
        magnitude = $5,
        magnitude_type = $6,
        depth_km = $7,
        event_time_utc = $8,
        updated_at_utc = $9,
        status = $10,
        source_url = $11,
        geom = ST_SetSRID(ST_MakePoint($12, $13), 4326)::geography,
        raw_payload = $14::jsonb,
        mmi = $15,
        cdi = $16,
        intensity_text = $17,
        station_count = $18,
        azimuthal_gap_deg = $19,
        nearest_station_deg = $20,
        rms_sec = $21,
        significance = $22,
        felt_reports = $23,
        alert_level = $24,
        tsunami = $25,
        network_code = $26,
        provider_event_code = $27,
        event_type = $28,
        detail_url = $29,
        preferred_source_priority = $30,
        ingested_at = NOW()
      WHERE event_id = $1
    `,
    params
  );
}

async function upsertReference(
  client: PoolClient,
  eventId: string,
  record: SeismicRecord
): Promise<void> {
  const event = record.event;
  await client.query(
    `
      INSERT INTO event_source_refs (
        source, source_event_id, event_id, title, magnitude, magnitude_type,
        depth_km, intensity_text, event_time_utc, updated_at_utc, status,
        source_url, detail_url, geom, raw_payload, ingested_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        ST_SetSRID(ST_MakePoint($14, $15), 4326)::geography,
        $16::jsonb, NOW()
      )
      ON CONFLICT (source, source_event_id) DO UPDATE SET
        title = EXCLUDED.title,
        magnitude = EXCLUDED.magnitude,
        magnitude_type = EXCLUDED.magnitude_type,
        depth_km = EXCLUDED.depth_km,
        intensity_text = EXCLUDED.intensity_text,
        event_time_utc = EXCLUDED.event_time_utc,
        updated_at_utc = EXCLUDED.updated_at_utc,
        status = EXCLUDED.status,
        source_url = EXCLUDED.source_url,
        detail_url = EXCLUDED.detail_url,
        geom = EXCLUDED.geom,
        raw_payload = EXCLUDED.raw_payload,
        ingested_at = NOW()
    `,
    [
      event.source,
      event.sourceEventId,
      eventId,
      event.title,
      event.magnitude,
      event.magnitudeType,
      event.depthKm,
      event.intensityText,
      event.eventTimeUtc,
      event.updatedAtUtc,
      event.status,
      event.sourceUrl,
      event.detailUrl,
      event.longitude,
      event.latitude,
      JSON.stringify(record.rawPayload)
    ]
  );
}

async function findExistingReference(
  client: PoolClient,
  source: SourceCode,
  sourceEventId: string,
  rawPayload: unknown
): Promise<ExistingReference | null> {
  const result = await client.query<ExistingReference>(
    `
      SELECT event_id, raw_payload = $3::jsonb AS unchanged
      FROM event_source_refs
      WHERE source = $1 AND source_event_id = $2
    `,
    [source, sourceEventId, JSON.stringify(rawPayload)]
  );
  return result.rows[0] ?? null;
}

async function findMatch(client: PoolClient, event: SeismicEvent): Promise<MatchRow | null> {
  const result = await client.query<MatchRow>(
    `
      SELECT
        event_id,
        ABS(EXTRACT(EPOCH FROM (event_time_utc - $1::timestamptz)))::double precision AS time_delta_seconds,
        (ST_Distance(geom, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) / 1000.0)::double precision AS distance_km,
        CASE WHEN magnitude IS NULL OR $4::double precision IS NULL
          THEN NULL
          ELSE ABS(magnitude - $4::double precision)
        END AS magnitude_delta,
        (
          ABS(EXTRACT(EPOCH FROM (event_time_utc - $1::timestamptz))) / 60.0
          + ST_Distance(geom, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) / 100000.0
          + CASE WHEN magnitude IS NULL OR $4::double precision IS NULL
              THEN 0
              ELSE ABS(magnitude - $4::double precision) / 0.5
            END
        )::double precision AS score
      FROM seismic_events
      WHERE event_time_utc BETWEEN $1::timestamptz - INTERVAL '${DEDUPLICATION_LIMITS.timeSeconds} seconds'
        AND $1::timestamptz + INTERVAL '${DEDUPLICATION_LIMITS.timeSeconds} seconds'
        AND ST_DWithin(
          geom,
          ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
          ${DEDUPLICATION_LIMITS.distanceKm * 1000}
        )
        AND ($4::double precision IS NULL OR magnitude IS NULL OR ABS(magnitude - $4::double precision) < ${DEDUPLICATION_LIMITS.magnitudeDelta})
        AND NOT EXISTS (
          SELECT 1
          FROM event_source_refs same_source
          WHERE same_source.event_id = seismic_events.event_id
            AND same_source.source = $5
        )
      ORDER BY score ASC
      LIMIT 1
    `,
    [event.eventTimeUtc, event.longitude, event.latitude, event.magnitude, event.source]
  );
  return result.rows[0] ?? null;
}

async function shouldReplaceCanonical(
  client: PoolClient,
  eventId: string,
  source: SourceCode,
  priority: number
): Promise<boolean> {
  const result = await client.query<{ source: SourceCode; preferred_source_priority: number }>(
    `SELECT source, preferred_source_priority FROM seismic_events WHERE event_id = $1`,
    [eventId]
  );
  const current = result.rows[0];
  return !current || current.source === source || priority > current.preferred_source_priority;
}

async function loadCanonicalEvent(client: PoolClient, eventId: string): Promise<SeismicEvent> {
  const result = await client.query<CanonicalRow>(
    `
      SELECT
        event_id,
        source,
        source_event_id,
        title,
        magnitude,
        magnitude_type,
        ST_Y(geom::geometry) AS latitude,
        ST_X(geom::geometry) AS longitude,
        depth_km,
        mmi,
        cdi,
        intensity_text,
        station_count,
        azimuthal_gap_deg,
        nearest_station_deg,
        rms_sec,
        significance,
        felt_reports,
        alert_level,
        tsunami,
        network_code,
        provider_event_code,
        event_type,
        detail_url,
        event_time_utc,
        updated_at_utc,
        status,
        source_url,
        ingested_at,
        ARRAY(
          SELECT DISTINCT ref.source
          FROM event_source_refs ref
          WHERE ref.event_id = seismic_events.event_id
          ORDER BY ref.source
        )::text[] AS sources
      FROM seismic_events
      WHERE event_id = $1
    `,
    [eventId]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Canonical event ${eventId} not found`);
  return {
    eventId: row.event_id,
    source: row.source,
    sourceEventId: row.source_event_id,
    title: row.title,
    magnitude: row.magnitude,
    magnitudeType: row.magnitude_type,
    latitude: row.latitude,
    longitude: row.longitude,
    depthKm: row.depth_km,
    mmi: row.mmi,
    cdi: row.cdi,
    intensityText: row.intensity_text,
    stationCount: row.station_count,
    azimuthalGapDeg: row.azimuthal_gap_deg,
    nearestStationDeg: row.nearest_station_deg,
    rmsSec: row.rms_sec,
    significance: row.significance,
    feltReports: row.felt_reports,
    alertLevel: row.alert_level,
    tsunami: row.tsunami,
    networkCode: row.network_code,
    providerEventCode: row.provider_event_code,
    eventType: row.event_type,
    detailUrl: row.detail_url,
    sources: row.sources,
    sourceCount: row.sources.length,
    eventTimeUtc: row.event_time_utc.toISOString(),
    updatedAtUtc: row.updated_at_utc?.toISOString() ?? null,
    status: row.status,
    sourceUrl: row.source_url,
    ingestedAt: row.ingested_at.toISOString()
  };
}

async function notifyEvent(
  client: PoolClient,
  streamChannel: string,
  type: StreamEvent["type"],
  eventId: string
): Promise<void> {
  const payload: StreamEvent = { type, payload: await loadCanonicalEvent(client, eventId) };
  await client.query("SELECT pg_notify($1, $2)", [streamChannel, JSON.stringify(payload)]);
}

export async function ingestSeismicRecords(
  client: PoolClient,
  records: SeismicRecord[],
  streamChannel: string
): Promise<SeismicIngestionStats> {
  const stats: SeismicIngestionStats = { inserted: 0, updated: 0, associated: 0 };

  for (const record of records) {
    const event = record.event;
    const priority = sourcePriority(event.source, event.latitude, event.longitude);
    const existingReference = await findExistingReference(
      client,
      event.source,
      event.sourceEventId,
      record.rawPayload
    );

    if (existingReference) {
      if (existingReference.unchanged) {
        continue;
      }
      await upsertReference(client, existingReference.event_id, record);
      if (await shouldReplaceCanonical(client, existingReference.event_id, event.source, priority)) {
        await updateCanonical(client, existingReference.event_id, event, record.rawPayload, priority);
        await notifyEvent(client, streamChannel, "event.updated", existingReference.event_id);
      }
      stats.updated += 1;
      continue;
    }

    const match = await findMatch(client, event);
    if (match) {
      await upsertReference(client, match.event_id, record);
      await client.query(
        `
          INSERT INTO event_associations (
            event_id, source, source_event_id, time_delta_seconds,
            distance_km, magnitude_delta, score
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (source, source_event_id) DO NOTHING
        `,
        [
          match.event_id,
          event.source,
          event.sourceEventId,
          match.time_delta_seconds,
          match.distance_km,
          match.magnitude_delta,
          match.score
        ]
      );
      if (await shouldReplaceCanonical(client, match.event_id, event.source, priority)) {
        await updateCanonical(client, match.event_id, event, record.rawPayload, priority);
      }
      await notifyEvent(client, streamChannel, "event.updated", match.event_id);
      stats.associated += 1;
      continue;
    }

    await insertCanonical(client, event, record.rawPayload, priority);
    await upsertReference(client, event.eventId, record);
    await notifyEvent(client, streamChannel, "event.created", event.eventId);
    stats.inserted += 1;
  }

  return stats;
}
