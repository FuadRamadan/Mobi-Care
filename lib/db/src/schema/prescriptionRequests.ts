import { pgTable, uuid, text, timestamp, pgEnum, integer, doublePrecision, jsonb, index, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pharmaciesTable } from "./pharmacies";
import { patientsTable } from "./patients";
import { ordersTable } from "./orders";
import { deliveryZonesTable } from "./deliveryZones";
import { prescriptionRejectReasonEnum } from "./prescriptions";

/**
 * A patient's prescription photo, sent to the pharmacies around them round by
 * round until one accepts (migration 0039). See lib/prescriptionRequests.ts.
 */
export const prescriptionRequestStatusEnum = pgEnum("prescription_request_status", [
  "searching", // being offered to pharmacies
  "accepted", // a pharmacy took it and is choosing the medicines
  "ready", // the pharmacy confirmed what it can supply; the patient can order
  "ordered", // the patient placed the order
  "expired", // no pharmacy took it, or the patient did not order in time
  "cancelled", // the patient cancelled
  "rejected", // the accepting pharmacist rejected the prescription
]);

export interface PrescriptionRequestItem {
  inventoryId: string;
  /** The most the patient may order, set by the pharmacist. */
  maxQuantity: number;
}

export const prescriptionRequestsTable = pgTable("prescription_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  /** The original photo: shown only to the pharmacy that accepts. */
  imageKey: text("image_key").notNull(),
  /** The copy with the patient's name covered: what pharmacies see before accepting. */
  coveredImageKey: text("covered_image_key"),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  zoneId: uuid("zone_id").references(() => deliveryZonesTable.id, { onDelete: "set null" }),
  /** Zone or district name, the only location pharmacies see before accepting. */
  areaName: text("area_name"),
  note: text("note"),
  status: prescriptionRequestStatusEnum("status").notNull().default("searching"),
  round: integer("round").notNull().default(0),
  roundStartedAt: timestamp("round_started_at", { withTimezone: true }),
  acceptedPharmacyId: uuid("accepted_pharmacy_id").references(() => pharmaciesTable.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  items: jsonb("items").$type<PrescriptionRequestItem[]>(),
  rejectReason: prescriptionRejectReasonEnum("reject_reason"),
  orderId: uuid("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  imagesDeletedAt: timestamp("images_deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("prescription_requests_open_idx").on(t.status, t.roundStartedAt)
    .where(sql`${t.status} IN ('searching', 'accepted', 'ready')`),
  index("prescription_requests_patient_idx").on(t.patientId, t.createdAt.desc()),
]);

export const prescriptionRequestOffersTable = pgTable("prescription_request_offers", {
  requestId: uuid("request_id").notNull().references(() => prescriptionRequestsTable.id, { onDelete: "cascade" }),
  pharmacyId: uuid("pharmacy_id").notNull().references(() => pharmaciesTable.id, { onDelete: "cascade" }),
  round: integer("round").notNull(),
  notifiedAt: timestamp("notified_at", { withTimezone: true }).notNull().defaultNow(),
  declinedAt: timestamp("declined_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.requestId, t.pharmacyId] }),
  index("prescription_request_offers_pharmacy_idx").on(t.pharmacyId, t.notifiedAt.desc()),
]);

export type PrescriptionRequest = typeof prescriptionRequestsTable.$inferSelect;
