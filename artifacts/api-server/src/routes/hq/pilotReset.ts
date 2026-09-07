/**
 * Clear the data the pilot collected, so the platform can start clean for real
 * trading.
 *
 * The what and the why live in pilotResetPlan.ts; this file is the transaction,
 * the confirmation check, and the image cleanup that follows.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { safeRouter } from "../../lib/safeRouter.js";
import { writeAuditStrict } from "../../lib/audit.js";
import {
  isObjectStorageConfigured,
  ObjectStorageService,
} from "../../lib/storage/objectStorage.js";
import type { AuthRequest } from "../../middlewares/auth.js";
import {
  CONFIRMATION_PHRASE,
  countSql,
  deleteSql,
  PRESERVED,
  RESET_STEPS,
} from "./pilotResetPlan.js";

const router = safeRouter();
const objectStorage = new ObjectStorageService();

/** Mirrors the upload path in routes/patient/uploads.ts. */
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads/prescriptions");

/**
 * Local keys are server-generated as "<uuid>.<ext>", and routes/prescriptionImages.ts
 * re-checks that shape before reading one. This does the same before deleting,
 * where a traversal segment would be considerably worse than a bad read.
 */
const LOCAL_FILENAME = /^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i;

type Counts = Record<string, number>;

/**
 * Remove a prescription image from wherever it was stored.
 *
 * Best effort, and outside the transaction: object storage cannot roll back
 * with the database, so the rows are the source of truth and the files are
 * tidied afterwards. A failure here is reported, not thrown — the reset itself
 * has already succeeded.
 */
async function deleteImage(imageKey: string): Promise<boolean> {
  try {
    if (imageKey.startsWith("cloud:")) {
      if (!isObjectStorageConfigured()) return false;
      await objectStorage.deleteObjectEntity(imageKey.slice("cloud:".length));
      return true;
    }
    if (imageKey.startsWith("local:")) {
      const filename = imageKey.slice("local:".length);
      if (!LOCAL_FILENAME.test(filename)) return false;
      await fs.rm(path.join(UPLOAD_DIR, filename), { force: true });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * GET /hq/insights/reset
 *
 * What a reset would remove, right now. The dialog shows these counts so the
 * decision is made against real numbers rather than a vague warning.
 */
router.get("/", async (_req: AuthRequest, res): Promise<void> => {
  const counts: Counts = {};
  const steps: Array<{ table: string; label: string; rows: number }> = [];
  for (const step of RESET_STEPS) {
    const result = await db.execute(sql.raw(countSql(step)));
    const rows = Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0);
    counts[step.table] = rows;
    steps.push({ table: step.table, label: step.label, rows });
  }
  res.json({
    confirmationPhrase: CONFIRMATION_PHRASE,
    totalRows: Object.values(counts).reduce((sum, n) => sum + n, 0),
    steps,
    preserved: PRESERVED,
  });
});

/**
 * POST /hq/insights/reset  { "confirm": "RESET PILOT DATA" }
 *
 * One transaction: either every table is cleared or none is. A partial reset
 * would leave settlements pointing at orders that no longer exist, which is
 * worse than not having run it at all.
 */
router.post("/", async (req: AuthRequest, res): Promise<void> => {
  const body = z.object({ confirm: z.string() }).safeParse(req.body);
  if (!body.success || body.data.confirm !== CONFIRMATION_PHRASE) {
    res.status(400).json({
      error: `Confirmation required. Send confirm: "${CONFIRMATION_PHRASE}".`,
    });
    return;
  }

  const actorId = req.pharmacy!.sub;
  const actorName = req.pharmacy!.name;

  const { deleted, imageKeys } = await db.transaction(async (tx) => {
    // Collected before the rows go: the files outlive the database rows and
    // would otherwise be unreachable orphans in the bucket.
    const keyRows = await tx.execute(sql`
      SELECT image_key FROM prescription_uploads
      UNION
      SELECT image_key FROM prescriptions
    `);
    const keys = (keyRows.rows as Array<{ image_key?: string | null }>)
      .map((row) => row.image_key)
      .filter((key): key is string => typeof key === "string" && key.length > 0);

    const counts: Counts = {};
    for (const step of RESET_STEPS) {
      const result = await tx.execute(sql.raw(deleteSql(step)));
      counts[step.table] = result.rowCount ?? 0;
    }

    // Inside the transaction: if the deletion rolls back, so does the claim
    // that it happened.
    await writeAuditStrict(
      {
        actorType: "hq",
        actorId,
        actorName,
        action: "data_insights.reset",
        entityType: "data_insights",
        details: { deleted: counts, preserved: PRESERVED },
      },
      tx,
    );

    return { deleted: counts, imageKeys: keys };
  });

  let imagesDeleted = 0;
  for (const key of imageKeys) {
    if (await deleteImage(key)) imagesDeleted += 1;
  }

  res.json({
    deleted,
    totalRows: Object.values(deleted).reduce((sum, n) => sum + n, 0),
    images: { found: imageKeys.length, deleted: imagesDeleted },
    preserved: PRESERVED,
  });
});

export default router;
