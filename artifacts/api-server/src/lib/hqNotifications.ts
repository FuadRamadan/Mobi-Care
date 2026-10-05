import { db } from "@workspace/db";
import { hqNotificationsTable, hqStaffTable, type Order } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

type HqNotificationPayload = {
  title: string;
  body: string;
  type: "new_order" | "order_ready" | "delivery_ready" | "payment_issue" | "payout_issue";
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

/** Google Maps link to the pin the patient dropped, when the order has one. */
export function deliveryMapLink(order: Pick<Order, "deliveryLatitude" | "deliveryLongitude">): string | null {
  if (order.deliveryLatitude == null || order.deliveryLongitude == null) return null;
  const lat = Number(order.deliveryLatitude);
  const lng = Number(order.deliveryLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * The "order ready" alert text. A delivery order carries everything HQ needs
 * to brief the courier — the patient's phone, the directions they gave, the
 * zone and a map link to their pin — so nobody has to look the order up.
 */
export function orderReadyMessage(
  order: Pick<
    Order,
    | "patientName"
    | "patientPhone"
    | "fulfillmentType"
    | "deliveryAddress"
    | "deliveryZoneName"
    | "deliveryLatitude"
    | "deliveryLongitude"
  >,
  pharmacyName: string,
): string {
  if (order.fulfillmentType !== "delivery") {
    return `${order.patientName}'s collection order at ${pharmacyName} is ready.`;
  }
  const lines = [
    `${order.patientName}'s delivery order at ${pharmacyName} is packed. Assign a courier.`,
    `Patient phone: ${order.patientPhone}`,
    `Deliver to: ${order.deliveryAddress?.trim() || "no directions given"}`,
  ];
  if (order.deliveryZoneName) lines.push(`Zone: ${order.deliveryZoneName}`);
  const map = deliveryMapLink(order);
  if (map) lines.push(`Map: ${map}`);
  return lines.join("\n");
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
      title: order.fulfillmentType === "delivery" ? "Delivery ready for a courier" : "Order ready",
      body: orderReadyMessage(order, pharmacyName),
      // Delivery orders get their own type so HQ opens Dispatch, where the
      // courier is assigned, instead of the order list.
      type: order.fulfillmentType === "delivery" ? "delivery_ready" : "order_ready",
      referenceId: order.id,
    },
    order.id,
  );
}

/**
 * A Monime payment that needs a person: a late payment that can't go ahead,
 * a paid order cancelled before the money was released (refund to pay by hand
 * until refunds are automated), or a payment that doesn't match its order.
 */
export async function notifyHqOfPaymentIssue(
  order: Pick<Order, "id" | "patientName" | "totalLeones">,
  title: string,
  detail: string,
): Promise<void> {
  await notifyActiveHqStaff(
    {
      title,
      body: `Order #${order.id.slice(0, 8).toUpperCase()} (${order.patientName}, Le ${Number(order.totalLeones).toFixed(2)}): ${detail}`,
      type: "payment_issue",
      referenceId: order.id,
    },
    order.id,
  );
}

/**
 * Online-payment money that needs a person (Monime phase 2): a cash-out
 * waiting for approval, a failed cash-out, or order money that could not be
 * released to the pharmacy.
 */
export async function notifyHqOfPayoutIssue(
  referenceId: string,
  title: string,
  body: string,
): Promise<void> {
  await notifyActiveHqStaff({ title, body, type: "payout_issue", referenceId }, referenceId);
}
