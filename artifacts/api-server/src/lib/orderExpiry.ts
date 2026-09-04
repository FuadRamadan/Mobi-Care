import { db } from "@workspace/db";
import { ordersTable } from "@workspace/db/schema";
import { and, eq, lt } from "drizzle-orm";
import { logger } from "./logger.js";
import { notifyPharmacyOfExpiredOrder } from "./pharmacyNotifications.js";

/**
 * Unpaid checkouts remain payable for a bounded window. Inventory is not
 * reserved until payment confirmation.
 */
export const PAYMENT_WINDOW_MS = 15 * 60 * 1000;

export function paymentCutoff(): Date {
  return new Date(Date.now() - PAYMENT_WINDOW_MS);
}

/**
 * Cancel stale awaiting_payment orders.
 * Race-safe: the conditional UPDATE claims each order exactly once, so a
 * concurrent pay (which also guards on status) either wins or loses cleanly;
 * only the call that wins the conditional update sends the notification.
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
        lt(ordersTable.createdAt, paymentCutoff()),
      ),
    )
    .returning({ id: ordersTable.id, pharmacyId: ordersTable.pharmacyId });

  if (claimed.length === 0) return 0;

  for (const order of claimed) {
    void notifyPharmacyOfExpiredOrder({
      pharmacyId: order.pharmacyId,
      orderId: order.id,
    });
  }

  logger.info({ count: claimed.length }, "Expired unpaid orders");
  return claimed.length;
}

/** Periodic safety net so unpaid checkouts expire even with no traffic. */
let sweepTimer: NodeJS.Timeout | undefined;

export function startOrderExpirySweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    expireStaleOrders().catch((err) =>
      logger.error({ err }, "Order expiry sweep failed"),
    );
  }, 60_000).unref();
}

export function stopOrderExpirySweep(): void {
  if (!sweepTimer) return;
  clearInterval(sweepTimer);
  sweepTimer = undefined;
}
