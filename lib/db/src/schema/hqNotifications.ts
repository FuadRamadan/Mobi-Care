import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { hqStaffTable } from "./hqStaff";

/**
 * Notifications are personal to each HQ staff account so an acknowledgement by
 * one staff member never clears the alert for another member of the team.
 */
export const hqNotificationsTable = pgTable("hq_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  hqStaffId: uuid("hq_staff_id")
    .notNull()
    .references(() => hqStaffTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  type: text("type"),
  referenceId: uuid("reference_id"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertHqNotificationSchema = createInsertSchema(
  hqNotificationsTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertHqNotification = z.infer<typeof insertHqNotificationSchema>;
export type HqNotification = typeof hqNotificationsTable.$inferSelect;
