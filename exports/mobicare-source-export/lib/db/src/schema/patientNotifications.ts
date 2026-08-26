import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { patientsTable } from "./patients";

export const patientNotificationsTable = pgTable("patient_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patientsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  // e.g. "order_status", "prescription_rejected", "order_cancelled"
  type: text("type"),
  // ID of the related entity (order id)
  referenceId: uuid("reference_id"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PatientNotification = typeof patientNotificationsTable.$inferSelect;
