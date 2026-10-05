import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";

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
