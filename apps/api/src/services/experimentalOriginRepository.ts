import { type Pool } from "pg";
import { type ExperimentalOrigin } from "@sismica/shared";

type OriginRow = {
  origin_id: string;
  engine: string;
  status: ExperimentalOrigin["status"];
  quality: ExperimentalOrigin["quality"];
  origin_time_utc: Date;
  latitude: number;
  longitude: number;
  depth_km: number;
  magnitude: number | null;
  station_count: number;
  rms_sec: number | null;
  azimuthal_gap_deg: number | null;
};

export type ExperimentalOriginQuery = {
  hours: number;
  limit: number;
};

function mapOrigin(row: OriginRow): ExperimentalOrigin {
  return {
    originId: row.origin_id,
    engine: row.engine,
    status: row.status,
    quality: row.quality,
    originTimeUtc: row.origin_time_utc.toISOString(),
    latitude: row.latitude,
    longitude: row.longitude,
    depthKm: row.depth_km,
    magnitude: row.magnitude,
    stationCount: row.station_count,
    rmsSec: row.rms_sec,
    azimuthalGapDeg: row.azimuthal_gap_deg
  };
}

export function parseExperimentalOriginQuery(
  input: Record<string, string | undefined>
): ExperimentalOriginQuery {
  const hours = input.hours === undefined ? 72 : Number(input.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
    throw new Error("hours must be a positive number up to 720");
  }
  const limit = input.limit === undefined ? 200 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("limit must be an integer between 1 and 1000");
  }
  return { hours, limit };
}

// Origenes experimentales (motor propio). Nunca se mezclan con `seismic_events`; se
// excluyen los descartados.
export async function getExperimentalOrigins(
  database: Pool,
  query: ExperimentalOriginQuery
): Promise<ExperimentalOrigin[]> {
  const result = await database.query<OriginRow>(
    `
      SELECT origin_id, engine, status, quality, origin_time_utc,
             latitude, longitude, depth_km, magnitude, station_count,
             rms_sec, azimuthal_gap_deg
        FROM experimental_origins
       WHERE status <> 'discarded'
         AND origin_time_utc >= NOW() - ($1::double precision * INTERVAL '1 hour')
       ORDER BY origin_time_utc DESC
       LIMIT $2
    `,
    [query.hours, query.limit]
  );
  return result.rows.map(mapOrigin);
}
