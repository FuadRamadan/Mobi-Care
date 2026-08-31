import app from "./app";
import { logger } from "./lib/logger";
import { startOrderExpirySweep } from "./lib/orderExpiry";
import { db } from "@workspace/db";
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
      label: "sms_provider_config table",
      query: sql`
        SELECT to_regclass(current_schema() || '.sms_provider_config')
          IS NOT NULL AS exists
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

assertSchemaUpToDate().then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startOrderExpirySweep();
  });
});
