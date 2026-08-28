import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const migrationFiles = (await readdir(migrationsDir))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const client = new pg.Client({ connectionString });

await client.connect();
try {
  for (const migrationFile of migrationFiles) {
    const sql = await readFile(join(migrationsDir, migrationFile), "utf8");
    await client.query(sql);
    console.log(`Applied ${migrationFile}`);
  }
} finally {
  await client.end();
}