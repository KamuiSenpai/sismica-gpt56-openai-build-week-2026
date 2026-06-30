import { randomUUID } from "node:crypto";

import { type OperationalSourceCode } from "@sismica/shared";

import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { bmkgProvider } from "../providers/bmkgProvider.js";
import { cwaProvider } from "../providers/cwaProvider.js";
import { emscProvider } from "../providers/emscProvider.js";
import { funvisisProvider } from "../providers/funvisisProvider.js";
import { gdacsProvider } from "../providers/gdacsProvider.js";
import { geofonProvider } from "../providers/geofonProvider.js";
import { geoNetProvider } from "../providers/geoNetProvider.js";
import { igpProvider } from "../providers/igpProvider.js";
import { jmaProvider } from "../providers/jmaProvider.js";
import { noaaNtwcProvider, noaaPtwcProvider } from "../providers/noaaProvider.js";
import { type AuxiliaryProvider, type SeismicProvider } from "../providers/types.js";
import { usgsProvider } from "../providers/usgsProvider.js";
import {
  ingestDisasterContexts,
  ingestTsunamiProducts,
  type AuxiliaryIngestionStats
} from "./auxiliaryIngestionService.js";
import { ingestSeismicRecords, type SeismicIngestionStats } from "./eventAssociationService.js";

type RunStats = SeismicIngestionStats;

const SOURCE_INTERVALS_MS: Record<OperationalSourceCode, number> = {
  USGS: 60_000,
  EMSC: 60_000,
  IGP: 120_000,
  FUNVISIS: 120_000,
  GEOFON: 120_000,
  GEONET: 120_000,
  BMKG: 120_000,
  JMA: 120_000,
  CWA: 120_000,
  GDACS: 360_000,
  NOAA_PTWC: 120_000,
  NOAA_NTWC: 120_000
};

const STALE_RUNNING_GRACE_MS = 15 * 60_000;
const STALE_RUNNING_MESSAGE = "Sanitized stale running entry: worker stopped before marking completion";

export type SourceRunSummary = RunStats & {
  source: OperationalSourceCode;
  status: "success" | "error";
  errorMessage: string | null;
};

async function sanitizeStaleRuns(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_RUNNING_GRACE_MS);
  const result = await pool.query(
    `
      UPDATE ingestion_runs
      SET
        finished_at = COALESCE(finished_at, NOW()),
        status = 'error',
        error_message = COALESCE(error_message, $2)
      WHERE status = 'running'
        AND started_at < $1
    `,
    [cutoff, STALE_RUNNING_MESSAGE]
  );
  return result.rowCount ?? 0;
}

async function isSourceDue(source: OperationalSourceCode): Promise<boolean> {
  if (env.runOnce) return true;
  const result = await pool.query<{ started_at: Date; status: string }>(
    `SELECT started_at, status FROM ingestion_runs WHERE source = $1 ORDER BY started_at DESC LIMIT 1`,
    [source]
  );
  const last = result.rows[0];
  if (!last) return true;
  const interval =
    last.status === "error" ? Math.min(60_000, SOURCE_INTERVALS_MS[source]) : SOURCE_INTERVALS_MS[source];
  return Date.now() - last.started_at.getTime() >= interval;
}

async function startRun(source: OperationalSourceCode): Promise<{ runId: string; startedAt: Date }> {
  const runId = randomUUID();
  const startedAt = new Date();
  await pool.query(
    `
      INSERT INTO ingestion_runs (run_id, source, started_at, status)
      VALUES ($1, $2, $3, 'running')
    `,
    [runId, source, startedAt]
  );
  return { runId, startedAt };
}

async function finishRun(runId: string, stats: RunStats): Promise<void> {
  await pool.query(
    `
      UPDATE ingestion_runs
      SET
        finished_at = NOW(),
        status = 'success',
        inserted_count = $2,
        updated_count = $3,
        associated_count = $4
      WHERE run_id = $1
    `,
    [runId, stats.inserted, stats.updated, stats.associated]
  );
}

async function failRun(runId: string, error: unknown): Promise<string> {
  const message = error instanceof Error ? error.message : "Unknown error";
  await pool.query(
    `
      UPDATE ingestion_runs
      SET finished_at = NOW(), status = 'error', error_message = $2
      WHERE run_id = $1
    `,
    [runId, message]
  );
  return message;
}

