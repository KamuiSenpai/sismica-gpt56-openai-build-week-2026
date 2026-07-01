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

type ExistingCanonical = {
  event_id: string;
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
const VENEZUELA_BOUNDS = { minLat: 0, maxLat: 13.5, minLon: -73.3, maxLon: -58.5 };
const COLOMBIA_BOUNDS = { minLat: -4.5, maxLat: 14.5, minLon: -82.5, maxLon: -66 };
const ECUADOR_BOUNDS = { minLat: -5.5, maxLat: 2.5, minLon: -92, maxLon: -75 };
const ARGENTINA_BOUNDS = { minLat: -56, maxLat: -21, minLon: -75, maxLon: -53 };
const MEXICO_BOUNDS = { minLat: 14.8, maxLat: 33.5, minLon: -119, maxLon: -85.5 };
const COSTA_RICA_BOUNDS = { minLat: 5.5, maxLat: 12.5, minLon: -88.5, maxLon: -82 };
const EL_SALVADOR_BOUNDS = { minLat: 11.5, maxLat: 15, minLon: -90.4, maxLon: -87 };
const GUATEMALA_BOUNDS = { minLat: 12, maxLat: 19, minLon: -93, maxLon: -88 };
const CHILE_BOUNDS = { minLat: -57, maxLat: -17, minLon: -80.5, maxLon: -66 };
const CHILE_PRIMARY_BOUNDS = { minLat: -57, maxLat: -17, minLon: -80.5, maxLon: -69.8 };
const ITALY_BOUNDS = { minLat: 34, maxLat: 48.5, minLon: 5, maxLon: 20.5 };
const NEW_ZEALAND_BOUNDS = { minLat: -49, maxLat: -28, minLon: 160, maxLon: 180 };
const KERMADEC_BOUNDS = { minLat: -37, maxLat: -20, minLon: -180, maxLon: -170 };
const INDONESIA_BOUNDS = { minLat: -11.5, maxLat: 6.5, minLon: 94, maxLon: 142 };
const JAPAN_BOUNDS = { minLat: 24, maxLat: 46, minLon: 122, maxLon: 154 };
const TAIWAN_BOUNDS = { minLat: 20, maxLat: 27, minLon: 118, maxLon: 123 };
const IGN_REGION_BOUNDS = { minLat: 24, maxLat: 45, minLon: -19, maxLon: 6 };
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
  return (
    timeDeltaSeconds <= DEDUPLICATION_LIMITS.timeSeconds &&
    distanceKm < DEDUPLICATION_LIMITS.distanceKm &&
    (magnitudeDelta === null || magnitudeDelta < DEDUPLICATION_LIMITS.magnitudeDelta)
  );
}

function withinBounds(latitude: number, longitude: number, bounds: typeof PERU_BOUNDS): boolean {
  return (
    latitude >= bounds.minLat &&
    latitude <= bounds.maxLat &&
    longitude >= bounds.minLon &&
    longitude <= bounds.maxLon
  );
}

const BASE_SOURCE_PRIORITY: Record<SourceCode, number> = {
  USGS: 80,
  GEOFON: 75,
  ISC: 72,
  EMSC: 70,
  RENASS: 60,
  SED: 50,
  GA: 55,
  NRCAN: 55,
  NCEDC: 55,
  KNMI: 55,
  SCEDC: 55,
  IGP: 50,
  FUNVISIS: 50,
  GEONET: 50,
  BMKG: 50,
  JMA: 50,
  CWA: 50,
  SGC: 50,
  IGN: 50,
  SSN: 50,
  CSN: 50,
  INGV: 50,
  IGEPN: 50,
  INPRES: 50,
  MARN: 50,
  OVSICORI: 50,
  INSIVUMEH: 50
};

function priorityWith(source: SourceCode, overrides: Partial<Record<SourceCode, number>>): number {
  return overrides[source] ?? BASE_SOURCE_PRIORITY[source];
}

