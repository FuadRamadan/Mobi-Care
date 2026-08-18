import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

const router = Router();

// ── GET /hq/audit?entityType=...&entityId=...&limit=... ──────────────────────
// Read-only. The audit log is APPEND-ONLY: no POST/PATCH/DELETE routes exist
// for this table anywhere in the API, and none must ever be added.
router.get("/", async (req, res) => {
  const entityType = req.query.entityType as string | undefined;
  const entityId = req.query.entityId as string | undefined;
  const limitRaw = Number(req.query.limit ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

  const conditions: SQL[] = [];
  if (entityType) conditions.push(eq(auditLogTable.entityType, entityType));
  if (entityId) conditions.push(eq(auditLogTable.entityId, entityId));

  const base = db.select().from(auditLogTable).$dynamic();
  const rows = conditions.length
    ? await base.where(and(...conditions)).orderBy(desc(auditLogTable.createdAt)).limit(limit)
    : await base.orderBy(desc(auditLogTable.createdAt)).limit(limit);

  res.json(rows);
});

export default router;
