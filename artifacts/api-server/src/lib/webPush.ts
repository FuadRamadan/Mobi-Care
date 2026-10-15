/**
 * Browser notifications that drop down on the phone or computer even when
 * MobiCare is closed (Web Push), for the patient app and the pharmacy portal.
 *
 * Needs a VAPID key pair: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (SECRET),
 * made once with `npx web-push generate-vapid-keys`. Without them the feature
 * is off and the apps hide the switch. Changing the keys stops every existing
 * subscription working: browsers must turn notifications on again.
 *
 * Sending never throws: a notification that cannot be delivered must not undo
 * the order change that caused it.
 */
import webpush from "web-push";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, webPushSubscriptionsTable } from "@workspace/db";
import { logger } from "./logger.js";

export interface WebPushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** The VAPID settings, or null when Web Push is not set up. */
export function webPushConfig(env: NodeJS.ProcessEnv = process.env): WebPushConfig | null {
  const publicKey = env["VAPID_PUBLIC_KEY"]?.trim();
  const privateKey = env["VAPID_PRIVATE_KEY"]?.trim();
  if (!publicKey || !privateKey) return null;
  // Push services want a way to reach whoever runs the server: a mailto: or
  // https: address. Default to the site itself.
  const origin = (env["ALLOWED_ORIGINS"] ?? "").split(",").map((o) => o.trim()).find((o) => o.startsWith("https://"));
  const subject = env["VAPID_SUBJECT"]?.trim() || origin || "https://mobicare.sl";
  return { publicKey, privateKey, subject };
}

let configured: WebPushConfig | null | undefined;
function ready(): WebPushConfig | null {
  if (configured === undefined) {
    configured = webPushConfig();
    if (configured) {
      try {
        webpush.setVapidDetails(configured.subject, configured.publicKey, configured.privateKey);
      } catch (err) {
        logger.error({ err }, "Web Push keys are not valid; browser notifications are off");
        configured = null;
      }
    }
  }
  return configured;
}

export function webPushPublicKey(): string | null {
  return ready()?.publicKey ?? null;
}

export interface WebPushMessage {
  title: string;
  body: string;
  /** The page to open when the notification is tapped, on the same site. */
  url: string;
  /** Notifications with the same tag replace each other instead of piling up. */
  tag?: string;
}

/** Send to every browser one patient or pharmacy turned notifications on in. */
export async function sendWebPush(
  to: { patientId: string } | { pharmacyId: string },
  message: WebPushMessage,
): Promise<void> {
  if (!ready()) return;
  try {
    const owner = "patientId" in to
      ? eq(webPushSubscriptionsTable.patientId, to.patientId)
      : eq(webPushSubscriptionsTable.pharmacyId, to.pharmacyId);
    const subscriptions = await db.select().from(webPushSubscriptionsTable).where(owner);
    if (subscriptions.length === 0) return;
    const payload = JSON.stringify(message);
    const gone: string[] = [];
    const delivered: string[] = [];
    await Promise.all(subscriptions.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          // Kept for a day if the phone is off; shown at once when it is on.
          { TTL: 24 * 3600, urgency: "high", timeout: 10_000 },
        );
        delivered.push(s.id);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410: the browser unsubscribed or was reset. Forget it.
        if (status === 404 || status === 410) gone.push(s.id);
        else logger.warn({ status, subscriptionId: s.id }, "Web Push delivery failed");
      }
    }));
    if (gone.length) await db.delete(webPushSubscriptionsTable).where(inArray(webPushSubscriptionsTable.id, gone));
    if (delivered.length) {
      await db.update(webPushSubscriptionsTable).set({ lastSentAt: sql`now()` })
        .where(inArray(webPushSubscriptionsTable.id, delivered));
    }
  } catch (err) {
    logger.error({ err }, "Web Push send failed");
  }
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

/**
 * Remember a browser for a patient or pharmacy. The same browser signed in as
 * someone else moves to them: notifications follow whoever is signed in.
 */
export async function saveSubscription(owner: { patientId: string } | { pharmacyId: string }, input: SubscriptionInput): Promise<void> {
  const values = {
    patientId: "patientId" in owner ? owner.patientId : null,
    pharmacyId: "pharmacyId" in owner ? owner.pharmacyId : null,
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    userAgent: input.userAgent?.slice(0, 300) ?? null,
  };
  await db.insert(webPushSubscriptionsTable).values(values).onConflictDoUpdate({
    target: webPushSubscriptionsTable.endpoint,
    set: { ...values, createdAt: sql`now()`, lastSentAt: null },
  });
}

/** Forget a browser, but only for its current owner. */
export async function removeSubscription(owner: { patientId: string } | { pharmacyId: string }, endpoint: string): Promise<void> {
  await db.delete(webPushSubscriptionsTable).where(and(
    eq(webPushSubscriptionsTable.endpoint, endpoint),
    "patientId" in owner
      ? and(eq(webPushSubscriptionsTable.patientId, owner.patientId), isNull(webPushSubscriptionsTable.pharmacyId))
      : and(eq(webPushSubscriptionsTable.pharmacyId, owner.pharmacyId), isNull(webPushSubscriptionsTable.patientId)),
  ));
}

/**
 * The browsers' own push services. The server posts to whatever address the
 * browser hands over, so anything else is refused: otherwise a caller could
 * make the server send requests to an address of their choosing.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge on Android, Samsung Internet
  /^(updates\.)?push\.services\.mozilla\.com$/, // Firefox
  /^web\.push\.apple\.com$/, // Safari on iPhone, iPad and Mac
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge on Windows
];

export function isPushEndpoint(value: string): boolean {
  if (value.length > 1000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}
