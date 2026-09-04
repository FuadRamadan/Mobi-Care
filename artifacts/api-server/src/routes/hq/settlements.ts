import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  commissionSettlementAdjustmentsTable,
  commissionSettlementPaymentsTable,
  commissionSettlementsTable,
  pharmaciesTable,
} from "@workspace/db/schema";
import type { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import {
  BUSINESS_TIMEZONE,
  commissionStatus,
  generateDailyCommissionSettlements,
} from "../../lib/commissionSettlements.js";

const router = safeRouter();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

router.get("/", async (req, res) => {
  const query = z.object({
    start: dateSchema.optional(),
    end: dateSchema.optional(),
    pharmacyId: z.string().uuid().optional(),
    status: z.enum(["unpaid", "partially_paid", "paid"]).optional(),
  }).safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid settlement filters" });
    return;
  }
  const filters = [];
  if (query.data.start) filters.push(gte(commissionSettlementsTable.settlementDate, query.data.start));
  if (query.data.end) filters.push(lte(commissionSettlementsTable.settlementDate, query.data.end));
  if (query.data.pharmacyId) filters.push(eq(commissionSettlementsTable.pharmacyId, query.data.pharmacyId));
  if (query.data.status) filters.push(eq(commissionSettlementsTable.status, query.data.status));
  const [settlements, [range], [allTime], owedRanking, generatedRanking] = await Promise.all([
    db.select({
      id: commissionSettlementsTable.id, pharmacyId: commissionSettlementsTable.pharmacyId,
      pharmacyName: pharmaciesTable.name, settlementDate: commissionSettlementsTable.settlementDate,
      businessTimezone: commissionSettlementsTable.businessTimezone, ordersCount: commissionSettlementsTable.ordersCount,
      grossCollectedMinor: commissionSettlementsTable.grossCollectedMinor, drugAmountTotalMinor: commissionSettlementsTable.drugAmountTotalMinor,
      commissionDueMinor: commissionSettlementsTable.commissionDueMinor, amountPaidMinor: commissionSettlementsTable.amountPaidMinor,
      balanceMinor: commissionSettlementsTable.balanceMinor, status: commissionSettlementsTable.status,
      paidAt: commissionSettlementsTable.paidAt, paymentReference: commissionSettlementsTable.paymentReference,
    }).from(commissionSettlementsTable).leftJoin(pharmaciesTable, eq(pharmaciesTable.id, commissionSettlementsTable.pharmacyId))
      .where(filters.length ? and(...filters) : undefined).orderBy(desc(commissionSettlementsTable.settlementDate), pharmaciesTable.name),
    db.select({
      earned: sql<number>`coalesce(sum(${commissionSettlementsTable.commissionDueMinor}), 0)::int`,
      collected: sql<number>`coalesce(sum(${commissionSettlementsTable.amountPaidMinor}), 0)::int`,
      outstanding: sql<number>`coalesce(sum(${commissionSettlementsTable.balanceMinor}), 0)::int`,
    }).from(commissionSettlementsTable).where(filters.length ? and(...filters) : undefined),
    db.select({ earned: sql<number>`coalesce(sum(${commissionSettlementsTable.commissionDueMinor}), 0)::int` }).from(commissionSettlementsTable),
    db.select({ pharmacyId: commissionSettlementsTable.pharmacyId, pharmacyName: pharmaciesTable.name, amountMinor: sql<number>`coalesce(sum(${commissionSettlementsTable.balanceMinor}),0)::int` })
      .from(commissionSettlementsTable).leftJoin(pharmaciesTable, eq(pharmaciesTable.id, commissionSettlementsTable.pharmacyId))
      .where(filters.length ? and(...filters) : undefined).groupBy(commissionSettlementsTable.pharmacyId, pharmaciesTable.name).orderBy(desc(sql`coalesce(sum(${commissionSettlementsTable.balanceMinor}),0)`)),
    db.select({ pharmacyId: commissionSettlementsTable.pharmacyId, pharmacyName: pharmaciesTable.name, amountMinor: sql<number>`coalesce(sum(${commissionSettlementsTable.commissionDueMinor}),0)::int` })
      .from(commissionSettlementsTable).leftJoin(pharmaciesTable, eq(pharmaciesTable.id, commissionSettlementsTable.pharmacyId))
      .where(filters.length ? and(...filters) : undefined).groupBy(commissionSettlementsTable.pharmacyId, pharmaciesTable.name).orderBy(desc(sql`coalesce(sum(${commissionSettlementsTable.commissionDueMinor}),0)`)),
  ]);
  res.json({ settlements, metrics: { commissionEarnedMinor: range?.earned ?? 0, commissionCollectedMinor: range?.collected ?? 0, commissionOutstandingMinor: range?.outstanding ?? 0, allTimeCommissionEarnedMinor: allTime?.earned ?? 0 }, rankings: { byOwed: owedRanking, byGenerated: generatedRanking } });
});

