import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const migrationUrl = new URL(
  "../migrations/0001_inventory_catalogue_accuracy.sql",
  import.meta.url,
);
const sql = await readFile(fileURLToPath(migrationUrl), "utf8");
const client = new pg.Client({ connectionString });

await client.connect();
try {
  await client.query(sql);
  console.log("Inventory catalogue migration applied");
} finally {
  await client.end();
}