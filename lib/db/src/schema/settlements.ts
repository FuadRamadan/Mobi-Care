import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { pharmaciesTable } from "./pharmacies";
import { couriersTable } from "./couriers";

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
