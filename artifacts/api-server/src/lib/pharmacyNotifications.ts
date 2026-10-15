import { db } from "@workspace/db";
import { notificationsTable, type Order } from "@workspace/db/schema";
import { logger } from "./logger.js";
import { sendWebPush } from "./webPush.js";
import { orderNumber } from "./orderNumber.js";

interface PharmacyNotificationPayload {
  pharmacyId: string;
  title: string;
  body: string;
  type: "new_order" | "order_paid" | "prescription_submitted" | "order_cancelled" | "drug_request_review" | "payout" | "prescription_request";
  referenceId?: string | null;
}

/**
 * Save an in-portal activity alert for one pharmacy. Notification delivery must
 * never undo the order or prescription event that triggered it.
 */
export async function createPharmacyNotification(
  payload: PharmacyNotificationPayload,
): Promise<void> {
  try {
    await db.insert(notificationsTable).values({
      pharmacyId: payload.pharmacyId,
      title: payload.title,
      body: payload.body,
      type: payload.type,
      referenceId: payload.referenceId ?? null,
    });
  } catch (error) {
    logger.error(
      { err: error, pharmacyId: payload.pharmacyId, referenceId: payload.referenceId },
      "Failed to create pharmacy incoming notification",
    );
  }
  // Drops down on the pharmacy's computer or phone, even with the portal in
  // the background.
  await sendWebPush({ pharmacyId: payload.pharmacyId }, {
    title: payload.title,
    body: payload.body,
    url: `/pharmacy-portal${PORTAL_PAGE[payload.type]}`,
    tag: payload.referenceId ?? undefined,
  });
}

/** Where a tap on each kind of notification opens the portal. */
const PORTAL_PAGE: Record<PharmacyNotificationPayload["type"], string> = {
  new_order: "/orders",
  order_paid: "/orders",
  order_cancelled: "/orders",
  prescription_submitted: "/prescriptions",
  prescription_request: "/prescription-requests",
  drug_request_review: "/inventory",
  payout: "/payouts",
};

export async function notifyPharmacyOfNewOrder(order: Order): Promise<void> {
  await createPharmacyNotification({
    pharmacyId: order.pharmacyId,
    title: "New incoming order",
    body: `Order #${orderNumber(order.id)}: ${order.patientName} placed a ${order.fulfillmentType} order. Payment is pending.`,
    type: "new_order",
    referenceId: order.id,
  });
}

export async function notifyPharmacyOfPaidOrder(order: Order): Promise<void> {
  await createPharmacyNotification({
    pharmacyId: order.pharmacyId,
    title: "Order ready to confirm",
    body: `Order #${orderNumber(order.id)}: ${order.patientName}'s payment is recorded. Review and confirm this order to begin fulfilment.`,
    type: "order_paid",
    referenceId: order.id,
  });
}

export async function notifyPharmacyOfSubmittedPrescription(input: {
  pharmacyId: string;
  prescriptionId: string;
  patientName: string;
}): Promise<void> {
  await createPharmacyNotification({
    pharmacyId: input.pharmacyId,
    title: "Prescription ready for review",
    body: `${input.patientName} submitted a prescription that needs pharmacist review.`,
    type: "prescription_submitted",
    referenceId: input.prescriptionId,
  });
}

export async function notifyPharmacyOfExpiredOrder(input: {
  pharmacyId: string;
  orderId: string;
}): Promise<void> {
  await createPharmacyNotification({
    pharmacyId: input.pharmacyId,
    title: "Unpaid order cancelled",
    body: `Order #${input.orderId.slice(0, 8).toUpperCase()} expired before payment and its reserved stock was returned.`,
    type: "order_cancelled",
    referenceId: input.orderId,
  });
}

export async function notifyPharmacyOfPatientCancellation(order: Order): Promise<void> {
  await createPharmacyNotification({
    pharmacyId: order.pharmacyId,
    title: "Patient cancelled an order",
    body: `${order.patientName} cancelled order #${order.id.slice(0, 8).toUpperCase()}.`,
    type: "order_cancelled",
    referenceId: order.id,
  });
}