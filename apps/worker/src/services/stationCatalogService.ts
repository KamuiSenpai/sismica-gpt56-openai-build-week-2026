import { pool } from "../db/pool.js";
import { fetchGeofonStations, type StationCatalogRecord } from "../providers/geofonStationProvider.js";
import { env } from "../config/env.js";

async function upsertStations(records: StationCatalogRecord[], synchronizedAt: Date): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const station of records) {
      await client.query(
        `
          INSERT INTO seismic_stations (
            station_id, source, network_code, station_code, site_name,
            latitude, longitude, elevation_m, start_time_utc, end_time_utc,
            source_url, geom, raw_metadata, metadata_updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography, $12::jsonb, $13
          )
          ON CONFLICT (station_id) DO UPDATE SET
            site_name = EXCLUDED.site_name,
            elevation_m = EXCLUDED.elevation_m,
            start_time_utc = EXCLUDED.start_time_utc,
            end_time_utc = EXCLUDED.end_time_utc,
            source_url = EXCLUDED.source_url,
            raw_metadata = EXCLUDED.raw_metadata,
            metadata_updated_at = EXCLUDED.metadata_updated_at,
            updated_at = NOW()
        `,
        [
          station.stationId,
          station.source,
          station.networkCode,
          station.stationCode,
          station.siteName,
          station.latitude,
          station.longitude,
          station.elevationM,
          station.startTimeUtc,
          station.endTimeUtc,
          station.sourceUrl,
          JSON.stringify(station.rawPayload),
          synchronizedAt
        ]
      );
    }
    await client.query("COMMIT");
    return records.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function refreshStationCatalogIfDue(now = new Date()): Promise<number | null> {
  const latest = await pool.query<{ latest: Date | null }>(
    "SELECT MAX(metadata_updated_at) AS latest FROM seismic_stations WHERE source = 'GEOFON'"
  );
  const lastSync = latest.rows[0]?.latest;
  if (lastSync && now.getTime() - lastSync.getTime() < env.stationCatalogRefreshMs) return null;

  const records = await fetchGeofonStations(now);
  if (records.length === 0) throw new Error("GEOFON station catalog returned no valid stations");
  return upsertStations(records, now);
}
