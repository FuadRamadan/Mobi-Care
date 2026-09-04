import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { hqStaffTable } from "./hqStaff";

/** Patient-facing promotional content; media bytes remain in App Storage. */
export const advertisementsTable = pgTable("advertisements", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  alt: text("alt"),
  caption: text("caption"),
  mediaKind: text("media_kind").notNull(),
  objectPath: text("object_path").notNull().unique(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size").notNull(),
  linkUrl: text("link_url"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdByHqStaffId: uuid("created_by_hq_staff_id")
    .notNull()
    .references(() => hqStaffTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Advertisement = typeof advertisementsTable.$inferSelect;

/** Short-lived upload claims prevent one HQ user from attaching another's media. */
export const advertisementUploadsTable = pgTable("advertisement_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestedByHqStaffId: uuid("requested_by_hq_staff_id")
    .notNull()
    .references(() => hqStaffTable.id, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull().unique(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdvertisementUpload = typeof advertisementUploadsTable.$inferSelect;