import { safeRouter } from "../../lib/safeRouter.js";
import { db } from "@workspace/db";
import {
  ordersTable,
  pharmaciesTable,
  couriersTable,
  flagsTable,
  drugCatalogueTable,
  settlementsTable,
} from "@workspace/db/schema";
import { eq, gt, inArray, desc, and, sql } from "drizzle-orm";

const router = safeRouter();

// GET /hq/dashboard — aggregate counts, live order feed, confirmed revenue.
router.get("/", async (_req, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const REVENUE_STATUSES = [
    "confirmed",
    "packaging",
    "ready",
    "assigned",
    "picked_up",
    "delivering",
    "delivered",
    "collected",
  ] as const;

  const [
    [orderCounts],
    [pharmacyCounts],
    [courierCounts],
    [openFlags],
    [heldDrugs],
    [pendingSettlements],
    [revenue],
    [todayOrders],
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
      .select({
        total: sql<number>`coalesce(sum(${ordersTable.totalLeones}), 0)::int`,
      })
      .from(ordersTable)
      .where(inArray(ordersTable.status, [...REVENUE_STATUSES])),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(ordersTable)
      .where(gt(ordersTable.createdAt, startOfToday)),
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
      pendingSettlements: pendingSettlements?.count ?? 0,
      awaitingDispatch: awaitingDispatch[0]?.count ?? 0,
      confirmedRevenueLeones: revenue?.total ?? 0,
    },
    ordersByStatus: statusRows,
    recentOrders,
  });
});

export default router;
