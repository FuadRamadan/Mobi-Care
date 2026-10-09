import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * What the security monitor records: failed sign-ins, attempts blocked for
 * guessing, browser reports of blocked content, and server errors. HQ reads it
 * on Security & Settings, and alerts are raised from it.
 *
 * Kept 90 days, then deleted. The network address is kept so repeated attempts
 * from one place can be seen; the identifier typed at sign-in is stored masked
 * (a phone number shows only its last three digits).
 */
export const securityEventsTable = pgTable(
  "security_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    /** "patient", "pharmacy" or "hq" for sign-in events. */
    role: text("role"),
    /** The account the event concerns, when one was found. */
    accountId: uuid("account_id"),
    /** What was typed at sign-in, masked. */
    identifier: text("identifier"),
    ipAddress: text("ip_address"),
    path: text("path"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("security_events_kind_created_idx").on(table.kind, table.createdAt)],
);

export type SecurityEvent = typeof securityEventsTable.$inferSelect;
