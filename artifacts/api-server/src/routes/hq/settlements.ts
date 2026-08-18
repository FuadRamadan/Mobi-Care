import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  settlementsTable,
  courierSettlementsTable,
  pharmaciesTable,
  couriersTable,
  ordersTable,
} from "@workspace/db/schema";
import { eq, desc, and, gte, lt, inArray, sql, isNull } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";

const router = Router();

const COMPLETED_STATUSES = ["delivered", "collected"] as const;

// ── GET /hq/settlements — pharmacy + courier settlements ─────────────────────
router.get("/", async (_req, res) => {
  const [pharmacyRows, courierRows] = await Promise.all([
    db.select({
      id: settlementsTable.id,
      pharmacyId: settlementsTable.pharmacyId,
      pharmacyName: pharmaciesTable.name,
      amountLeones: settlementsTable.amountLeones,
      periodStart: settlementsTable.periodStart,
      periodEnd: settlementsTable.periodEnd,
      orderCount: settlementsTable.orderCount,
      status: settlementsTable.status,
      paidAt: settlementsTable.paidAt,
      reference: settlementsTable.reference,
      createdAt: settlementsTable.createdAt,
    })
      .from(settlementsTable)
      .leftJoin(pharmaciesTable, eq(settlementsTable.pharmacyId, pharmaciesTable.id))
      .orderBy(desc(settlementsTable.createdAt)),
    db.select({
      id: courierSettlementsTable.id,
      courierId: courierSettlementsTable.courierId,
      courierName: couriersTable.name,
      amountLeones: courierSettlementsTable.amountLeones,
      periodStart: courierSettlementsTable.periodStart,
      periodEnd: courierSettlementsTable.periodEnd,
      deliveryCount: courierSettlementsTable.deliveryCount,
      status: courierSettlementsTable.status,
      paidAt: courierSettlementsTable.paidAt,
      reference: courierSettlementsTable.reference,
      createdAt: courierSettlementsTable.createdAt,
    })
      .from(courierSettlementsTable)
      .leftJoin(couriersTable, eq(courierSettlementsTable.courierId, couriersTable.id))
      .orderBy(desc(courierSettlementsTable.createdAt)),
  ]);

  res.json({ pharmacy: pharmacyRows, courier: courierRows });
});

// ── POST /hq/settlements/generate — build settlements for a period ───────────
// Aggregates completed orders in [periodStart, periodEnd) into pending
// settlements: one per pharmacy (order totals) and one per courier
// (flat delivery fee per completed delivery).
const COURIER_FEE_LEONES = 25_000;

router.post("/generate", async (req: AuthRequest, res) => {
  const body = z.object({
    periodStart: z.string().min(1),
    periodEnd: z.string().min(1),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "periodStart and periodEnd are required (ISO dates)" }); return; }

  const periodStart = new Date(body.data.periodStart);
  const periodEnd = new Date(body.data.periodEnd);
  if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime()) || periodStart >= periodEnd) {
    res.status(400).json({ error: "Invalid period: periodStart must be before periodEnd" });
    return;
  }

  const completed = and(
    inArray(ordersTable.status, [...COMPLETED_STATUSES]),
    gte(ordersTable.updatedAt, periodStart),
    lt(ordersTable.updatedAt, periodEnd)
  );

  const [byPharmacy, byCourier] = await Promise.all([
    db.select({
      pharmacyId: ordersTable.pharmacyId,
      total: sql<number>`sum(${ordersTable.totalLeones})::int`,
      count: sql<number>`count(*)::int`,
    }).from(ordersTable).where(completed).groupBy(ordersTable.pharmacyId),
    db.select({
      courierId: ordersTable.courierId,
      count: sql<number>`count(*)::int`,
    }).from(ordersTable)
      .where(and(completed, eq(ordersTable.status, "delivered")))
      .groupBy(ordersTable.courierId),
  ]);

  // Idempotent: a unique index on (entity, periodStart, periodEnd) makes
  // repeat/concurrent generation for the same period a no-op.
  const created: { pharmacy: number; courier: number } = { pharmacy: 0, courier: 0 };

  for (const row of byPharmacy) {
    const inserted = await db.insert(settlementsTable).values({
      pharmacyId: row.pharmacyId,
      amountLeones: row.total,
      periodStart,
      periodEnd,
      orderCount: row.count,
    }).onConflictDoNothing().returning({ id: settlementsTable.id });
    if (inserted.length > 0) created.pharmacy++;
  }
  for (const row of byCourier) {
    if (!row.courierId) continue;
    const inserted = await db.insert(courierSettlementsTable).values({
      courierId: row.courierId,
      amountLeones: row.count * COURIER_FEE_LEONES,
      periodStart,
      periodEnd,
      deliveryCount: row.count,
    }).onConflictDoNothing().returning({ id: courierSettlementsTable.id });
    if (inserted.length > 0) created.courier++;
  }

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "settlement.generate",
    entityType: "settlement",
    details: {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      created,
    },
  });

  res.status(201).json({ message: `Generated ${created.pharmacy} pharmacy and ${created.courier} courier settlements`, created });
});

// ── Mark a settlement paid ───────────────────────────────────────────────────
// Exposed both as POST /hq/settlements/:id/mark-paid and PATCH /hq/settlements/:id
// (contract alias).
const markPaidHandler = async (req: AuthRequest, res: Parameters<Parameters<typeof router.post>[1]>[1]) => {
  const id = req.params.id as string;
  const body = z.object({
    kind: z.enum(["pharmacy", "courier"]),
    reference: z.string().optional(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "kind ('pharmacy' | 'courier') is required" }); return; }

  const table = body.data.kind === "pharmacy" ? settlementsTable : courierSettlementsTable;

  const [existing] = await db.select().from(table).where(eq(table.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Settlement not found" }); return; }
  if (existing.status === "paid") { res.status(409).json({ error: "Settlement already paid" }); return; }

  const [updated] = await db
    .update(table)
    .set({
      status: "paid",
      paidAt: new Date(),
      reference: body.data.reference ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(table.id, id), isNull(table.paidAt)))
    .returning();
  // A concurrent caller may have won the conditional update — no 200, no audit.
  if (!updated) {
    res.status(409).json({ error: "Settlement was marked paid concurrently" });
    return;
  }

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "settlement.mark_paid",
    entityType: "settlement",
    entityId: id,
    details: { kind: body.data.kind, amountLeones: existing.amountLeones, reference: body.data.reference ?? null },
  });

  res.json(updated);
};
router.post("/:id/mark-paid", markPaidHandler);
router.patch("/:id", markPaidHandler);

export default router;
