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
 *   pnpm --filter @workspace/db run push
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
      label: "patient_notifications table",
      query: sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'patient_notifications'
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
      "Database schema is out of date. Run: pnpm --filter @workspace/db run push"
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
