/**
 * Patient notification helper.
 *
 * Every order-status transition calls createPatientNotification() to:
 *   1. Insert a persistent in-app notification row for the patient.
 *   2. Fire the stubbed SMS sender (no-op until a gateway is configured).
 *
 * Both steps are fire-and-forget — a failure here must never block the
 * status transition response back to the caller.
 */
import { db } from "@workspace/db";
import { patientNotificationsTable, patientsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { sendSms } from "./sms.js";
import { sendExpoPush } from "./push.js";

export interface NotificationPayload {
  patientId: string;
  patientPhone: string;
  title: string;
  body: string;
  type?: string;
  /** orderId or other related entity id */
  referenceId?: string;
}

/**
 * Insert a patient notification and fire the SMS stub.
 * Swallows all errors so callers never need try/catch.
 */
export async function createPatientNotification(
  payload: NotificationPayload
): Promise<void> {
  try {
    await db.insert(patientNotificationsTable).values({
      patientId: payload.patientId,
      title: payload.title,
      body: payload.body,
      type: payload.type ?? null,
      referenceId: payload.referenceId ?? null,
    });
  } catch (err) {
    console.error("[patientNotifications] DB insert failed:", err);
  }

  try {
    await sendSms(payload.patientPhone, `MobiCare: ${payload.body}`);
  } catch (err) {
    console.error("[patientNotifications] SMS send failed:", err);
  }

  // Push notification (fire-and-forget; deep-links into the order detail screen)
  try {
    const [patient] = await db
      .select({ expoPushToken: patientsTable.expoPushToken })
      .from(patientsTable)
      .where(eq(patientsTable.id, payload.patientId))
      .limit(1);
    const expoPushToken = patient?.expoPushToken;
    if (expoPushToken) {
      await sendExpoPush({
        to: expoPushToken,
        title: payload.title,
        body: payload.body,
        data: payload.referenceId ? { url: `/order/${payload.referenceId}` } : {},
      }, {
        onDeviceNotRegistered: async () => {
          // Only clear the token that failed. A newer app registration must
          // not be removed if it arrived while Expo was processing this push.
          await db
            .update(patientsTable)
            .set({ expoPushToken: null, updatedAt: new Date() })
            .where(
              and(
                eq(patientsTable.id, payload.patientId),
                eq(patientsTable.expoPushToken, expoPushToken)
              )
            );
        },
      });
    }
  } catch (err) {
    console.error("[patientNotifications] Push send failed:", err);
  }
}

/** Returns the notification title + body for a given order status. */
export function notificationForStatus(
  status: string,
  fulfillmentType: "delivery" | "collection"
): { title: string; body: string; type: string } | null {
  switch (status) {
    case "confirmed":
      return {
        title: "Order confirmed ✓",
        body: "The pharmacy has confirmed your order and will start preparing it shortly.",
        type: "order_status",
      };
    case "packaging":
      return {
        title: "Order being prepared 📦",
        body: "Your medicines are being packed and will be ready soon.",
        type: "order_status",
      };
    case "ready":
      return fulfillmentType === "delivery"
        ? {
            title: "Ready for dispatch 🚴",
            body: "Your order is packed and waiting for a rider. We'll notify you when it's picked up.",
            type: "order_status",
          }
        : {
            title: "Ready for collection 🏥",
            body: "Your order is ready! Please bring your ID to the pharmacy to collect it.",
            type: "order_status",
          };
    case "assigned":
      return {
        title: "Rider assigned 🚴",
        body: "A courier has been assigned and is heading to the pharmacy to collect your order.",
        type: "order_status",
      };
    case "picked_up":
      return {
        title: "Order picked up 📬",
        body: "Your order has left the pharmacy and is on its way to you.",
        type: "order_status",
      };
    case "delivering":
      return {
        title: "On the way! 🛵",
        body: "Your rider is heading to your delivery address. Please be available to receive it.",
        type: "order_status",
      };
    case "delivered":
      return {
        title: "Delivered! 🎉",
        body: "Your order has been delivered. Thank you for choosing MobiCare — get well soon!",
        type: "order_status",
      };
    case "collected":
      return {
        title: "Order collected ✅",
        body: "Your order has been collected in person. Thank you for choosing MobiCare!",
        type: "order_status",
      };
    case "cancelled":
      return {
        title: "Order cancelled",
        body: "Your order has been cancelled. If you have questions, please contact the pharmacy.",
        type: "order_cancelled",
      };
    default:
      return null;
  }
}
