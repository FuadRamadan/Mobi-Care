import { pgTable, uuid, text, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { patientsTable } from "./patients";
import { pharmaciesTable } from "./pharmacies";

/**
 * One browser that agreed to receive notifications while MobiCare is closed,
 * for one patient or one pharmacy (migration 0040). See lib/webPush.ts.
 */
export const webPushSubscriptionsTable = pgTable(
  "web_push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id").references(() => patientsTable.id, { onDelete: "cascade" }),
    pharmacyId: uuid("pharmacy_id").references(() => pharmaciesTable.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("web_push_subscriptions_endpoint_idx").on(t.endpoint),
    index("web_push_subscriptions_patient_idx").on(t.patientId).where(sql`${t.patientId} IS NOT NULL`),
    index("web_push_subscriptions_pharmacy_idx").on(t.pharmacyId).where(sql`${t.pharmacyId} IS NOT NULL`),
    check("web_push_subscriptions_one_owner", sql`(${t.patientId} IS NULL) <> (${t.pharmacyId} IS NULL)`),
  ],
);

export type WebPushSubscription = typeof webPushSubscriptionsTable.$inferSelect;
