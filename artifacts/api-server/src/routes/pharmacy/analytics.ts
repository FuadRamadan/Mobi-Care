import { safeRouter } from "../../lib/safeRouter.js";
import { AuthRequest } from "../../middlewares/auth.js";
import { db } from "@workspace/db";
import {
  ordersTable as orders,
  pharmacyInventoryTable as pharmacyInventory,
  prescriptionsTable as prescriptions,
  commissionSettlementsTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, count, inArray } from "drizzle-orm";
import { BUSINESS_TIMEZONE, businessDateNow } from "../../lib/commissionSettlements.js";
import { pharmacyOnlineFigures, validRange } from "../../lib/onlinePaymentFigures.js";
import { monimeEnabled } from "../../lib/monime/config.js";

const router = safeRouter();

// GET /analytics/overview
router.get("/overview", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [ordersResult, inventoryResult, [dailyRevenue], prescriptionsResult] =
    await Promise.all([
      db
        .select({
          status: orders.status,
          cnt: count(),
          rev: sql<number>`coalesce(sum(${orders.pharmacyMedicineTotalMinor}), 0)::int`,
        })
        .from(orders)
        .where(eq(orders.pharmacyId, pharmacyId))
        .groupBy(orders.status),

      db
        .select({ cnt: count() })
        .from(pharmacyInventory)
        .where(
          and(
            eq(pharmacyInventory.pharmacyId, pharmacyId),
            eq(pharmacyInventory.isActive, true),
            sql`${pharmacyInventory.stockQuantity} <= 5`,
          ),
        ),
      db
        .select({
          value: sql<number>`coalesce(sum(${orders.pharmacyMedicineTotalMinor}), 0)::int`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.pharmacyId, pharmacyId),
            inArray(orders.status, ["delivered", "collected"]),
            gte(orders.completedAt, startOfToday),
          ),
        ),

      db
        .select({ cnt: count() })
        .from(prescriptions)
        .where(
          and(
            eq(prescriptions.pharmacyId, pharmacyId),
            eq(prescriptions.status, "pending"),
          ),
        ),
    ]);

  const PENDING_STATUSES = new Set(["paid", "confirmed", "packaging"]);
  const COMPLETED_STATUSES = new Set(["delivered", "collected"]);

  let totalOrders = 0;
  let pendingOrders = 0;
  let revenueLeones = 0;
  const ordersByStatus: Record<string, number> = {};

  for (const row of ordersResult) {
    const n = Number(row.cnt);
    totalOrders += n;
    ordersByStatus[row.status] = n;
    if (PENDING_STATUSES.has(row.status)) pendingOrders += n;
    if (COMPLETED_STATUSES.has(row.status))
      revenueLeones += Number(row.rev ?? 0) / 100;
  }

  res.json({
    totalOrders,
    pendingOrders,
    revenueLeones,
    dailyRevenueLeones: (dailyRevenue?.value ?? 0) / 100,
    pendingPrescriptions: Number(prescriptionsResult[0]?.cnt ?? 0),
    lowStockItems: Number(inventoryResult[0]?.cnt ?? 0),
    ordersByStatus,
  });
});

