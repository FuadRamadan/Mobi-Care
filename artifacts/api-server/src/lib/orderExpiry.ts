import { db } from "@workspace/db";
import { ordersTable, orderItemsTable, pharmacyInventoryTable } from "@workspace/db/schema";
import { and, eq, lt, sql, inArray } from "drizzle-orm";
import { logger } from "./logger.js";
import { notifyPharmacyOfExpiredOrder } from "./pharmacyNotifications.js";

/**
 * Unpaid orders reserve stock (conditional decrement at creation). To stop
 * abandoned or abusive checkouts from depleting inventory indefinitely, the
 * reservation is bounded: awaiting_payment orders older than this window are
 * cancelled and their stock restored.
 */
export const PAYMENT_WINDOW_MS = 15 * 60 * 1000;

export function paymentCutoff(): Date {
  return new Date(Date.now() - PAYMENT_WINDOW_MS);
}

/**
 * Cancel stale awaiting_payment orders and restock their items.
 * Race-safe: the conditional UPDATE claims each order exactly once, so a
 * concurrent pay (which also guards on status) either wins or loses cleanly;
 * restock happens only for orders this call claimed.
 *
 * Called lazily before order creation / payment, and from a periodic sweep.
 */
export async function expireStaleOrders(): Promise<number> {
  const claimed = await db
    .update(ordersTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(ordersTable.status, "awaiting_payment"),
        lt(ordersTable.createdAt, paymentCutoff())
      )
    )
    .returning({ id: ordersTable.id, pharmacyId: ordersTable.pharmacyId });

  if (claimed.length === 0) return 0;

  const items = await db
    .select({
      orderId: orderItemsTable.orderId,
      drugId: orderItemsTable.drugId,
      quantity: orderItemsTable.quantity,
    })
    .from(orderItemsTable)
    .where(inArray(orderItemsTable.orderId, claimed.map((o) => o.id)));

  const pharmacyByOrder = new Map(claimed.map((o) => [o.id, o.pharmacyId]));
  for (const item of items) {
    await db
      .update(pharmacyInventoryTable)
      .set({
        stockQuantity: sql`${pharmacyInventoryTable.stockQuantity} + ${item.quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pharmacyInventoryTable.pharmacyId, pharmacyByOrder.get(item.orderId)!),
          eq(pharmacyInventoryTable.drugId, item.drugId)
        )
      );
  }

  for (const order of claimed) {
    void notifyPharmacyOfExpiredOrder({
      pharmacyId: order.pharmacyId,
      orderId: order.id,
    });
  }

  logger.info({ count: claimed.length }, "Expired unpaid orders and restocked");
  return claimed.length;
}

/** Periodic safety net so reservations expire even with no traffic. */
export function startOrderExpirySweep(): void {
  setInterval(() => {
    expireStaleOrders().catch((err) =>
      logger.error({ err }, "Order expiry sweep failed")
    );
  }, 60_000).unref();
}
