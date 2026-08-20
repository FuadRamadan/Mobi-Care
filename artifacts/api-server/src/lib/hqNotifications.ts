import { db } from "@workspace/db";
import { hqNotificationsTable, hqStaffTable, type Order } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

type HqNotificationPayload = {
  title: string;
  body: string;
  type: "new_order" | "order_ready";
  referenceId: string;
};

async function notifyActiveHqStaff(
  payload: HqNotificationPayload,
  orderId: string,
): Promise<void> {
  try {
    const recipients = await db
      .select({ id: hqStaffTable.id })
      .from(hqStaffTable)
      .where(eq(hqStaffTable.isActive, true));

    if (recipients.length === 0) return;

    await db.insert(hqNotificationsTable).values(
      recipients.map((staff) => ({
        hqStaffId: staff.id,
        title: payload.title,
        body: payload.body,
        type: payload.type,
        referenceId: payload.referenceId,
      })),
    );
  } catch (error) {
    logger.error(
      { err: error, orderId, notificationType: payload.type },
      "Failed to create HQ order notification",
    );
  }
}

/**
 * Add a separate incoming-order notification for every active HQ staff member.
 * Notification persistence must never undo a successfully created order.
 */
export async function notifyHqOfNewOrder(order: Order, pharmacyName: string): Promise<void> {
  await notifyActiveHqStaff(
    {
      title: "New incoming order",
      body: `${order.patientName} placed a ${order.fulfillmentType} order with ${pharmacyName}.`,
      type: "new_order",
      referenceId: order.id,
    },
    order.id,
  );
}

/**
 * Alert every active HQ staff member when a pharmacy finishes preparing an order.
 * This is fire-and-forget safe: an alert write cannot undo the ready transition.
 */
export async function notifyHqOfOrderReady(
  order: Order,
  pharmacyName: string,
): Promise<void> {
  await notifyActiveHqStaff(
    {
      title: "Order ready",
      body: `${order.patientName}'s ${order.fulfillmentType} order at ${pharmacyName} is ready.`,
      type: "order_ready",
      referenceId: order.id,
    },
    order.id,
  );
}