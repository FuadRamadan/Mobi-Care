import { db } from "@workspace/db";
import { hqNotificationsTable, hqStaffTable, type Order } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Add a separate incoming-order notification for every active HQ staff member.
 * Notification persistence must never undo a successfully created order.
 */
export async function notifyHqOfNewOrder(order: Order, pharmacyName: string): Promise<void> {
  try {
    const recipients = await db
      .select({ id: hqStaffTable.id })
      .from(hqStaffTable)
      .where(eq(hqStaffTable.isActive, true));

    if (recipients.length === 0) return;

    await db.insert(hqNotificationsTable).values(
      recipients.map((staff) => ({
        hqStaffId: staff.id,
        title: "New incoming order",
        body: `${order.patientName} placed a ${order.fulfillmentType} order with ${pharmacyName}.`,
        type: "new_order",
        referenceId: order.id,
      }))
    );
  } catch (error) {
    logger.error(
      { err: error, orderId: order.id },
      "Failed to create HQ incoming-order notifications"
    );
  }
}