import { db } from "@workspace/db";
import { flagsTable, ordersTable, type Order } from "@workspace/db/schema";
import { and, eq, gt, ne, sql } from "drizzle-orm";

/**
 * Anomaly checks that populate the HQ flags queue.
 * Called from order-mutating handlers (order creation and payment transitions)
 * so the queue is genuinely fed, not an empty shell.
 *
 * Checks:
 *  - velocity:        >3 orders from the same patient phone in the last hour
 *  - duplicate:       another order with same phone + pharmacy + total in the last 10 min
 *  - payment_anomaly: unusually large order total (> Le 5,000,000)
 *
 * Never throws — flag detection must not break order processing.
 */
export async function checkOrderFlags(order: Order): Promise<void> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);

    // ── Velocity ──────────────────────────────────────────────────────────────
    const [velocity] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.patientPhone, order.patientPhone),
          gt(ordersTable.createdAt, oneHourAgo),
        ),
      );

    if (velocity && velocity.count > 3) {
      await insertFlagOnce(
        order.id,
        "velocity",
        `${velocity.count} orders from ${order.patientPhone} in the last hour`,
        { count: velocity.count, windowMinutes: 60 },
      );
    }

    // ── Duplicate ─────────────────────────────────────────────────────────────
    const [dup] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.patientPhone, order.patientPhone),
          eq(ordersTable.pharmacyId, order.pharmacyId),
          eq(ordersTable.totalLeones, order.totalLeones),
          ne(ordersTable.id, order.id),
          gt(ordersTable.createdAt, tenMinAgo),
        ),
      );

    if (dup && dup.count > 0) {
      await insertFlagOnce(
        order.id,
        "duplicate",
        `Near-identical order (same phone, pharmacy, and total of Le ${order.totalLeones.toLocaleString()}) within 10 minutes`,
        { matches: dup.count, totalLeones: order.totalLeones },
      );
    }

    // ── Payment anomaly ───────────────────────────────────────────────────────
    const LARGE_ORDER_LEONES = 5_000_000;
    if (Number(order.totalLeones) > LARGE_ORDER_LEONES) {
      await insertFlagOnce(
        order.id,
        "payment_anomaly",
        `Order total Le ${order.totalLeones.toLocaleString()} exceeds review threshold`,
        { totalLeones: order.totalLeones, threshold: LARGE_ORDER_LEONES },
      );
    }
  } catch (err) {
    console.error("[flags] anomaly check failed for order", order.id, err);
  }
}

/** Insert a flag unless one of the same type already exists for the order. */
async function insertFlagOnce(
  orderId: string,
  type: "velocity" | "duplicate" | "payment_anomaly",
  reason: string,
  details: Record<string, unknown>,
): Promise<void> {
  const existing = await db
    .select({ id: flagsTable.id })
    .from(flagsTable)
    .where(and(eq(flagsTable.orderId, orderId), eq(flagsTable.type, type)))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(flagsTable).values({ orderId, type, reason, details });
  }
}
