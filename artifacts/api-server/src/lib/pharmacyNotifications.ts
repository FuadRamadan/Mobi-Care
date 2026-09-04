import { db } from "@workspace/db";
import { notificationsTable, type Order } from "@workspace/db/schema";
import { logger } from "./logger.js";

interface PharmacyNotificationPayload {
  pharmacyId: string;
  title: string;
  body: string;
  type: "new_order" | "order_paid" | "prescription_submitted" | "order_cancelled" | "drug_request_review";
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
}

export async function notifyPharmacyOfNewOrder(order: Order): Promise<void> {
  await createPharmacyNotification({
    pharmacyId: order.pharmacyId,
    title: "New incoming order",
    body: `${order.patientName} placed a ${order.fulfillmentType} order. Payment is pending.`,
    type: "new_order",
    referenceId: order.id,
  });
}

export async function notifyPharmacyOfPaidOrder(order: Order): Promise<void> {
  await createPharmacyNotification({
    pharmacyId: order.pharmacyId,
    title: "Order ready to confirm",
    body: `${order.patientName}'s payment is recorded. Review and confirm this order to begin fulfilment.`,
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