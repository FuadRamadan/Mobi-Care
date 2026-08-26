import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import { flagsTable, ordersTable, pharmaciesTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";

const router = safeRouter();

// ── GET /hq/flags?status=open|reviewed ───────────────────────────────────────
router.get("/", async (req, res) => {
  const status = req.query.status as string | undefined;

  const base = db
    .select({
      id: flagsTable.id,
      orderId: flagsTable.orderId,
      type: flagsTable.type,
      reason: flagsTable.reason,
      details: flagsTable.details,
      status: flagsTable.status,
      reviewNote: flagsTable.reviewNote,
      reviewedAt: flagsTable.reviewedAt,
      createdAt: flagsTable.createdAt,
      orderStatus: ordersTable.status,
      orderTotalLeones: ordersTable.totalLeones,
      patientName: ordersTable.patientName,
      patientPhone: ordersTable.patientPhone,
      pharmacyName: pharmaciesTable.name,
    })
    .from(flagsTable)
    .leftJoin(ordersTable, eq(flagsTable.orderId, ordersTable.id))
    .leftJoin(pharmaciesTable, eq(ordersTable.pharmacyId, pharmaciesTable.id))
    .$dynamic();

  const rows =
    status === "open" || status === "reviewed"
      ? await base
          .where(eq(flagsTable.status, status))
          .orderBy(desc(flagsTable.createdAt))
      : await base.orderBy(desc(flagsTable.createdAt));

  res.json(rows);
});

// ── Mark a flag reviewed with a note ─────────────────────────────────────────
// Exposed both as POST /hq/flags/:id/review and PATCH /hq/flags/:id (contract alias).
const reviewFlagHandler = async (
  req: AuthRequest,
  res: Parameters<Parameters<typeof router.post>[1]>[1],
) => {
  const id = req.params.id as string;
  const body = z.object({ note: z.string().min(1) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "note is required" });
    return;
  }

  const [flag] = await db
    .select()
    .from(flagsTable)
    .where(eq(flagsTable.id, id))
    .limit(1);
  if (!flag) {
    res.status(404).json({ error: "Flag not found" });
    return;
  }
  if (flag.status === "reviewed") {
    res.status(409).json({ error: "Flag already reviewed" });
    return;
  }

  // Conditional update — a concurrent reviewer loses cleanly with a 409.
  const [updated] = await db
    .update(flagsTable)
    .set({
      status: "reviewed",
      reviewNote: body.data.note,
      reviewedByHqStaffId: req.pharmacy!.sub,
      reviewedAt: new Date(),
    })
    .where(and(eq(flagsTable.id, id), eq(flagsTable.status, "open")))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "Flag was reviewed concurrently" });
    return;
  }

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "flag.review",
    entityType: "flag",
    entityId: id,
    details: { orderId: flag.orderId, type: flag.type, note: body.data.note },
  });

  res.json(updated);
};
router.post("/:id/review", reviewFlagHandler);
router.patch("/:id", reviewFlagHandler);

export default router;
