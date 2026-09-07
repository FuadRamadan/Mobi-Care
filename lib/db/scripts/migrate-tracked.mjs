/**
 * Tracked migration runner.
 *
 * The original runner (lib/db/scripts/migrate.mjs) re-executes every .sql file
 * on every invocation and keeps no record of what it has done. That works only
 * because the migrations happen to be individually re-runnable, and it cannot
 * build an empty database at all, because the numbered migrations start at 0001
 * with ALTER statements against tables nothing ever creates.
 *
 * This runner records what it applies in a schema_migrations table, so each
 * migration executes exactly once, and pairs with 0000_baseline.sql to create a
 * database from nothing.
 *
 * Modes:
 *
 *   --init    Empty database. Applies 0000_baseline.sql, then records every
 *             existing numbered migration as applied without executing it —
 *             the baseline already contains their cumulative effect.
 *
 *   --adopt   Existing database that is already fully migrated (for example one
 *             moved across from the previous host). Records the baseline and
 *             every numbered migration as applied. Executes nothing, changes no
 *             data. Use this once, before the first ordinary run.
 *
 *   (none)    Applies any numbered migration not yet recorded, oldest first.
 *             This is the normal release-time command.
 *
 * Every mode is a single transaction per file: a failure rolls that file back
 * and leaves schema_migrations consistent with what actually ran.
 *
 * Requires DATABASE_URL.
 */

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const modes = process.argv.slice(2).filter((arg) => arg.startsWith("--"));
const unknown = modes.filter((m) => !["--init", "--adopt"].includes(m));
if (unknown.length > 0) {
  console.error(`Unknown option(s): ${unknown.join(", ")}. Use --init, --adopt, or no option.`);
  process.exit(1);
}
if (modes.length > 1) {
  console.error("Choose one of --init or --adopt, not both.");
  process.exit(1);
}
const mode = modes[0] ?? "apply";

const baselineDir = fileURLToPath(new URL("../baseline/", import.meta.url));
const baselineFile = "0000_baseline.sql";
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

const checksum = (text) => createHash("sha256").update(text).digest("hex");

const client = new pg.Client({ connectionString });
await client.connect();

/** Read a migration's SQL, from whichever directory holds it. */
async function readMigration(name) {
  const dir = name === baselineFile ? baselineDir : migrationsDir;
  return readFile(join(dir, name), "utf8");
}

/** Apply one file inside its own transaction and record it. */
async function apply(name) {
  const sql = await readMigration(name);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)`,
      [name, checksum(sql)],
    );
    await client.query("COMMIT");
    console.log(`applied  ${name}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** Record a file as applied without executing it. */
async function record(name) {
  const sql = await readMigration(name);
  await client.query(
    `INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)
     ON CONFLICT (filename) DO NOTHING`,
    [name, checksum(sql)],
  );
  console.log(`recorded ${name}`);
}

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  const numbered = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const { rows } = await client.query(
    "SELECT filename, checksum FROM schema_migrations",
  );
  const applied = new Map(rows.map((row) => [row.filename, row.checksum]));

  // A migration whose content changed after it ran means the database and the
  // repository disagree about what was applied. Report it rather than guess.
  const drifted = [];
  for (const name of [baselineFile, ...numbered]) {
    const recorded = applied.get(name);
    if (!recorded) continue;
    if (recorded !== checksum(await readMigration(name))) drifted.push(name);
  }
  if (drifted.length > 0) {
    console.error(
      `These migrations changed after they were applied: ${drifted.join(", ")}.\n` +
        "Resolve the difference before running migrations again.",
    );
    process.exit(1);
  }

  if (mode === "--init") {
    if (applied.size > 0) {
      console.error(
        "--init expects an unmigrated database, but schema_migrations already " +
          "has entries. Use --adopt for a database that is already migrated, or " +
          "no option to apply what is pending.",
      );
      process.exit(1);
    }
    const { rows: existing } = await client.query(
      `SELECT to_regclass('public.patients') IS NOT NULL AS has_tables`,
    );
    if (existing[0]?.has_tables) {
      console.error(
        "--init expects an empty database, but application tables already " +
          "exist. Use --adopt instead.",
      );
      process.exit(1);
    }
    await apply(baselineFile);
    for (const name of numbered) await record(name);
    console.log(`\nDatabase initialised: baseline applied, ${numbered.length} migrations recorded.`);
  } else if (mode === "--adopt") {
    for (const name of [baselineFile, ...numbered]) await record(name);
    console.log(
      `\nAdopted existing database: ${numbered.length + 1} entries recorded, nothing executed.`,
    );
  } else {
    if (!applied.has(baselineFile) && applied.size === 0) {
      console.error(
        "This database has no migration history. Use --init for an empty " +
          "database, or --adopt for one that is already migrated.",
      );
      process.exit(1);
    }
    const pending = numbered.filter((name) => !applied.has(name));
    if (pending.length === 0) {
      console.log("Nothing to apply — database is up to date.");
    } else {
      for (const name of pending) await apply(name);
      console.log(`\nApplied ${pending.length} migration(s).`);
    }
  }
} finally {
  await client.end();
}
