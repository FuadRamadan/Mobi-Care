import app, { mountedStaticSites } from "./app";
import { logger } from "./lib/logger";
import { assertSecretsAreSafe } from "./lib/secrets";
import { startOrderExpirySweep, stopOrderExpirySweep } from "./lib/orderExpiry";
import { startCommissionSettlementSweep, stopCommissionSettlementSweep } from "./lib/commissionSettlements";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Verify that the live database schema matches the Drizzle model.
 * Probes for columns added after the initial schema push (e.g. expo_push_token
 * on patients, the patient_notifications table). Exits with a clear error
 * message if anything is missing so operators know to run:
 *   pnpm --filter @workspace/db run migrate
 */
async function assertSchemaUpToDate(): Promise<void> {
  type Row = { exists: boolean };

  const checks: Array<{ label: string; query: ReturnType<typeof sql> }> = [
    {
      label: "patients.expo_push_token column",
      query: sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'patients' AND column_name = 'expo_push_token'
        ) AS exists
      `,
    },
    {
      label: "patients.session_version column",
      query: sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'patients'
            AND column_name = 'session_version'
        ) AS exists
      `,
    },
    {
      label: "patient_notifications table",
      query: sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'patient_notifications'
        ) AS exists
      `,
    },
    {
      label: "orders.patient_hidden_at column",
      query: sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'orders'
            AND column_name = 'patient_hidden_at'
        ) AS exists
      `,
    },
    {
      label: "patient_password_reset_codes table",
      query: sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_name = 'patient_password_reset_codes'
        ) AS exists
      `,
    },
    {
      label: "team_members table",
      query: sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'team_members'
        ) AS exists
      `,
    },
    {
      label: "team_photo_uploads table",
      query: sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'team_photo_uploads'
        ) AS exists
      `,
    },
    {
      label: "api_connections registry",
      query: sql`
        SELECT to_regclass(current_schema() || '.api_connections')
          IS NOT NULL AS exists
      `,
    },
    {
      label: "governed drug catalogue columns",
      query: sql`
        SELECT (
          COUNT(*) = 8
        ) AS exists
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'drug_catalogue'
          AND column_name IN (
            'common_strengths', 'common_forms', 'primary_category',
            'subcategory', 'review_status', 'rejection_reason',
            'reviewed_at', 'reviewed_by_hq_staff_id'
          )
      `,
    },
    {
      label: "complete pharmacy inventory schema",
      query: sql`
        SELECT (
          COUNT(*) = 10
          AND BOOL_AND(
            column_name <> 'price_leones'
            OR data_type = 'numeric'
          )
        ) AS exists
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'pharmacy_inventory'
          AND column_name IN (
            'strength', 'form', 'unit_of_sale', 'expiry_date', 'manufacturer',
            'primary_category', 'subcategory', 'other_category_text',
            'completion_status', 'price_leones'
          )
      `,
    },
    {
      label: "exact inventory order references",
      query: sql`
        SELECT (
          COUNT(*) = 2
          AND BOOL_AND(
            (table_name = 'order_items' AND column_name = 'inventory_id')
            OR data_type = 'numeric'
          )
        ) AS exists
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND (
            (table_name = 'order_items' AND column_name = 'inventory_id')
            OR (table_name = 'orders' AND column_name = 'total_leones')
          )
      `,
    },
    {
      label: "active inventory variant uniqueness index",
      query: sql`
        SELECT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = current_schema()
            AND tablename = 'pharmacy_inventory'
            AND indexname = 'uniq_active_pharmacy_drug_variant'
        ) AS exists
      `,
    },
    {
      label: "daily commission settlement ledger",
      query: sql`
        SELECT to_regclass(current_schema() || '.commission_settlements')
          IS NOT NULL AS exists
      `,
    },
  ];

  const missing: string[] = [];
  for (const { label, query } of checks) {
    const [row] = (await db.execute(query)).rows as Row[];
    if (!row?.exists) missing.push(label);
  }

  if (missing.length > 0) {
    logger.error(
      { missing },
      "Database schema is out of date. Run: pnpm --filter @workspace/db run migrate"
    );
    process.exit(1);
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}


async function start(): Promise<void> {
  assertSecretsAreSafe();
  await assertSchemaUpToDate();
  const server = app.listen(port, "0.0.0.0", () => {
    logger.info(
      { port, staticSites: mountedStaticSites },
      mountedStaticSites.length > 0
        ? "Server listening, serving API and static sites"
        : "Server listening",
    );
    startOrderExpirySweep();
    startCommissionSettlementSweep();
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Graceful shutdown started");
    stopOrderExpirySweep();
    stopCommissionSettlementSweep();
    server.close(async (error) => {
      if (error) logger.error({ err: error }, "HTTP server close failed");
      await pool.end().catch((err) =>
        logger.error({ err }, "Database pool close failed"),
      );
      process.exit(error ? 1 : 0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

start().catch((err) => {
  logger.fatal({ err }, "API startup failed");
  process.exit(1);
});
