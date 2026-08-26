import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { pharmaciesTable } from "./pharmacies";

export const notificationsTable = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  pharmacyId: uuid("pharmacy_id")
    .notNull()
    .references(() => pharmaciesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  // e.g. "new_order", "prescription_submitted", "order_cancelled"
  type: text("type"),
  // ID of the related entity (order, prescription, etc.)
  referenceId: uuid("reference_id"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
