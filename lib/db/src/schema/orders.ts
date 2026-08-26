import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  numeric,
} from "drizzle-orm/pg-core";
import { pharmaciesTable } from "./pharmacies";

/**
 * Full order status lifecycle:
 *   awaiting_payment → paid → confirmed → packaging → ready
 *   ready → collected            (collection path — pharmacy drives)
 *   ready → assigned → picked_up → delivering → delivered  (delivery path — dispatch drives)
 *   * → cancelled
 *
 * Pharmacy may only write: confirmed, packaging, ready (via PATCH /pharmacy/orders/:id/status)
 *   and collected (via POST /pharmacy/orders/:id/collected)
 *   and picked_up (via POST /pharmacy/orders/:id/picked-up, marks courier handoff)
 * Everything past picked_up (delivering, delivered) is written by dispatch/HQ, not this API.
 */
export const orderStatusEnum = pgEnum("order_status", [
  "awaiting_payment",
  "paid",
  "confirmed",
  "packaging",
  "ready",
  "assigned",
  "picked_up",
  "delivering",
  "delivered",
  "collected",
  "cancelled",
]);

export const fulfillmentTypeEnum = pgEnum("fulfillment_type", [
  "delivery",
  "collection",
]);

export const ordersTable = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  pharmacyId: uuid("pharmacy_id")
    .notNull()
    .references(() => pharmaciesTable.id, { onDelete: "restrict" }),

  // Patient info — embedded snapshot.
  // NOTE: In the full platform, patient identity is owned by the patient-app service.
  // This phase embeds a read-only snapshot at order creation time (provided by the
  // patient service or HQ when creating the order). Do not treat these as the
  // source-of-truth for patient PII.
  patientName: text("patient_name").notNull(),
  patientPhone: text("patient_phone").notNull(),

  // Set when the order was placed by a registered patient account on the
  // unified site (null for legacy/HQ-created orders). Used for patient-scoped
  // "my orders" queries.
  patientId: uuid("patient_id"),

  // Delivery address (delivery orders placed by patients).
  deliveryAddress: text("delivery_address"),

  status: orderStatusEnum("status").notNull().default("awaiting_payment"),
  fulfillmentType: fulfillmentTypeEnum("fulfillment_type").notNull(),

  // For Tier-1 (controlled) collection orders: confirmed that ID was checked in person.
  idChecked: boolean("id_checked").notNull().default(false),

  // Exact decimal total in Leone units.
  totalLeones: numeric("total_leones", { precision: 14, scale: 2 }).notNull(),

  // Optional: reference to a prescription that was reviewed for this order.
  prescriptionId: uuid("prescription_id"),

  // ── Dispatch fields (HQ-driven, delivery path) ──────────────────────────────
  // Courier assigned by HQ for delivery orders (null until assigned).
  courierId: uuid("courier_id"),
  // Cash-on-delivery reconciliation: courier handed cash to HQ.
  cashCollected: boolean("cash_collected").notNull().default(false),
  cashCollectedAt: timestamp("cash_collected_at", { withTimezone: true }),
  // Payment method snapshot (e.g. "orange_money", "cash_on_delivery").
  paymentMethod: text("payment_method").notNull().default("orange_money"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Order = typeof ordersTable.$inferSelect;
