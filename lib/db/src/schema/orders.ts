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
import { hqStaffTable } from "./hqStaff";

export const deliveryConfirmationMethodEnum = pgEnum(
  "delivery_confirmation_method",
  ["patient", "hq"],
);

/**
 * Full order status lifecycle:
 *   awaiting_payment → paid → confirmed → packaging → ready
 *   ready → collected            (collection path — pharmacy drives)
 *   ready → assigned → picked_up → delivering               (dispatch drives)
 *   delivering → delivered                                  (customer confirms receipt)
 *   * → cancelled
 *
 * Pharmacy may only write: confirmed, packaging, ready (via PATCH /pharmacy/orders/:id/status)
 *   and collected (via POST /pharmacy/orders/:id/collected)
 *   and picked_up (via POST /pharmacy/orders/:id/picked-up, marks courier handoff)
 * Dispatch/HQ may write delivering, but only the customer may confirm delivered.
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

  // Exact decimal total in Leone units (kept for backwards compatibility).
  totalLeones: numeric("total_leones", { precision: 14, scale: 2 }).notNull(),

  // Immutable checkout financial snapshot. All amounts are integer cents.
  medicineMarkupBasisPoints: integer("medicine_markup_basis_points")
    .notNull()
    .default(500),
  pharmacyMedicineTotalMinor: integer("pharmacy_medicine_total_minor")
    .notNull()
    .default(0),
  medicineCommissionMinor: integer("medicine_commission_minor")
    .notNull()
    .default(0),
  patientMedicineTotalMinor: integer("patient_medicine_total_minor")
    .notNull()
    .default(0),
  deliveryFeeMinor: integer("delivery_fee_minor").notNull().default(0),
  courierPayoutMinor: integer("courier_payout_minor").notNull().default(0),
  deliveryCommissionMinor: integer("delivery_commission_minor")
    .notNull()
    .default(0),

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
  completedAt: timestamp("completed_at", { withTimezone: true }),
  deliveryConfirmedAt: timestamp("delivery_confirmed_at", {
    withTimezone: true,
  }),
  deliveryConfirmationMethod: deliveryConfirmationMethodEnum(
    "delivery_confirmation_method",
  ),
  deliveryConfirmedByHqUserId: uuid(
    "delivery_confirmed_by_hq_user_id",
  ).references(() => hqStaffTable.id, { onDelete: "set null" }),

  // Patient-only history visibility. The order and all operational/financial
  // records remain intact for pharmacies, HQ, audits, and settlements.
  patientHiddenAt: timestamp("patient_hidden_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Order = typeof ordersTable.$inferSelect;
