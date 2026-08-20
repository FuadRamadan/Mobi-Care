import { pgTable, uuid, text, timestamp, serial } from "drizzle-orm/pg-core";
import { pharmaciesTable } from "./pharmacies";

/**
 * Stores previous bcrypt password hashes for a pharmacy to prevent re-use.
 * Only hashes are stored — never plaintext passwords.
 */
export const pharmacyPasswordHistoryTable = pgTable("pharmacy_password_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Monotonic insertion order makes the exact "last N" window deterministic,
  // even when multiple entries share the same database timestamp.
  sequence: serial("sequence").notNull(),
  pharmacyId: uuid("pharmacy_id")
    .notNull()
    .references(() => pharmaciesTable.id, { onDelete: "cascade" }),
  // bcrypt hash of the old password — never store plaintext
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PharmacyPasswordHistory = typeof pharmacyPasswordHistoryTable.$inferSelect;
