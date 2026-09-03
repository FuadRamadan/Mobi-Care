import { safeRouter } from "../../lib/safeRouter.js";
import { db } from "@workspace/db";
import {
  ordersTable,
  pharmaciesTable,
  couriersTable,
  flagsTable,
  drugCatalogueTable,
  settlementsTable,
  prescriptionsTable,
} from "@workspace/db/schema";
import { eq, gt, desc, and, sql, isNull } from "drizzle-orm";
import { z } from "zod";

const router = safeRouter();

const trendQuery = z.object({
  start: z.string().date().optional(),
  end: z.string().date().optional(),
  pharmacyId: z.string().uuid().optional(),
});

// GET /hq/dashboard/trends — daily operational trends. Search telemetry is
// intentionally anonymous and is therefore only available platform-wide.
router.get("/trends", async (req, res) => {
  const parsed = trendQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "start/end must be YYYY-MM-DD and pharmacyId must be a UUID" });
    return;
  }
  const end = parsed.data.end ? new Date(`${parsed.data.end}T00:00:00.000Z`) : new Date();
  if (parsed.data.end) end.setUTCDate(end.getUTCDate() + 1);
  const start = parsed.data.start
    ? new Date(`${parsed.data.start}T00:00:00.000Z`)
    : new Date(end.getTime() - 29 * 86400_000);
  if (start >= end) {
    res.status(400).json({ error: "start must be before end" });
    return;
  }
  const pharmacyClause = parsed.data.pharmacyId
    ? sql`AND pharmacy_id = ${parsed.data.pharmacyId}`
    : sql``;
  const [searches, orders, pharmacies] = await Promise.all([
    db.execute(sql`SELECT date_trunc('day', created_at)::date::text AS date, count(*)::int AS count FROM search_events WHERE created_at >= ${start} AND created_at < ${end} GROUP BY 1 ORDER BY 1`),
    db.execute(sql`SELECT date_trunc('day', created_at)::date::text AS date, count(*)::int AS count FROM orders WHERE created_at >= ${start} AND created_at < ${end} ${pharmacyClause} GROUP BY 1 ORDER BY 1`),
    db.select({ id: pharmaciesTable.id, name: pharmaciesTable.name }).from(pharmaciesTable).orderBy(pharmaciesTable.name),
  ]);
  res.json({
    searches: searches.rows,
    orders: orders.rows,
    pharmacies,
    searchScope: "all",
  });
});

// GET /hq/dashboard — aggregate counts and live order feed.
router.get("/", async (_req, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    [orderCounts],
    [pharmacyCounts],
    [courierCounts],
    [openFlags],
    [heldDrugs],
    [pendingSettlements],
    [todayOrders],
    [pendingPrescriptions],
    [unconfirmedDeliveries],
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
      .select({ count: sql<number>`count(*)::int` })
      .from(settlementsTable)
      .where(eq(settlementsTable.status, "pending")),
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
      .orderBy(desc(ordersTable.createdAt)),
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
      pendingSettlements: pendingSettlements?.count ?? 0,
      awaitingDispatch: awaitingDispatch[0]?.count ?? 0,
      pendingPrescriptions: pendingPrescriptions?.count ?? 0,
      unconfirmedDeliveries: unconfirmedDeliveries?.count ?? 0,
    },
    ordersByStatus: statusRows,
    recentOrders,
  });
});

export default router;
