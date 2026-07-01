import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { runIngestion } from "./services/ingestionService.js";
import { refreshStationCatalogIfDue } from "./services/stationCatalogService.js";

async function executeOnce() {
  try {
    const stationCount = await refreshStationCatalogIfDue();
    if (stationCount !== null) console.log(`GEOFON station catalog synchronized: ${stationCount}`);
  } catch (error) {
    console.error("Station catalog synchronization failed", error);
  }
  const summaries = await runIngestion();
  for (const summary of summaries) {
    const base = `${summary.source} ingestion ${summary.status}: inserted=${summary.inserted}, updated=${summary.updated}, associated=${summary.associated}`;
    if (summary.errorMessage) {
      console.error(`${base}, error=${summary.errorMessage}`);
    } else {
      console.log(base);
    }
  }
}

async function main() {
  if (env.runOnce) {
    await executeOnce();
    await pool.end();
    return;
  }

  await executeOnce();

  const timer = setInterval(async () => {
    try {
      await executeOnce();
    } catch (error) {
      console.error("Scheduled ingestion failed", error);
    }
  }, env.pollIntervalMs);

  const shutdown = async () => {
    clearInterval(timer);
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(async (error) => {
  console.error("Worker failed", error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
