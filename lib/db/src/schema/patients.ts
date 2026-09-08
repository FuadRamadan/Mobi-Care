import { pgTable, uuid, text, boolean, timestamp, integer, date, index } from "drizzle-orm/pg-core";

/**
 * Patient accounts for the unified-site patient experience.
 * Phone is the primary login identifier (mobile-money-first market).
 */
export const patientsTable = pgTable("patients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  age: integer("age").notNull().default(18),
  dateOfBirth: date("date_of_birth", { mode: "string" }),
  nin: text("nin"),
  address: text("address"),
  email: text("email"),
  nationality: text("nationality"),
  profileImageKey: text("profile_image_key"),
  sessionVersion: integer("session_version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  /**
   * Set when the patient exercised their right to erasure. The row survives,
   * scrubbed of identity, because orders and prescriptions reference it and a
   * pharmacy's dispensing record cannot simply vanish. Nothing signs in again:
   * isActive is false and sessionVersion has moved on.
   */
  erasedAt: timestamp("erased_at", { withTimezone: true }),
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

export const patientPasswordResetCodesTable = pgTable(
  "patient_password_reset_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id").references(() => patientsTable.id, {
      onDelete: "cascade",
    }),
    phoneHash: text("phone_hash").notNull(),
    requesterHash: text("requester_hash").notNull(),
    codeHash: text("code_hash").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("patient_password_reset_phone_created_idx").on(
      table.phoneHash,
      table.createdAt,
    ),
    index("patient_password_reset_requester_created_idx").on(
      table.requesterHash,
      table.createdAt,
    ),
  ],
);

export type PatientPasswordResetCode =
  typeof patientPasswordResetCodesTable.$inferSelect;

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
