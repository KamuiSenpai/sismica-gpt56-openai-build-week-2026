import { type SourceCode } from "@sismica/shared";

import { pool } from "../db/pool.js";
import { normalizeSourceTitleText } from "../services/locationTextNormalizer.js";

type RefRow = {
  source: SourceCode;
  source_event_id: string;
  title: string;
};

type EventRow = {
  event_id: string;
  source: SourceCode;
  title: string;
};

type ScriptOptions = {
  all: boolean;
  hours: number;
  batchSize: number;
};

function parseArgs(argv: string[]): ScriptOptions {
  let all = false;
  let hours = 720;
  let batchSize = 500;

  for (const arg of argv) {
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg.startsWith("--hours=")) {
      const parsed = Number.parseInt(arg.slice("--hours=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) hours = parsed;
      continue;
    }
    if (arg.startsWith("--batch=")) {
      const parsed = Number.parseInt(arg.slice("--batch=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) batchSize = parsed;
    }
  }

  return { all, hours, batchSize };
}

async function normalizeReferenceTitles(
  options: ScriptOptions
): Promise<{ scanned: number; updated: number }> {
  let offset = 0;
  let scanned = 0;
  let updated = 0;

  while (true) {
    const scope = options.all ? "" : "WHERE event_time_utc >= NOW() - ($1::int * INTERVAL '1 hour')";
    const params = options.all ? [options.batchSize, offset] : [options.hours, options.batchSize, offset];
    const result = await pool.query<RefRow>(
      `
        SELECT source, source_event_id, title
        FROM event_source_refs
        ${scope}
        ORDER BY event_time_utc DESC, source, source_event_id
        LIMIT $${options.all ? 1 : 2}
        OFFSET $${options.all ? 2 : 3}
      `,
      params
    );
    if (result.rows.length === 0) break;

    scanned += result.rows.length;
    for (const row of result.rows) {
      const normalized = normalizeSourceTitleText(row.source, row.title);
      if (normalized === row.title) continue;
      await pool.query(
        `
          UPDATE event_source_refs
          SET title = $3
          WHERE source = $1 AND source_event_id = $2
        `,
        [row.source, row.source_event_id, normalized]
      );
      updated += 1;
    }

    offset += result.rows.length;
  }

  return { scanned, updated };
}

async function normalizeCanonicalTitles(
  options: ScriptOptions
): Promise<{ scanned: number; updated: number }> {
  let offset = 0;
  let scanned = 0;
  let updated = 0;

  while (true) {
    const scope = options.all ? "" : "WHERE event_time_utc >= NOW() - ($1::int * INTERVAL '1 hour')";
    const params = options.all ? [options.batchSize, offset] : [options.hours, options.batchSize, offset];
    const result = await pool.query<EventRow>(
      `
        SELECT event_id, source, title
        FROM seismic_events
        ${scope}
        ORDER BY event_time_utc DESC, event_id
        LIMIT $${options.all ? 1 : 2}
        OFFSET $${options.all ? 2 : 3}
      `,
      params
    );
    if (result.rows.length === 0) break;

    scanned += result.rows.length;
    for (const row of result.rows) {
      const normalized = normalizeSourceTitleText(row.source, row.title);
      if (normalized === row.title) continue;
      await pool.query(
        `
          UPDATE seismic_events
          SET title = $2
          WHERE event_id = $1
        `,
        [row.event_id, normalized]
      );
      updated += 1;
    }

    offset += result.rows.length;
  }

  return { scanned, updated };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(
    options.all
      ? `Normalizando titulos legacy en toda la base (batch=${options.batchSize})`
      : `Normalizando titulos legacy de las ultimas ${options.hours} horas (batch=${options.batchSize})`
  );

  const refs = await normalizeReferenceTitles(options);
  const canonical = await normalizeCanonicalTitles(options);

  console.log(`event_source_refs: revisados=${refs.scanned}, actualizados=${refs.updated}`);
  console.log(`seismic_events: revisados=${canonical.scanned}, actualizados=${canonical.updated}`);
}

main()
  .catch((error) => {
    console.error("Fallo la normalizacion legacy de titulos", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
