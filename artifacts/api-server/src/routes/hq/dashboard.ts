import { safeRouter } from "../../lib/safeRouter.js";
import { db } from "@workspace/db";
import {
  ordersTable,
  pharmaciesTable,
  couriersTable,
  flagsTable,
  drugCatalogueTable,
  prescriptionsTable,
  searchEventsTable,
} from "@workspace/db/schema";
import { eq, gt, inArray, desc, and, sql, isNull } from "drizzle-orm";
import { z } from "zod";

const router = safeRouter();

const trendQuerySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pharmacyId: z.string().uuid().optional(),
});

// Daily series are materialized with every calendar day, including days with
// no activity. `pharmacyId` scopes all three metrics when a patient search was
// submitted while filtered to a single pharmacy.
router.get("/trends", async (req, res) => {
  const parsed = trendQuerySchema.safeParse(req.query);
  if (!parsed.success || parsed.data.start > parsed.data.end) {
    res.status(400).json({ error: "start/end must be YYYY-MM-DD with start on or before end" });
    return;
  }
  const { start, end, pharmacyId } = parsed.data;
  const startAt = new Date(`${start}T00:00:00.000Z`);
  const endExclusive = new Date(`${end}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const searchPharmacy = pharmacyId
    ? sql`and pharmacy_id = ${pharmacyId}`
    : sql``;
  const orderPharmacy = pharmacyId
    ? sql`and pharmacy_id = ${pharmacyId}`
    : sql``;
  const [searchRows, orderRows] = await Promise.all([
    db.execute(sql`select created_at::date::text as date, count(*)::int as searches
      from search_events where created_at >= ${startAt}
      and created_at < ${endExclusive} ${searchPharmacy}
      group by 1 order by 1`),
    db.execute(sql`select completed_at::date::text as date, count(*)::int as orders,
      coalesce(sum(medicine_commission_minor), 0)::int as commission_minor
      from orders where status in ('delivered', 'collected') and completed_at >= ${startAt}
      and completed_at < ${endExclusive} ${orderPharmacy}
      group by 1 order by 1`),
  ]);
  const searches = new Map((searchRows.rows as Array<{ date: string; searches: number }>).map((row) => [row.date, Number(row.searches)]));
  const orders = new Map((orderRows.rows as Array<{ date: string; orders: number; commission_minor: number }>).map((row) => [row.date, row]));
  const days = [];
  for (let day = new Date(`${start}T00:00:00.000Z`); day <= new Date(`${end}T00:00:00.000Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    const order = orders.get(date);
    days.push({ date, searches: searches.get(date) ?? 0, orders: Number(order?.orders ?? 0), commissionMinor: Number(order?.commission_minor ?? 0) });
  }
  res.json({ start, end, pharmacyId: pharmacyId ?? null, days });
});

// GET /hq/dashboard — aggregate counts, live order feed, completed revenue.
router.get("/", async (_req, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const REVENUE_STATUSES = ["delivered", "collected"] as const;

  const [
    [orderCounts],
    [pharmacyCounts],
    [courierCounts],
    [openFlags],
    [heldDrugs],
    [revenue],
    [todayOrders],
    [pendingPrescriptions],
    [unconfirmedDeliveries],
    [searchesToday],
    recentOrders,
  ] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(ordersTable),
    db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${pharmaciesTable.isActive})::int`,
      })
      .from(pharmaciesTable),
    db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${couriersTable.isActive})::int`,
      })
      .from(couriersTable),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(flagsTable)
      .where(eq(flagsTable.status, "open")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(drugCatalogueTable)
      .where(eq(drugCatalogueTable.isApproved, false)),
    db
      .select({
        total: sql<number>`coalesce(sum(${ordersTable.medicineCommissionMinor}), 0)::int`,
      })
      .from(ordersTable)
       .where(and(inArray(ordersTable.status, [...REVENUE_STATUSES]), sql`${ordersTable.completedAt} is not null`)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(ordersTable)
      .where(gt(ordersTable.createdAt, startOfToday)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(prescriptionsTable)
      .where(eq(prescriptionsTable.status, "pending")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(ordersTable)
      .where(and(eq(ordersTable.status, "delivering"), isNull(ordersTable.deliveryConfirmedAt))),
    db.select({ count: sql<number>`count(*)::int` }).from(searchEventsTable).where(gt(searchEventsTable.createdAt, startOfToday)),
    db
      .select({
        id: ordersTable.id,
        status: ordersTable.status,
        fulfillmentType: ordersTable.fulfillmentType,
        totalLeones: ordersTable.totalLeones,
        patientName: ordersTable.patientName,
        pharmacyName: pharmaciesTable.name,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .leftJoin(pharmaciesTable, eq(ordersTable.pharmacyId, pharmaciesTable.id))
      .orderBy(desc(ordersTable.createdAt))
      .limit(12),
  ]);

  // Orders by status (for the command-centre widgets)
  const statusRows = await db
    .select({ status: ordersTable.status, count: sql<number>`count(*)::int` })
    .from(ordersTable)
    .groupBy(ordersTable.status);

  const awaitingDispatch = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.status, "ready"),
        eq(ordersTable.fulfillmentType, "delivery"),
      ),
    );

  res.json({
    totals: {
      orders: orderCounts?.total ?? 0,
      ordersToday: todayOrders?.count ?? 0,
      pharmacies: pharmacyCounts?.total ?? 0,
      activePharmacies: pharmacyCounts?.active ?? 0,
      couriers: courierCounts?.total ?? 0,
      activeCouriers: courierCounts?.active ?? 0,
      openFlags: openFlags?.count ?? 0,
      heldDrugs: heldDrugs?.count ?? 0,
      searchesToday: searchesToday?.count ?? 0,
      awaitingDispatch: awaitingDispatch[0]?.count ?? 0,
      pendingPrescriptions: pendingPrescriptions?.count ?? 0,
      unconfirmedDeliveries: unconfirmedDeliveries?.count ?? 0,
      // Platform revenue is only the stored 5% service fee, in minor units.
      completedCommissionMinor: revenue?.total ?? 0,
      // Compatibility field for existing clients; it now correctly represents
      // platform commission rather than gross patient spend.
      completedRevenueLeones: (revenue?.total ?? 0) / 100,
    },
    ordersByStatus: statusRows,
    recentOrders,
  });
});

export default router;
