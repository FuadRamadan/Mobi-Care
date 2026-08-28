import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const schema = `inventory_migration_test_${Date.now()}`;
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const migrations = await Promise.all(
  (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map(async (name) => readFile(join(migrationsDir, name), "utf8")),
);
const client = new pg.Client({ connectionString });

await client.connect();
try {
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  await client.query(`
    CREATE TABLE hq_staff (id uuid PRIMARY KEY);
    CREATE TABLE pharmacies (id uuid PRIMARY KEY);
    CREATE TABLE patients (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      phone text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE drug_catalogue (id uuid PRIMARY KEY);
    CREATE TABLE pharmacy_inventory (
      id uuid PRIMARY KEY,
      pharmacy_id uuid NOT NULL,
      drug_id uuid NOT NULL,
      price_leones integer NOT NULL,
      is_active boolean NOT NULL DEFAULT true
    );
    ALTER TABLE pharmacy_inventory
      ADD CONSTRAINT uniq_pharmacy_drug UNIQUE (pharmacy_id, drug_id);
    CREATE TABLE orders (id uuid PRIMARY KEY, total_leones integer NOT NULL);
    CREATE TABLE order_items (
      id uuid PRIMARY KEY,
      unit_price_leones integer NOT NULL
    );
    INSERT INTO pharmacy_inventory
      (id, pharmacy_id, drug_id, price_leones)
    VALUES
      ('00000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-000000000002',
       '00000000-0000-0000-0000-000000000003',
       5000);
  `);
  for (const migration of migrations) await client.query(migration);

  const { rows } = await client.query(`
    SELECT
      pi.completion_status = 'incomplete' AS legacy_incomplete,
      pi.price_leones = 5000.00 AS price_preserved,
      c.data_type = 'numeric' AS numeric_price,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'uniq_active_pharmacy_drug_variant'
      ) AS variant_index,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'patients'
          AND column_name = 'session_version'
      ) AS patient_session_version,
      to_regclass(current_schema() || '.patient_password_reset_codes')
        IS NOT NULL AS password_reset_table
    FROM pharmacy_inventory pi
    JOIN information_schema.columns c
      ON c.table_schema = current_schema()
     AND c.table_name = 'pharmacy_inventory'
     AND c.column_name = 'price_leones'
  `);
  const result = rows[0];
  if (
    !result?.legacy_incomplete ||
    !result?.price_preserved ||
    !result?.numeric_price ||
    !result?.variant_index ||
    !result?.patient_session_version ||
    !result?.password_reset_table
  ) {
    throw new Error(`Migration assertion failed: ${JSON.stringify(result)}`);
  }
  console.log("Legacy schema migration test passed");
} finally {
  await client.query("RESET search_path").catch(() => undefined);
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
  await client.end();
}