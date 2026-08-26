import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Patient accounts for the unified-site patient experience.
 * Phone is the primary login identifier (mobile-money-first market).
 */
export const patientsTable = pgTable("patients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  // Expo push token for the patient's most recent device (null = push not enabled)
  expoPushToken: text("expo_push_token"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Patient = typeof patientsTable.$inferSelect;

export const patientRefreshTokensTable = pgTable("patient_refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patientsTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PatientRefreshToken = typeof patientRefreshTokensTable.$inferSelect;

/**
 * Ownership + single-use ledger for prescription image uploads.
 * Order creation must verify the key belongs to the ordering patient and is
 * unconsumed, then consume it in the same transaction — prevents forging a
 * tier-1/2 order with an arbitrary or foreign image key.
 */
export const prescriptionUploadsTable = pgTable("prescription_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patientsTable.id, { onDelete: "cascade" }),
  imageKey: text("image_key").notNull().unique(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PrescriptionUpload = typeof prescriptionUploadsTable.$inferSelect;
