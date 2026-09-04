import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  pgEnum,
  uniqueIndex,
  date,
  index,
} from "drizzle-orm/pg-core";
import { pharmaciesTable } from "./pharmacies";
import { couriersTable } from "./couriers";
import { hqStaffTable } from "./hqStaff";
import { ordersTable } from "./orders";

export const settlementStatusEnum = pgEnum("settlement_status", [
  "pending",
  "paid",
]);

/** Pharmacy payouts — amounts owed to a pharmacy for a settlement period. */
export const settlementsTable = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pharmacyId: uuid("pharmacy_id")
      .notNull()
      .references(() => pharmaciesTable.id, { onDelete: "restrict" }),
    amountLeones: integer("amount_leones").notNull(),
    amountMinor: integer("amount_minor").notNull().default(0),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    orderCount: integer("order_count").notNull().default(0),
    status: settlementStatusEnum("status").notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    reference: text("reference"), // payment reference once paid
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Idempotent generation: one settlement per pharmacy per exact period
    uniqueIndex("settlements_pharmacy_period_uq").on(
      t.pharmacyId,
      t.periodStart,
      t.periodEnd,
    ),
  ],
);

export type Settlement = typeof settlementsTable.$inferSelect;

/**
 * Daily commission ledger. This is intentionally separate from the legacy
 * `settlements` payout ledger: historical payout records remain immutable and
 * cannot be mistaken for amounts a pharmacy owes the platform.
 */
export const commissionSettlementStatusEnum = pgEnum(
  "commission_settlement_status",
  ["unpaid", "partially_paid", "paid"],
);

export const commissionSettlementsTable = pgTable(
  "commission_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pharmacyId: uuid("pharmacy_id")
      .notNull()
      .references(() => pharmaciesTable.id, { onDelete: "restrict" }),
    /** Local calendar date in `businessTimezone`, never a server-local date. */
    settlementDate: date("settlement_date", { mode: "string" }).notNull(),
    businessTimezone: text("business_timezone").notNull(),
    ordersCount: integer("orders_count").notNull(),
    grossCollectedMinor: integer("gross_collected_minor").notNull(),
    drugAmountTotalMinor: integer("drug_amount_total_minor").notNull(),
    commissionDueMinor: integer("commission_due_minor").notNull(),
    amountPaidMinor: integer("amount_paid_minor").notNull().default(0),
    balanceMinor: integer("balance_minor").notNull(),
    status: commissionSettlementStatusEnum("status").notNull().default("unpaid"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paymentReference: text("payment_reference"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("commission_settlements_pharmacy_day_uq").on(
      table.pharmacyId,
      table.settlementDate,
    ),
    index("commission_settlements_date_idx").on(table.settlementDate),
    index("commission_settlements_status_idx").on(table.status),
  ],
);

/** Append-only payment history; never replace a settlement's prior payment. */
export const commissionSettlementPaymentsTable = pgTable(
  "commission_settlement_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => commissionSettlementsTable.id, { onDelete: "restrict" }),
    amountMinor: integer("amount_minor").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    paymentReference: text("payment_reference").notNull(),
    recordedByHqStaffId: uuid("recorded_by_hq_staff_id").references(
      () => hqStaffTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("commission_payment_settlement_idx").on(table.settlementId)],
);

/** Append-only corrections, including post-close refunds, with an audit reason. */
export const commissionSettlementAdjustmentsTable = pgTable(
  "commission_settlement_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => commissionSettlementsTable.id, { onDelete: "restrict" }),
    amountMinor: integer("amount_minor").notNull(),
    reason: text("reason").notNull(),
    sourceOrderId: uuid("source_order_id").references(() => ordersTable.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("commission_adjustment_settlement_idx").on(table.settlementId),
    index("commission_adjustment_order_idx").on(table.sourceOrderId),
  ],
);

export type CommissionSettlement = typeof commissionSettlementsTable.$inferSelect;
export type CommissionSettlementPayment =
  typeof commissionSettlementPaymentsTable.$inferSelect;
export type CommissionSettlementAdjustment =
  typeof commissionSettlementAdjustmentsTable.$inferSelect;

/** Courier payouts — separate settlement track for couriers. */
export const courierSettlementsTable = pgTable(
  "courier_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courierId: uuid("courier_id")
      .notNull()
      .references(() => couriersTable.id, { onDelete: "restrict" }),
    amountLeones: integer("amount_leones").notNull(),
    amountMinor: integer("amount_minor").notNull().default(0),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    deliveryCount: integer("delivery_count").notNull().default(0),
    status: settlementStatusEnum("status").notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    reference: text("reference"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("courier_settlements_courier_period_uq").on(
      t.courierId,
      t.periodStart,
      t.periodEnd,
    ),
  ],
);

export type CourierSettlement = typeof courierSettlementsTable.$inferSelect;
