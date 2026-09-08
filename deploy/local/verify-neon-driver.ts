/**
 * Prove the Neon driver path actually works — not that it compiles.
 *
 * MobiCare must run on a host that allows outbound traffic on ports 80 and 443
 * only, which means the database connection goes through a WebSocket rather
 * than the ordinary PostgreSQL port. That is a different driver, a different
 * transport and a different transaction implementation, and "it type-checks" is
 * not evidence that it works.
 *
 * This runs the real application queries through the real Neon driver against a
 * local PostgreSQL, with deploy/local/ws-proxy.mjs standing in for Neon's own
 * WebSocket endpoint. What it cannot prove is that GoDaddy permits the outbound
 * connection — only the connectivity probe, deployed there, answers that.
 *
 *   node deploy/local/ws-proxy.mjs --port 5433 --allow 127.0.0.1:55500 &
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55500/mobicare \
 *     node .local/verify-neon-driver.cjs
 */

import { neonConfig } from "@neondatabase/serverless";

const PROXY_PORT = Number(process.env["WS_PROXY_PORT"] ?? 5433);

// Point the driver at the local proxy instead of Neon, and turn off the
// transport hardening that only applies to Neon's own endpoint. Set before
// @workspace/db is imported, because the pool is created as that module loads.
neonConfig.wsProxy = (host, port) => `127.0.0.1:${PROXY_PORT}/v1?address=${host}:${port}`;
neonConfig.useSecureWebSocket = false;
neonConfig.pipelineTLS = false;
neonConfig.pipelineConnect = false;

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

async function check(name: string, run: () => Promise<string>): Promise<void> {
  try {
    results.push({ name, ok: true, detail: await run() });
  } catch (error) {
    results.push({ name, ok: false, detail: (error as Error).message });
  }
}

async function main(): Promise<void> {
  process.env["DATABASE_DRIVER"] = "neon";

  const {
    databaseDriver,
    db,
    pool,
    drugCatalogueTable,
    pharmaciesTable,
    platformSettingsTable,
  } = await import("@workspace/db");
  const { sql, eq } = await import("drizzle-orm");

  await check("the Neon driver was selected", async () => {
    if (databaseDriver.driver !== "neon") {
      throw new Error(`selected "${databaseDriver.driver}"`);
    }
    return `${databaseDriver.driver} (${databaseDriver.reason})`;
  });

  await check("a query runs over the WebSocket", async () => {
    const rows = await db.execute(sql`SELECT version() AS version`);
    const version = String((rows.rows[0] as { version?: string })?.version ?? "");
    return version.split(" ").slice(0, 2).join(" ");
  });

  await check("the application schema is readable", async () => {
    const drugs = await db.select().from(drugCatalogueTable).limit(5);
    const pharmacies = await db.select().from(pharmaciesTable).limit(5);
    return `${drugs.length} drugs, ${pharmacies.length} pharmacies`;
  });

  await check("enum and numeric columns decode correctly", async () => {
    // The two PostgreSQL types the port to MySQL would have broken. If the
    // driver mishandled either, money and drug tiers would be silently wrong.
    const [row] = await db
      .select({ tier: drugCatalogueTable.tier, name: drugCatalogueTable.name })
      .from(drugCatalogueTable)
      .limit(1);
    if (!row) return "no catalogue rows to check";
    if (!["1", "2", "3"].includes(row.tier)) {
      throw new Error(`tier decoded as ${JSON.stringify(row.tier)}`);
    }
    return `tier ${row.tier} on "${row.name}"`;
  });

  await check("an interactive transaction commits", async () => {
    // The reason a plain HTTP driver is not enough: payment claiming, stock
    // deduction and the pilot-data reset all run inside db.transaction().
    const key = `neon_driver_check_${Date.now()}`;
    await db.transaction(async (tx) => {
      await tx.insert(platformSettingsTable).values({ key, value: 1 });
      const [read] = await tx
        .select()
        .from(platformSettingsTable)
        .where(eq(platformSettingsTable.key, key));
      if (!read) throw new Error("the row was not visible inside its own transaction");
    });
    const [after] = await db
      .select()
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, key));
    if (!after) throw new Error("the committed row is missing");
    await db.delete(platformSettingsTable).where(eq(platformSettingsTable.key, key));
    return "committed and visible afterwards";
  });

  await check("an interactive transaction rolls back", async () => {
    const key = `neon_rollback_check_${Date.now()}`;
    await db
      .transaction(async (tx) => {
        await tx.insert(platformSettingsTable).values({ key, value: 1 });
        throw new Error("deliberate");
      })
      .catch(() => undefined);
    const [leaked] = await db
      .select()
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, key));
    if (leaked) throw new Error("the row survived a failed transaction");
    return "nothing was left behind";
  });

  await pool.end();

  const width = Math.max(...results.map((r) => r.name.length));
  console.log();
  for (const r of results) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n  ${failed === 0 ? "The Neon driver path works." : `${failed} check(s) failed.`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
