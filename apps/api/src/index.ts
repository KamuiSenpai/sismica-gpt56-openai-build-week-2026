import { createServer } from "node:http";

import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { StreamBroker } from "./services/streamBroker.js";
import { refreshSeismicPresenceMaterialization } from "./services/seismicPresenceRepository.js";

const streamBroker = new StreamBroker();

async function main() {
  await streamBroker.start();
  const app = createApp(streamBroker);
  const server = createServer(app);
  let presenceRefreshRunning = false;
  const refreshPresence = () => {
    if (presenceRefreshRunning) return;
    presenceRefreshRunning = true;
    void refreshSeismicPresenceMaterialization(pool, {
      onlyIfStale: true,
      batchSize: env.analyticsRefreshBatchSize
    })
      .catch((error) => console.error("Failed to refresh seismic presence materialization", error))
      .finally(() => {
        presenceRefreshRunning = false;
      });
  };
  const presenceRefreshTimer = setInterval(() => {
    refreshPresence();
  }, env.analyticsRefreshIntervalMs);
  presenceRefreshTimer.unref();

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => reject(error);
    server.once("error", handleError);
    server.listen(env.apiPort, () => {
      server.off("error", handleError);
      resolve();
    });
  });
  console.log(`API listening on http://localhost:${env.apiPort}`);
  refreshPresence();

  const shutdown = async () => {
    clearInterval(presenceRefreshTimer);
    server.close();
    await streamBroker.stop();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(async (error) => {
  console.error("Failed to start API", error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
