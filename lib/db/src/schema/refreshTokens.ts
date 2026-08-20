import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RefreshToken = typeof refreshTokensTable.$inferSelect;
