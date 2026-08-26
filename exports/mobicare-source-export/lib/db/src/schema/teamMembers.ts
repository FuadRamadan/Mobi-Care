import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { hqStaffTable } from "./hqStaff";

/**
 * People shown on MobiCare's public About page. Photo bytes live in App
 * Storage; this table only stores the object path and presentation metadata.
 */
export const teamMembersTable = pgTable("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  photoPath: text("photo_path"),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TeamMember = typeof teamMembersTable.$inferSelect;

/** Short-lived records bind a signed upload URL to one HQ user and one member. */
export const teamPhotoUploadsTable = pgTable("team_photo_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamMemberId: uuid("team_member_id")
    .notNull()
    .references(() => teamMembersTable.id, { onDelete: "cascade" }),
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

export type TeamPhotoUpload = typeof teamPhotoUploadsTable.$inferSelect;