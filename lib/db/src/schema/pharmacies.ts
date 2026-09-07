import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pharmaciesTable = pgTable("pharmacies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  phone: text("phone").unique(),
  address: text("address"),
  /** Contact address for HQ correspondence. Not a login — pharmacies sign in with a username. */
  email: text("email"),

  // ── Mobile money ───────────────────────────────────────────────────────────
  // Patients pay the pharmacy directly, so these are the numbers shown at
  // checkout. Two named lines rather than one provider/number pair: a pharmacy
  // commonly holds both an Orange Money and an AfriMoney line, and a patient
  // who has only one wallet needs to see whether the pharmacy takes it.
  orangeMoneyNumber: text("orange_money_number"),
  afriMoneyNumber: text("afri_money_number"),
  /** Registered name on the mobile money account, shared by both lines. */
  mobileMoneyAccountName: text("mobile_money_account_name"),

  // Superseded by the two named lines above and backfilled into them by
  // migration 0024. Kept, not dropped: they are the only record of what a
  // pharmacy's payment details were before the split, and checkout still falls
  // back to them for any row the backfill could not classify.
  mobileMoneyNumber: text("mobile_money_number"),
  mobileMoneyProvider: text("mobile_money_provider"),
  // New explicit coordinate fields. Legacy locationLat/locationLng remain for
  // historical compatibility and are never overwritten by this migration.
  latitude: text("latitude"),
  longitude: text("longitude"),
  locationLat: text("location_lat"),
  locationLng: text("location_lng"),
  isActive: boolean("is_active").notNull().default(true),
  // Controlled-substance authorisation issued by HQ
  controlledSubstanceAuthorized: boolean("controlled_substance_authorized")
    .notNull()
    .default(false),
  // Set when HQ onboards a pharmacy with a one-time temp password; cleared on
  // first password change. While true, pharmacy API access is blocked.
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  passwordHash: text("password_hash").notNull(),
  // Password lifecycle tracking
  passwordLastChangedAt: timestamp("password_last_changed_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
  temporaryPasswordExpiresAt: timestamp("temporary_password_expires_at", {
    withTimezone: true,
  }),
  // Incremented on every credential reset; access tokens with a stale version are rejected
  sessionVersion: integer("session_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertPharmacySchema = createInsertSchema(pharmaciesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectPharmacySchema = createSelectSchema(pharmaciesTable).omit({
  passwordHash: true,
});

export type InsertPharmacy = z.infer<typeof insertPharmacySchema>;
export type Pharmacy = typeof pharmaciesTable.$inferSelect;
export type PharmacyPublic = Omit<Pharmacy, "passwordHash">;
