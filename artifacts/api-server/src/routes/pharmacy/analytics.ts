import { safeRouter } from "../../lib/safeRouter.js";
import { AuthRequest } from "../../middlewares/auth.js";
import { db } from "@workspace/db";
import {
  ordersTable as orders,
  pharmacyInventoryTable as pharmacyInventory,
  prescriptionsTable as prescriptions,
} from "@workspace/db";
import { eq, and, gte, sql, count, sum, inArray } from "drizzle-orm";

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

export default router;
