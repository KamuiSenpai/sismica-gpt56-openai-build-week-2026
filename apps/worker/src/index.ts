import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { runIngestion } from "./services/ingestionService.js";
import { runSeismicEngineCycle } from "./services/seismicEngine/engine.js";
import { refreshStationCatalogIfDue } from "./services/stationCatalogService.js";
import { runYoutubeChatPublisherCycle } from "./services/youtubeChatPublisher.js";

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

// Motor experimental: triangula epicentros y publica telemetria por el adaptador interno.
// Fallar aqui (p. ej. si la API aun no responde) no debe detener la ingesta.
async function runEngineSafely() {
  try {
    const summary = await runSeismicEngineCycle();
    if (summary.status === "skipped") {
      console.log(`seismic engine skipped: ${summary.reason}`);
    } else {
      console.log(
        `seismic engine: origins=${summary.publishedOrigins}, triggered stations=${summary.triggeredStations}`
      );
    }
  } catch (error) {
    console.error("Seismic engine cycle failed", error);
  }
}

async function runYoutubeChatPublisherSafely() {
  try {
    const summary = await runYoutubeChatPublisherCycle();
    if (summary.status === "posted") {
      console.log(`youtube chat posted: messageId=${summary.messageId}, reason=${summary.reason}`);
      return;
    }
    if (summary.status === "skipped" || summary.status === "failed") {
      console.warn(
        `youtube chat ${summary.status}: messageId=${summary.messageId}, reason=${summary.reason}`
      );
    }
  } catch (error) {
    console.error("YouTube chat publisher cycle failed", error);
  }
}

async function main() {
  if (env.runOnce) {
    await executeOnce();
    await runEngineSafely();
    await runYoutubeChatPublisherSafely();
    await pool.end();
    return;
  }

  await executeOnce();
  await runEngineSafely();
  await runYoutubeChatPublisherSafely();

  const timer = setInterval(async () => {
    try {
      await executeOnce();
    } catch (error) {
      console.error("Scheduled ingestion failed", error);
    }
  }, env.pollIntervalMs);

  const engineTimer = setInterval(runEngineSafely, env.seismicEngineIntervalMs);
  const youtubeChatTimer = setInterval(runYoutubeChatPublisherSafely, env.youtubeChatPublishIntervalMs);

  const shutdown = async () => {
    clearInterval(timer);
    clearInterval(engineTimer);
    clearInterval(youtubeChatTimer);
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
