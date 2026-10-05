import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";
import { pharmaciesTable } from "./pharmacies";

/**
 * Monime payment links (checkout sessions), one row per attempt for an order.
 *
 * The row, with the exact request body and idempotency key, is saved before
 * Monime is called. A retry after a crash re-sends that identical request, so
 * Monime returns the original link instead of making a second one.
 */
export const monimeCheckoutSessionsTable = pgTable(
  "monime_checkout_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "restrict" }),
    attempt: integer("attempt").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestBody: jsonb("request_body").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    /** creating | pending | completed | expired | cancelled | deleted */
    status: text("status").notNull().default("creating"),
    monimeSessionId: text("monime_session_id"),
    monimeOrderNumber: text("monime_order_number"),
    redirectUrl: text("redirect_url"),
    expireTime: timestamp("expire_time", { withTimezone: true }),
    monimePaymentId: text("monime_payment_id"),
    /** Monime's actual fees on the payment, as reported. */
    fees: jsonb("fees"),
    /** momo / card / bank / wallet */
    payerChannel: text("payer_channel"),
    /** e.g. m17 (Orange Money) */
    payerProvider: text("payer_provider"),
    monimeRequestId: text("monime_request_id"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("monime_checkout_sessions_order_attempt_unique").on(
      table.orderId,
      table.attempt,
    ),
    unique("monime_checkout_sessions_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    unique("monime_checkout_sessions_session_unique").on(table.monimeSessionId),
    index("monime_checkout_sessions_status_idx").on(
      table.status,
      table.updatedAt,
    ),
    index("monime_checkout_sessions_order_number_idx").on(
      table.monimeOrderNumber,
    ),
  ],
);

export type MonimeCheckoutSession =
  typeof monimeCheckoutSessionsTable.$inferSelect;

/**
 * Every webhook Monime sends, as received. The event ID is the primary key,
 * so a resent event is recognised and ignored.
 */
export const monimeWebhookEventsTable = pgTable("monime_webhook_events", {
  eventId: text("event_id").primaryKey(),
  name: text("name").notNull(),
  objectType: text("object_type"),
  objectId: text("object_id"),
  eventTimestamp: timestamp("event_timestamp", { withTimezone: true }),
  payload: jsonb("payload").notNull(),
  /** received | processed | ignored | failed */
  outcome: text("outcome").notNull().default("received"),
  detail: text("detail"),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

/**
 * Each pharmacy's account inside MobiCare's Monime space (phase 2). The row,
 * with the exact request and key, is saved before Monime is called.
 */
export const pharmacyMonimeAccountsTable = pgTable("pharmacy_monime_accounts", {
  pharmacyId: uuid("pharmacy_id")
    .primaryKey()
    .references(() => pharmaciesTable.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull().unique("pharmacy_monime_accounts_key_unique"),
  requestBody: jsonb("request_body").notNull(),
  /** creating | active */
  status: text("status").notNull().default("creating"),
  monimeAccountId: text("monime_account_id").unique("pharmacy_monime_accounts_account_unique"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PharmacyMonimeAccount = typeof pharmacyMonimeAccountsTable.$inferSelect;

/**
 * Money released out of Holding when an order is delivered or collected: a
 * 'pharmacy_share' and a 'mobicare_share' transfer per order. A failed
 * transfer is retried as a new attempt; the failed row stays as history.
 */
export const monimeTransfersTable = pgTable(
  "monime_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "restrict" }),
    pharmacyId: uuid("pharmacy_id")
      .notNull()
      .references(() => pharmaciesTable.id, { onDelete: "restrict" }),
    /** pharmacy_share | mobicare_share */
    kind: text("kind").notNull(),
    attempt: integer("attempt").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    destinationAccountId: text("destination_account_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestBody: jsonb("request_body"),
    /** creating | pending | processing | completed | failed | skipped */
    status: text("status").notNull().default("creating"),
    monimeTransferId: text("monime_transfer_id"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("monime_transfers_order_kind_attempt_unique").on(table.orderId, table.kind, table.attempt),
    unique("monime_transfers_key_unique").on(table.idempotencyKey),
    unique("monime_transfers_monime_id_unique").on(table.monimeTransferId),
    index("monime_transfers_status_idx").on(table.status, table.updatedAt),
    index("monime_transfers_pharmacy_idx").on(table.pharmacyId, table.kind, table.status),
  ],
);

export type MonimeTransfer = typeof monimeTransfersTable.$inferSelect;

/**
 * A pharmacy's cash-out to its registered mobile money number. Monime's payout
 * fee is charged on top, from the pharmacy's balance: fee_reserved_minor is
 * held back until Monime reports the actual fee.
 */
export const pharmacyCashoutsTable = pgTable(
  "pharmacy_cashouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pharmacyId: uuid("pharmacy_id")
      .notNull()
      .references(() => pharmaciesTable.id, { onDelete: "restrict" }),
    amountMinor: integer("amount_minor").notNull(),
    feeReservedMinor: integer("fee_reserved_minor").notNull(),
    feeMinor: integer("fee_minor"),
    /** m17 (Orange Money) | m18 (AfriMoney) */
    provider: text("provider").notNull(),
    phoneNumber: text("phone_number").notNull(),
    /** awaiting_approval | sending | pending | processing | completed | failed | rejected | cancelled */
    status: text("status").notNull(),
    needsApproval: boolean("needs_approval").notNull().default(false),
    approvedByHqUserId: uuid("approved_by_hq_user_id"),
    approvedByName: text("approved_by_name"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedByHqUserId: uuid("rejected_by_hq_user_id"),
    rejectedByName: text("rejected_by_name"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestBody: jsonb("request_body"),
    monimePayoutId: text("monime_payout_id"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("pharmacy_cashouts_key_unique").on(table.idempotencyKey),
    unique("pharmacy_cashouts_payout_unique").on(table.monimePayoutId),
    index("pharmacy_cashouts_pharmacy_idx").on(table.pharmacyId, table.createdAt),
    index("pharmacy_cashouts_status_idx").on(table.status, table.updatedAt),
    uniqueIndex("pharmacy_cashouts_one_open")
      .on(table.pharmacyId)
      .where(sql`status IN ('awaiting_approval', 'sending', 'pending', 'processing')`),
  ],
);

export type PharmacyCashout = typeof pharmacyCashoutsTable.$inferSelect;
