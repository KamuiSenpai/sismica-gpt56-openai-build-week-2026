import { pool } from "../apps/api/src/db/pool.js";
import { env } from "../apps/api/src/config/env.js";
import { refreshSeismicPresenceMaterialization } from "../apps/api/src/services/seismicPresenceRepository.js";

async function main(): Promise<void> {
  try {
    const result = await refreshSeismicPresenceMaterialization(pool, {
      batchSize: env.analyticsRefreshBatchSize
    });
    console.log(JSON.stringify(result));
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
