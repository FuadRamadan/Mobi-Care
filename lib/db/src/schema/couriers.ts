import { pgTable, uuid, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { hqStaffTable } from "./hqStaff";

/** Courier fleet — HQ-owned data, not shared with other portals. */
export const couriersTable = pgTable("couriers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  vehicleType: text("vehicle_type").notNull().default("motorbike"), // motorbike | bicycle | car | van
  // The image itself is stored in App Storage; this is a validated object path.
  photoPath: text("photo_path"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Soft deletion preserves courier attribution on historical orders and settlements.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Courier = typeof couriersTable.$inferSelect;

/** A short-lived claim on an App Storage upload made by one HQ staff member. */
export const courierPhotoUploadsTable = pgTable("courier_photo_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  courierId: uuid("courier_id")
    .notNull()
    .references(() => couriersTable.id, { onDelete: "cascade" }),
  requestedByHqStaffId: uuid("requested_by_hq_staff_id")
    .notNull()
    .references(() => hqStaffTable.id, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull().unique(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CourierPhotoUpload = typeof courierPhotoUploadsTable.$inferSelect;
