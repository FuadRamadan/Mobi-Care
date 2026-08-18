import { pgTable, uuid, text, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";

export const flagTypeEnum = pgEnum("flag_type", [
  "velocity",         // too many orders from same patient phone in a window
  "duplicate",        // near-identical order (same phone, pharmacy, total) close together
  "payment_anomaly",  // unusual amount / suspicious payment pattern
]);

export const flagStatusEnum = pgEnum("flag_status", ["open", "reviewed"]);

/**
 * Fraud/anomaly review queue. Populated automatically by checks that run on
 * order writes (see api-server lib/flags.ts) — never left as an empty queue.
 */
export const flagsTable = pgTable("flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  type: flagTypeEnum("type").notNull(),
  reason: text("reason").notNull(),
  details: jsonb("details"),
  status: flagStatusEnum("status").notNull().default("open"),
  reviewedByHqStaffId: uuid("reviewed_by_hq_staff_id"),
  reviewNote: text("review_note"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Flag = typeof flagsTable.$inferSelect;
