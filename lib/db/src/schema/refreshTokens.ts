import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pharmaciesTable } from "./pharmacies";

export const refreshTokensTable = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  pharmacyId: uuid("pharmacy_id")
    .notNull()
    .references(() => pharmaciesTable.id, { onDelete: "cascade" }),
  // Store SHA-256 hash of the raw token — never the raw value
  tokenHash: text("token_hash").notNull().unique(),
  // Bind the refresh credential to the pharmacy password/session generation.
  sessionVersion: integer("session_version").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  // "Is this pharmacy signed in anywhere?" (lib/pharmacyOnline.ts), asked by every search.
  index("refresh_tokens_pharmacy_active_idx").on(t.pharmacyId, t.expiresAt).where(sql`${t.revokedAt} IS NULL`),
]);

export type RefreshToken = typeof refreshTokensTable.$inferSelect;