export function sourcePriority(source: SourceCode, latitude: number, longitude: number): number {
  if (withinBounds(latitude, longitude, ECUADOR_BOUNDS)) {
    return priorityWith(source, {
      IGEPN: 100,
      IGP: 70,
      SGC: 65
    });
  }
  if (withinBounds(latitude, longitude, PERU_BOUNDS)) {
    return priorityWith(source, {
      IGP: 100,
      IGEPN: 70
    });
  }
  if (withinBounds(latitude, longitude, VENEZUELA_BOUNDS)) {
    return priorityWith(source, { FUNVISIS: 100 });
  }
  if (withinBounds(latitude, longitude, COLOMBIA_BOUNDS)) {
    return priorityWith(source, {
      SGC: 100,
      IGEPN: 65
    });
  }
  if (withinBounds(latitude, longitude, CHILE_PRIMARY_BOUNDS)) {
    return priorityWith(source, { CSN: 100, INPRES: 65 });
  }
  if (withinBounds(latitude, longitude, ARGENTINA_BOUNDS)) {
    return priorityWith(source, {
      INPRES: 100,
      CSN: 75
    });
  }
  if (withinBounds(latitude, longitude, MEXICO_BOUNDS)) {
    return priorityWith(source, { SSN: 100 });
  }
  if (withinBounds(latitude, longitude, COSTA_RICA_BOUNDS)) {
    return priorityWith(source, {
      OVSICORI: 100,
      MARN: 70,
      INSIVUMEH: 65,
      SSN: 60
    });
  }
  if (withinBounds(latitude, longitude, EL_SALVADOR_BOUNDS)) {
    return priorityWith(source, {
      MARN: 100,
      INSIVUMEH: 80,
      OVSICORI: 65,
      SSN: 60
    });
  }
  if (withinBounds(latitude, longitude, GUATEMALA_BOUNDS)) {
    return priorityWith(source, {
      INSIVUMEH: 100,
      MARN: 70,
      OVSICORI: 65,
      SSN: 60
    });
  }
  if (withinBounds(latitude, longitude, CHILE_BOUNDS)) {
    return priorityWith(source, { CSN: 100, INPRES: 65 });
  }
  if (withinBounds(latitude, longitude, ITALY_BOUNDS)) {
    return priorityWith(source, { INGV: 100 });
  }
  if (
    withinBounds(latitude, longitude, NEW_ZEALAND_BOUNDS) ||
    withinBounds(latitude, longitude, KERMADEC_BOUNDS)
  ) {
    return priorityWith(source, { GEONET: 100 });
  }
  if (withinBounds(latitude, longitude, INDONESIA_BOUNDS)) {
    return priorityWith(source, { BMKG: 100 });
  }
  if (withinBounds(latitude, longitude, TAIWAN_BOUNDS)) {
    return priorityWith(source, { CWA: 100 });
  }
  if (withinBounds(latitude, longitude, JAPAN_BOUNDS)) {
    return priorityWith(source, { JMA: 100 });
  }
  if (withinBounds(latitude, longitude, IGN_REGION_BOUNDS)) {
    return priorityWith(source, { IGN: 100 });
  }
  return BASE_SOURCE_PRIORITY[source];
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

async function upsertReference(client: PoolClient, eventId: string, record: SeismicRecord): Promise<void> {
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

async function findExistingCanonical(client: PoolClient, eventId: string): Promise<ExistingCanonical | null> {
  const result = await client.query<ExistingCanonical>(
    `
      SELECT event_id
      FROM seismic_events
      WHERE event_id = $1
      LIMIT 1
    `,
    [eventId]
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

type CanonicalPreference = {
  source: SourceCode;
  preferred_source_priority: number;
};

async function loadCanonicalPreference(
  client: PoolClient,
  eventId: string
): Promise<CanonicalPreference | null> {
  const result = await client.query<{ source: SourceCode; preferred_source_priority: number }>(
    `SELECT source, preferred_source_priority FROM seismic_events WHERE event_id = $1`,
    [eventId]
  );
  return result.rows[0] ?? null;
}

async function shouldReplaceCanonical(
  client: PoolClient,
  eventId: string,
  source: SourceCode,
  priority: number
): Promise<boolean> {
  const current = await loadCanonicalPreference(client, eventId);
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
  streamChannel: string,
  options?: {
    notify?: boolean;
  }
): Promise<SeismicIngestionStats> {
  const stats: SeismicIngestionStats = { inserted: 0, updated: 0, associated: 0 };
  const notify = options?.notify ?? true;

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
        const current = await loadCanonicalPreference(client, existingReference.event_id);
        const needsRefresh =
          current &&
          ((current.source === event.source && current.preferred_source_priority !== priority) ||
            (current.source !== event.source && priority > current.preferred_source_priority));
        if (needsRefresh) {
          await updateCanonical(client, existingReference.event_id, event, record.rawPayload, priority);
          if (notify && current.source !== event.source) {
            await notifyEvent(client, streamChannel, "event.updated", existingReference.event_id);
          }
          stats.updated += 1;
        }
        continue;
      }
      await upsertReference(client, existingReference.event_id, record);
      if (await shouldReplaceCanonical(client, existingReference.event_id, event.source, priority)) {
        await updateCanonical(client, existingReference.event_id, event, record.rawPayload, priority);
        if (notify) {
          await notifyEvent(client, streamChannel, "event.updated", existingReference.event_id);
        }
      }
      stats.updated += 1;
      continue;
    }

    const existingCanonical = await findExistingCanonical(client, event.eventId);
    if (existingCanonical) {
      await upsertReference(client, existingCanonical.event_id, record);
      if (await shouldReplaceCanonical(client, existingCanonical.event_id, event.source, priority)) {
        await updateCanonical(client, existingCanonical.event_id, event, record.rawPayload, priority);
        if (notify) {
          await notifyEvent(client, streamChannel, "event.updated", existingCanonical.event_id);
        }
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
      if (notify) {
        await notifyEvent(client, streamChannel, "event.updated", match.event_id);
      }
      stats.associated += 1;
      continue;
    }

    await insertCanonical(client, event, record.rawPayload, priority);
    await upsertReference(client, event.eventId, record);
    if (notify) {
      await notifyEvent(client, streamChannel, "event.created", event.eventId);
    }
    stats.inserted += 1;
  }

  return stats;
}
