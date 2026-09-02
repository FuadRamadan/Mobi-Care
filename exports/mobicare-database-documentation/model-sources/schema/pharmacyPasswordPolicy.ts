import { pgTable, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Singleton table (always exactly one row with id = 1).
 * Use getOrCreatePasswordPolicy() from the shared helper to read/write it.
 */
export const pharmacyPasswordPolicyTable = pgTable("pharmacy_password_policy", {
  id: integer("id").primaryKey().default(1),
  maxPasswordAgeDays: integer("max_password_age_days").notNull().default(90),
  passwordExpiryWarningDays: integer("password_expiry_warning_days")
    .notNull()
    .default(7),
  minPasswordLength: integer("min_password_length").notNull().default(12),
  requireUppercase: boolean("require_uppercase").notNull().default(true),
  requireLowercase: boolean("require_lowercase").notNull().default(true),
  requireNumber: boolean("require_number").notNull().default(true),
  requireSymbol: boolean("require_symbol").notNull().default(true),
  passwordHistoryCount: integer("password_history_count").notNull().default(5),
  temporaryPasswordExpiryHours: integer("temporary_password_expiry_hours")
    .notNull()
    .default(24),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertPharmacyPasswordPolicySchema = createInsertSchema(
  pharmacyPasswordPolicyTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectPharmacyPasswordPolicySchema = createSelectSchema(
  pharmacyPasswordPolicyTable,
);

export type InsertPharmacyPasswordPolicy = z.infer<
  typeof insertPharmacyPasswordPolicySchema
>;
export type PharmacyPasswordPolicy =
  typeof pharmacyPasswordPolicyTable.$inferSelect;
