import { db } from "@workspace/db";
import { orderItemsTable, pharmacyInventoryTable } from "@workspace/db/schema";
import { and, eq, gt, gte, sql } from "drizzle-orm";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Thrown inside a payment transaction so the whole claim rolls back. */
export class PaymentClaimError extends Error {
  constructor(readonly code: "OUT_OF_STOCK" | "INCOMPLETE_ORDER_ITEMS") {
    super(code);
    this.name = "PaymentClaimError";
  }
}

/**
 * Takes a paid order's medicines out of stock, inside the caller's
 * transaction. Unpaid orders reserve nothing, so this runs at the moment a
 * payment is accepted. Every line must still be active, complete, in date and
 * in stock, or the whole payment claim rolls back.
 */
export async function deductOrderStock(
  tx: Tx,
  order: { id: string; pharmacyId: string },
): Promise<void> {
  const items = await tx
    .select({
      inventoryId: orderItemsTable.inventoryId,
      quantity: orderItemsTable.quantity,
    })
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, order.id));
  if (items.length === 0 || items.some((item) => !item.inventoryId)) {
    throw new PaymentClaimError("INCOMPLETE_ORDER_ITEMS");
  }

  for (const item of items) {
    const deducted = await tx
      .update(pharmacyInventoryTable)
      .set({
        stockQuantity: sql`${pharmacyInventoryTable.stockQuantity} - ${item.quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pharmacyInventoryTable.id, item.inventoryId!),
          eq(pharmacyInventoryTable.pharmacyId, order.pharmacyId),
          eq(pharmacyInventoryTable.isActive, true),
          eq(pharmacyInventoryTable.completionStatus, "complete"),
          gt(pharmacyInventoryTable.expiryDate, new Date().toISOString().slice(0, 10)),
          gte(pharmacyInventoryTable.stockQuantity, item.quantity),
        ),
      )
      .returning({ id: pharmacyInventoryTable.id });
    if (deducted.length === 0) throw new PaymentClaimError("OUT_OF_STOCK");
  }
}
