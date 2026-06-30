import { type Pool } from "pg";

import {
  type EventSourceReference,
  type EventsQuery,
  type SeismicEvent,
  type SourceCode
} from "@sismica/shared";

type EventRow = {
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

const EVENT_COLUMNS = `
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
`;

function mapEventRow(row: EventRow): SeismicEvent {
  const sources = row.sources.length ? row.sources : [row.source];
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
    sources,
    sourceCount: sources.length,
    eventTimeUtc: row.event_time_utc.toISOString(),
    updatedAtUtc: row.updated_at_utc ? row.updated_at_utc.toISOString() : null,
    status: row.status,
    sourceUrl: row.source_url,
    ingestedAt: row.ingested_at.toISOString()
  };
}

export async function getEvents(pool: Pool, query: EventsQuery): Promise<SeismicEvent[]> {
  const result = await pool.query<EventRow>(
    `
      SELECT ${EVENT_COLUMNS}
      FROM seismic_events
      WHERE COALESCE(magnitude, 0) >= $1
        AND event_time_utc >= NOW() - ($2::text || ' hours')::interval
      ORDER BY event_time_utc DESC
      LIMIT $3
    `,
    [query.minMagnitude, query.hours, query.limit]
  );

  return result.rows.map(mapEventRow);
}

export async function getEventById(pool: Pool, eventId: string): Promise<SeismicEvent | null> {
  const result = await pool.query<EventRow>(
    `
      SELECT ${EVENT_COLUMNS}
      FROM seismic_events
      WHERE event_id = $1
      LIMIT 1
    `,
    [eventId]
  );

  return result.rows[0] ? mapEventRow(result.rows[0]) : null;
}

export async function getEventReferences(pool: Pool, eventId: string): Promise<EventSourceReference[]> {
  const result = await pool.query<{
    source: SourceCode;
    source_event_id: string;
    source_url: string | null;
    magnitude: number | null;
    event_time_utc: Date;
    updated_at_utc: Date | null;
  }>(
    `
      SELECT source, source_event_id, source_url, magnitude, event_time_utc, updated_at_utc
      FROM event_source_refs
      WHERE event_id = $1
      ORDER BY source
    `,
    [eventId]
  );
  return result.rows.map((row) => ({
    source: row.source,
    sourceEventId: row.source_event_id,
    sourceUrl: row.source_url,
    magnitude: row.magnitude,
    eventTimeUtc: row.event_time_utc.toISOString(),
    updatedAtUtc: row.updated_at_utc?.toISOString() ?? null
  }));
}
