import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

/** Courier fleet — HQ-owned data, not shared with other portals. */
export const couriersTable = pgTable("couriers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  vehicleType: text("vehicle_type").notNull().default("motorbike"), // motorbike | bicycle | car | van
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Courier = typeof couriersTable.$inferSelect;
