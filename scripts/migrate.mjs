// Runner de migraciones SQL: aplica db/migrations/*.sql en orden contra DATABASE_URL.
// Uso: npm run db:migrate   (lee .env de la raiz)
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { config } from "dotenv";
import pg from "pg";

config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Falta DATABASE_URL (definelo en .env).");
  process.exit(1);
}

const migrationsDir = path.join(process.cwd(), "db", "migrations");
const files = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("No hay migraciones en db/migrations.");
  process.exit(0);
}

const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    await client.query(sql);
    console.log(`applied ${file}`);
  }
  console.log(`migraciones completadas (${files.length}).`);
} catch (error) {
  console.error("Fallo la migracion:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