router.post("/generate", async (req: AuthRequest, res) => {
  const body = z.object({ settlementDate: dateSchema, timezone: z.string().min(1).optional() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "settlementDate is required in YYYY-MM-DD format" }); return; }
  let generated;
  try { generated = await generateDailyCommissionSettlements(body.data.settlementDate, body.data.timezone ?? BUSINESS_TIMEZONE); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Unable to generate settlements" }); return; }
  await writeAudit({ actorType: "hq", actorId: req.pharmacy!.sub, actorName: req.pharmacy!.name, action: "commission_settlement.generate", entityType: "commission_settlement", details: { ...body.data, ...generated } });
  res.status(201).json(generated);
});

router.get("/:id/history", async (req, res) => {
  const id = req.params.id as string;
  const [payments, adjustments] = await Promise.all([
    db.select().from(commissionSettlementPaymentsTable).where(eq(commissionSettlementPaymentsTable.settlementId, id)).orderBy(desc(commissionSettlementPaymentsTable.createdAt)),
    db.select().from(commissionSettlementAdjustmentsTable).where(eq(commissionSettlementAdjustmentsTable.settlementId, id)).orderBy(desc(commissionSettlementAdjustmentsTable.createdAt)),
  ]);
  res.json({ payments, adjustments });
});

router.post("/:id/payments", async (req: AuthRequest, res) => {
  const body = z.object({ amountMinor: z.number().int().positive(), paidAt: z.coerce.date().optional(), paymentReference: z.string().trim().min(1).max(200) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "amountMinor and paymentReference are required" }); return; }
  const id = req.params.id as string;
  const result = await db.transaction(async (tx) => {
    const [settlement] = await tx.select().from(commissionSettlementsTable).where(eq(commissionSettlementsTable.id, id)).for("update").limit(1);
    if (!settlement) return null;
    if (body.data.amountMinor > settlement.balanceMinor) throw new Error("PAYMENT_EXCEEDS_BALANCE");
    const amountPaidMinor = settlement.amountPaidMinor + body.data.amountMinor;
    const balanceMinor = settlement.commissionDueMinor - amountPaidMinor;
    const status = commissionStatus(settlement.commissionDueMinor, amountPaidMinor);
    await tx.insert(commissionSettlementPaymentsTable).values({ settlementId: id, amountMinor: body.data.amountMinor, paidAt: body.data.paidAt ?? new Date(), paymentReference: body.data.paymentReference, recordedByHqStaffId: req.pharmacy!.sub });
    const [updated] = await tx.update(commissionSettlementsTable).set({ amountPaidMinor, balanceMinor, status, paidAt: status === "paid" ? (body.data.paidAt ?? new Date()) : null, paymentReference: body.data.paymentReference, updatedAt: new Date() }).where(eq(commissionSettlementsTable.id, id)).returning();
    return updated!;
  }).catch((error) => { if (error instanceof Error && error.message === "PAYMENT_EXCEEDS_BALANCE") return "EXCEEDS" as const; throw error; });
  if (!result) { res.status(404).json({ error: "Commission settlement not found" }); return; }
  if (result === "EXCEEDS") { res.status(409).json({ error: "Payment exceeds outstanding commission balance" }); return; }
  await writeAudit({ actorType: "hq", actorId: req.pharmacy!.sub, actorName: req.pharmacy!.name, action: "commission_settlement.payment_recorded", entityType: "commission_settlement", entityId: id, details: body.data });
  res.status(201).json(result);
});

export default router;