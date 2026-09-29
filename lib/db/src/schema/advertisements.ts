import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { hqStaffTable } from "./hqStaff";

/** Patient-facing promotional content; media bytes remain in App Storage. */
export const advertisementsTable = pgTable("advertisements", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  alt: text("alt"),
  caption: text("caption"),
  // Who the promotion is from, shown above it (e.g. a hospital or NGO).
  organisation: text("organisation"),
  // The full article behind "Read more". The title is the short subject.
  body: text("body"),
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

/**
 * Extra pictures for a promotion, after the first one on the advertisement
 * row itself. A promotion with several pictures from one organisation is swiped
 * through sideways; deleting the promotion deletes these with it.
 */
export const advertisementMediaTable = pgTable(
  "advertisement_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    advertisementId: uuid("advertisement_id")
      .notNull()
      .references(() => advertisementsTable.id, { onDelete: "cascade" }),
    objectPath: text("object_path").notNull().unique(),
    contentType: text("content_type").notNull(),
    fileSize: integer("file_size").notNull(),
    mediaKind: text("media_kind").notNull(),
    alt: text("alt"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("advertisement_media_advertisement_idx").on(table.advertisementId)],
);

export type AdvertisementMedia = typeof advertisementMediaTable.$inferSelect;

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