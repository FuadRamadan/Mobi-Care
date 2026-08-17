import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pharmaciesTable = pgTable("pharmacies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  phone: text("phone").unique(),
  address: text("address"),
  locationLat: text("location_lat"),
  locationLng: text("location_lng"),
  isActive: boolean("is_active").notNull().default(true),
  // Controlled-substance authorisation issued by HQ
  controlledSubstanceAuthorized: boolean("controlled_substance_authorized").notNull().default(false),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
