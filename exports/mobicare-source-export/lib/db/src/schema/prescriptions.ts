import { pgTable, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { pharmaciesTable } from "./pharmacies";

export const prescriptionStatusEnum = pgEnum("prescription_status", [
  "pending",
  "approved",
  "rejected",
]);

/**
 * Fixed enum — do NOT add free-text reasons. Every rejection must have an auditable reason
 * from this closed set. Additions require a schema migration and clinical review.
 */
export const prescriptionRejectReasonEnum = pgEnum("prescription_reject_reason", [
  "illegible_image",
  "expired_prescription",
  "invalid_prescription",
  "drug_unavailable",
  "controlled_substance_not_authorized",
  "patient_mismatch",
  "quantity_exceeded",
]);

export const prescriptionsTable = pgTable("prescriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  pharmacyId: uuid("pharmacy_id")
    .notNull()
    .references(() => pharmaciesTable.id, { onDelete: "restrict" }),

  // Patient snapshot (same ownership caveat as orders — belongs to patient service)
  patientName: text("patient_name").notNull(),
  patientPhone: text("patient_phone").notNull(),

  // The encrypted image key (references encrypted-at-rest storage, NOT a public URL).
  // Never serve raw bytes; always mint short-lived signed URLs via POST /prescriptions/:id/image-url
  imageKey: text("image_key").notNull(),

  status: prescriptionStatusEnum("status").notNull().default("pending"),

  // Comma-separated approved drug catalogue IDs (subset of what was on the prescription)
  approvedDrugIds: uuid("approved_drug_ids").array(),

  // Rejection fields — only set when status = 'rejected'
  rejectReason: prescriptionRejectReasonEnum("reject_reason"),
  rejectNote: text("reject_note"), // optional extra context, NOT the primary rejection record

  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

  // Optional link back to the order that triggered this prescription review
  orderId: uuid("order_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Prescription = typeof prescriptionsTable.$inferSelect;