// GET /analytics/orders-by-day
router.get("/orders-by-day", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      date: sql<string>`date_trunc('day', ${orders.createdAt})::date::text`,
      orders: count(),
      revenueLeones: sql<number>`coalesce(sum(${orders.pharmacyMedicineTotalMinor}), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.pharmacyId, pharmacyId),
        inArray(orders.status, ["delivered", "collected"]),
        gte(orders.completedAt, since),
      ),
    )
    .groupBy(sql`date_trunc('day', ${orders.createdAt})`)
    .orderBy(sql`date_trunc('day', ${orders.createdAt})`);

  res.json(
    rows.map((r) => ({
      date: r.date,
      orders: Number(r.orders),
      revenueLeones: Number(r.revenueLeones ?? 0) / 100,
    })),
  );
});

// For orders paid directly to the pharmacy: what it collected, its 5%
// commission, and (pilot pricing) the delivery fees it collected for MobiCare.
// Gross is money the pharmacy collected and is never reported as platform revenue.
router.get("/commission", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const start = typeof req.query.start === "string" ? req.query.start : businessDateNow();
  const end = typeof req.query.end === "string" ? req.query.end : start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    res.status(400).json({ error: "start and end must be YYYY-MM-DD with start before end" });
    return;
  }
  const [today, [outstanding], rows] = await Promise.all([
    db.select({
      ordersCount: sql<number>`count(*)::int`,
      grossCollectedMinor: sql<number>`coalesce(sum(${orders.patientMedicineTotalMinor} + ${orders.deliveryFeeMinor}),0)::int`,
      drugAmountTotalMinor: sql<number>`coalesce(sum(${orders.pharmacyMedicineTotalMinor}),0)::int`,
      commissionDueMinor: sql<number>`coalesce(sum(${orders.medicineCommissionMinor}),0)::int`,
      deliveryFeesDueMinor: sql<number>`coalesce(sum(${orders.deliveryFeeMinor}) FILTER (WHERE ${orders.pricingModel} = 'split_v1'),0)::int`,
      pharmacyEarningsMinor: sql<number>`coalesce(sum(${orders.pharmacyMedicineTotalMinor} - ${orders.pharmacyCommissionMinor}),0)::int`,
    }).from(orders).where(and(eq(orders.pharmacyId, pharmacyId), eq(orders.paymentProvider, "direct"), inArray(orders.status, ["delivered", "collected"]), sql`to_char(${orders.completedAt} AT TIME ZONE ${BUSINESS_TIMEZONE}, 'YYYY-MM-DD') = ${businessDateNow()}`)),
    db.select({ amount: sql<number>`coalesce(sum(${commissionSettlementsTable.balanceMinor}),0)::int` }).from(commissionSettlementsTable).where(and(eq(commissionSettlementsTable.pharmacyId, pharmacyId), inArray(commissionSettlementsTable.status, ["unpaid", "partially_paid"]))),
    db.select().from(commissionSettlementsTable).where(and(eq(commissionSettlementsTable.pharmacyId, pharmacyId), gte(commissionSettlementsTable.settlementDate, start), lte(commissionSettlementsTable.settlementDate, end))).orderBy(commissionSettlementsTable.settlementDate),
  ]);
  const byDate = new Map(rows.map((row) => [row.settlementDate, row]));
  const daily = [];
  for (let day = new Date(`${start}T00:00:00.000Z`); day <= new Date(`${end}T00:00:00.000Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    const row = byDate.get(date);
    daily.push(row ?? { settlementDate: date, businessTimezone: BUSINESS_TIMEZONE, ordersCount: 0, grossCollectedMinor: 0, drugAmountTotalMinor: 0, commissionDueMinor: 0, deliveryFeesDueMinor: 0, amountPaidMinor: 0, balanceMinor: 0, status: "paid" });
  }
  res.json({ today: today[0] ?? { ordersCount: 0, grossCollectedMinor: 0, drugAmountTotalMinor: 0, commissionDueMinor: 0, deliveryFeesDueMinor: 0, pharmacyEarningsMinor: 0 }, outstandingCommissionMinor: outstanding?.amount ?? 0, daily });
});

// ── GET /analytics/online: orders paid online through MobiCare (Monime) ─────
// The pharmacy's own prices, MobiCare's 5% commission and what it receives,
// by the day the payment was confirmed, minus refunds. Never the patient's
// service fee.
router.get("/online", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const today = businessDateNow();
  const range = validRange(req.query.start ?? today, req.query.end ?? today);
  if (!range) {
    res.status(400).json({ error: "start and end must be YYYY-MM-DD, start first, at most 92 days apart" });
    return;
  }
  const figures = await pharmacyOnlineFigures(pharmacyId, range.start, range.end);
  const todayRow =
    figures.daily.find((day) => day.date === today) ??
    (await pharmacyOnlineFigures(pharmacyId, today, today)).daily[0]!;
  res.json({
    enabled: monimeEnabled() || figures.hasOnlineOrders,
    today: todayRow,
    daily: figures.daily,
    waitingMinor: figures.waitingMinor,
    completedMinor: figures.completedMinor,
  });
});

router.get("/commission.csv", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const rows = await db.select({
    settlementDate: commissionSettlementsTable.settlementDate,
    ordersCount: commissionSettlementsTable.ordersCount,
    grossCollectedMinor: commissionSettlementsTable.grossCollectedMinor,
    drugAmountTotalMinor: commissionSettlementsTable.drugAmountTotalMinor,
    commissionDueMinor: commissionSettlementsTable.commissionDueMinor,
    deliveryFeesDueMinor: commissionSettlementsTable.deliveryFeesDueMinor,
    amountPaidMinor: commissionSettlementsTable.amountPaidMinor,
    balanceMinor: commissionSettlementsTable.balanceMinor,
    status: commissionSettlementsTable.status,
  }).from(commissionSettlementsTable).where(eq(commissionSettlementsTable.pharmacyId, pharmacyId)).orderBy(commissionSettlementsTable.settlementDate);
  const headings = "settlement_date,orders_count,gross_collected_minor,drug_amount_total_minor,commission_due_minor,delivery_fees_due_minor,amount_paid_minor,balance_minor,status";
  const csv = [headings, ...rows.map((row) => [row.settlementDate, row.ordersCount, row.grossCollectedMinor, row.drugAmountTotalMinor, row.commissionDueMinor, row.deliveryFeesDueMinor, row.amountPaidMinor, row.balanceMinor, row.status].join(","))].join("\r\n");
  res.type("text/csv").attachment("mobicare-commission-history.csv").send(`${csv}\r\n`);
});

export default router;
