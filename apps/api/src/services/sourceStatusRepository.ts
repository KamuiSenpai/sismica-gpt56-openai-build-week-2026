import { type Pool } from "pg";

import { type OperationalSourceCode, type SourceStatus } from "@sismica/shared";

type SourceStatusRow = {
  source: OperationalSourceCode;
  started_at: Date | null;
  finished_at: Date | null;
  status: "success" | "error" | "running" | "unknown";
  inserted_count: number | null;
  updated_count: number | null;
  associated_count: number | null;
  error_message: string | null;
};

const CONFIGURED_SOURCES: OperationalSourceCode[] = [
  "USGS",
  "EMSC",
  "IGP",
  "FUNVISIS",
  "GEOFON",
  "GEONET",
  "BMKG",
  "JMA",
  "CWA",
  "GDACS",
  "NOAA_PTWC",
  "NOAA_NTWC"
];

export async function getSourceStatuses(pool: Pool): Promise<SourceStatus[]> {
  const result = await pool.query<SourceStatusRow>(
    `
      SELECT DISTINCT ON (source)
        source,
        started_at,
        finished_at,
        status,
        inserted_count,
        updated_count,
        associated_count,
        error_message
      FROM ingestion_runs
      ORDER BY source, started_at DESC
    `
  );

  const bySource = new Map(result.rows.map((row) => [row.source, row]));
  return CONFIGURED_SOURCES.map((source) => {
    const row = bySource.get(source);
    return {
      source,
      lastRunStartedAt: row?.started_at?.toISOString() ?? null,
      lastRunFinishedAt: row?.finished_at?.toISOString() ?? null,
      status: row?.status ?? "unknown",
      insertedCount: row?.inserted_count ?? 0,
      updatedCount: row?.updated_count ?? 0,
      associatedCount: row?.associated_count ?? 0,
      errorMessage: row?.error_message ?? null
    };
  });
}