async function persistSeismic(
  provider: SeismicProvider,
  runId: string,
  records: Awaited<ReturnType<SeismicProvider["fetchEvents"]>>
): Promise<SourceRunSummary> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stats = await ingestSeismicRecords(client, records, env.streamChannel);
    await client.query("COMMIT");
    await finishRun(runId, stats);
    return { source: provider.code, status: "success", errorMessage: null, ...stats };
  } catch (error) {
    await client.query("ROLLBACK");
    const errorMessage = await failRun(runId, error);
    return {
      source: provider.code,
      status: "error",
      errorMessage,
      inserted: 0,
      updated: 0,
      associated: 0
    };
  } finally {
    client.release();
  }
}

async function persistAuxiliary<T>(
  provider: AuxiliaryProvider<T>,
  runId: string,
  records: Awaited<ReturnType<AuxiliaryProvider<T>["fetchItems"]>>,
  persist: (
    records: Awaited<ReturnType<AuxiliaryProvider<T>["fetchItems"]>>
  ) => Promise<AuxiliaryIngestionStats>
): Promise<SourceRunSummary> {
  try {
    const stats = await persist(records);
    await finishRun(runId, stats);
    return { source: provider.code, status: "success", errorMessage: null, ...stats };
  } catch (error) {
    const errorMessage = await failRun(runId, error);
    return {
      source: provider.code,
      status: "error",
      errorMessage,
      inserted: 0,
      updated: 0,
      associated: 0
    };
  }
}

async function runSeismicProviders(providers: SeismicProvider[]): Promise<SourceRunSummary[]> {
  const jobs = await Promise.all(
    providers.map(async (provider) => ({ provider, ...(await startRun(provider.code)) }))
  );
  const fetched = await Promise.allSettled(jobs.map(({ provider }) => provider.fetchEvents()));
  const summaries: SourceRunSummary[] = [];

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    const result = fetched[index];
    if (result.status === "rejected") {
      const errorMessage = await failRun(job.runId, result.reason);
      summaries.push({
        source: job.provider.code,
        status: "error",
        errorMessage,
        inserted: 0,
        updated: 0,
        associated: 0
      });
      continue;
    }
    summaries.push(await persistSeismic(job.provider, job.runId, result.value));
  }

  return summaries;
}

async function runAuxiliaryProvider<T>(
  provider: AuxiliaryProvider<T>,
  ingest: (
    records: Awaited<ReturnType<AuxiliaryProvider<T>["fetchItems"]>>
  ) => Promise<AuxiliaryIngestionStats>
): Promise<SourceRunSummary | null> {
  if (!(await isSourceDue(provider.code))) return null;
  const { runId } = await startRun(provider.code);
  try {
    const records = await provider.fetchItems();
    return await persistAuxiliary(provider, runId, records, ingest);
  } catch (error) {
    const errorMessage = await failRun(runId, error);
    return {
      source: provider.code,
      status: "error",
      errorMessage,
      inserted: 0,
      updated: 0,
      associated: 0
    };
  }
}

async function runAuxiliaryProviders(): Promise<SourceRunSummary[]> {
  const gdacsIngest = async (records: Awaited<ReturnType<typeof gdacsProvider.fetchItems>>) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const stats = await ingestDisasterContexts(client, records);
      await client.query("COMMIT");
      return stats;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  const tsunamiIngest = async (records: Awaited<ReturnType<typeof noaaPtwcProvider.fetchItems>>) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const stats = await ingestTsunamiProducts(client, records);
      await client.query("COMMIT");
      return stats;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  const summaries = await Promise.all([
    runAuxiliaryProvider(gdacsProvider, gdacsIngest),
    runAuxiliaryProvider(noaaPtwcProvider, tsunamiIngest),
    runAuxiliaryProvider(noaaNtwcProvider, tsunamiIngest)
  ]);
  return summaries.filter((summary): summary is SourceRunSummary => summary !== null);
}

export async function runIngestion(): Promise<SourceRunSummary[]> {
  const sanitizedRuns = await sanitizeStaleRuns();
  if (sanitizedRuns > 0) {
    console.warn(
      `Sanitized ${sanitizedRuns} stale ingestion run(s) older than ${STALE_RUNNING_GRACE_MS / 60_000} minutes.`
    );
  }

  const seismicProviders = [
    usgsProvider,
    emscProvider,
    igpProvider,
    funvisisProvider,
    geofonProvider,
    geoNetProvider,
    bmkgProvider,
    jmaProvider,
    cwaProvider
  ];
  const dueSeismicProviders: SeismicProvider[] = [];
  for (const provider of seismicProviders) {
    if (await isSourceDue(provider.code)) dueSeismicProviders.push(provider);
  }
  const seismic = await runSeismicProviders(dueSeismicProviders);
  const auxiliary = await runAuxiliaryProviders();
  return [...seismic, ...auxiliary];
}
