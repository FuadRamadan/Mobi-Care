import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * HQ staff accounts — the oversight role for the whole platform.
 * No self-registration: the first account is created by scripts/bootstrap-hq.ts
 * and further accounts are created by existing HQ staff (future work).
 */
export const hqStaffTable = pgTable("hq_staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  phone: text("phone").unique(),
  isActive: boolean("is_active").notNull().default(true),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HqStaff = typeof hqStaffTable.$inferSelect;

/** Separate refresh-token store for HQ staff (pharmacy tokens live in refresh_tokens). */
export const hqRefreshTokensTable = pgTable("hq_refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  hqStaffId: uuid("hq_staff_id")
    .notNull()
    .references(() => hqStaffTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HqRefreshToken = typeof hqRefreshTokensTable.$inferSelect;
