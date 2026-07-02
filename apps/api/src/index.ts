import { createServer } from "node:http";

import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { StreamBroker } from "./services/streamBroker.js";

const streamBroker = new StreamBroker();

async function main() {
  await streamBroker.start();
  const app = createApp(streamBroker);
  const server = createServer(app);

  server.listen(env.apiPort, () => {
    console.log(`API listening on http://localhost:${env.apiPort}`);
  });

  const shutdown = async () => {
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
