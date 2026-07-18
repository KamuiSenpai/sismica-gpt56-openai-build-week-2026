import { type Pool } from "pg";
import { type SeismicStation, type StationStatus } from "@sismica/shared";

type StationRow = {
  station_id: string;
  source: "GEOFON";
  network_code: string;
  station_code: string;
  site_name: string | null;
  country_code: string | null;
  latitude: number;
  longitude: number;
  elevation_m: number | null;
  start_time_utc: Date | null;
  end_time_utc: Date | null;
  source_url: string;
  status: StationStatus | null;
  phase: "P" | "S" | "UNKNOWN" | null;
  latency_ms: number | null;
  trigger_value: number | null;
  observed_at_utc: Date | null;
  sequence: string | null;
  engine: string | null;
};

export type StationQuery = {
  bbox?: [number, number, number, number];
  statuses?: StationStatus[];
  network?: string;
  activeAt?: Date;
  limit: number;
};

function mapStation(row: StationRow): SeismicStation {
  return {
    stationId: row.station_id,
    source: row.source,
    networkCode: row.network_code,
    stationCode: row.station_code,
    siteName: row.site_name,
    countryCode: row.country_code,
    latitude: row.latitude,
    longitude: row.longitude,
    positionType: "fixed_catalog",
    elevationM: row.elevation_m,
    startTimeUtc: row.start_time_utc?.toISOString() ?? null,
    endTimeUtc: row.end_time_utc?.toISOString() ?? null,
    status: row.status ?? "unknown",
    phase: row.phase,
    latencyMs: row.latency_ms,
    triggerValue: row.trigger_value,
    observedAtUtc: row.observed_at_utc?.toISOString() ?? null,
    sequence: row.sequence === null ? null : Number(row.sequence),
    engine: row.engine,
    sourceUrl: row.source_url
  };
}

export async function getStations(database: Pool, query: StationQuery): Promise<SeismicStation[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const parameter = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (query.bbox) {
    const [west, south, east, north] = query.bbox;
    clauses.push(
      `s.longitude BETWEEN ${parameter(west)} AND ${parameter(east)}`,
      `s.latitude BETWEEN ${parameter(south)} AND ${parameter(north)}`
    );
  }
  if (query.statuses?.length) {
    clauses.push(`COALESCE(st.status, 'unknown') = ANY(${parameter(query.statuses)}::text[])`);
  }
  if (query.network) clauses.push(`s.network_code = ${parameter(query.network)}`);
  if (query.activeAt) {
    const activeAt = parameter(query.activeAt);
    clauses.push(`(s.start_time_utc IS NULL OR s.start_time_utc <= ${activeAt})`);
    clauses.push(`(s.end_time_utc IS NULL OR s.end_time_utc >= ${activeAt})`);
  }

  const limit = parameter(query.limit);
  const result = await database.query<StationRow>(
    `
      SELECT
        s.station_id, s.source, s.network_code, s.station_code, s.site_name,
        s.country_code, s.latitude, s.longitude, s.elevation_m,
        s.start_time_utc, s.end_time_utc, s.source_url,
        st.status, st.phase, st.latency_ms, st.trigger_value,
        st.observed_at_utc, st.sequence, st.engine
      FROM seismic_stations s
      LEFT JOIN station_states st ON st.station_id = s.station_id
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY s.network_code, s.station_code
      LIMIT ${limit}
    `,
    values
  );
  return result.rows.map(mapStation);
}

export function parseStationQuery(input: Record<string, string | undefined>): StationQuery {
  const limit = input.limit === undefined ? 1000 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new Error("limit must be an integer between 1 and 5000");
  }

  let bbox: StationQuery["bbox"];
  if (input.bbox) {
    const values = input.bbox.split(",").map(Number);
    if (
      values.length !== 4 ||
      values.some((value) => !Number.isFinite(value)) ||
      values[0] < -180 ||
      values[2] > 180 ||
      values[1] < -90 ||
      values[3] > 90 ||
      values[0] > values[2] ||
      values[1] > values[3]
    ) {
      throw new Error("bbox must be west,south,east,north with valid ordered coordinates");
    }
    bbox = values as [number, number, number, number];
  }

  const allowedStatuses = new Set<StationStatus>(["unknown", "online", "delayed", "offline", "triggered"]);
  const statuses = input.status
    ? input.status.split(",").map((status) => status.trim().toLowerCase() as StationStatus)
    : undefined;
  if (statuses?.some((status) => !allowedStatuses.has(status))) {
    throw new Error("status contains an unsupported station status");
  }

  const activeAt = input.activeAt ? new Date(input.activeAt) : undefined;
  if (activeAt && !Number.isFinite(activeAt.getTime())) throw new Error("activeAt must be an ISO date");
  const network = input.network?.trim().toUpperCase();
  if (network && !/^[A-Z0-9]{1,8}$/.test(network)) throw new Error("network is invalid");

  return { bbox, statuses, network, activeAt, limit };
}
