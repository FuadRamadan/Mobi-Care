import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  check,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { hqStaffTable } from "./hqStaff";

/**
 * GeoJSON geometry for a zone's outline. Coordinates are [longitude, latitude],
 * as GeoJSON requires — the reverse of how people usually say them. Zones are
 * drawn on a map in HQ, so nobody types these by hand.
 */
export type ZoneBoundary =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

/**
 * An area MobiCare delivers to. The price lives in delivery_zone_fees, not
 * here, so a fee can be scheduled for midnight and every price a zone ever had
 * stays on record.
 *
 * Zones are deactivated, never deleted: orders keep a reference to the zone
 * that priced them.
 */
export const deliveryZonesTable = pgTable("delivery_zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  boundary: jsonb("boundary").$type<ZoneBoundary>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  updatedByHqStaffId: uuid("updated_by_hq_staff_id").references(
    () => hqStaffTable.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DeliveryZone = typeof deliveryZonesTable.$inferSelect;

/**
 * Every fee a zone has had or will have. The fee in force at any moment is the
 * row with the latest effective_from that is not in the future, so a change
 * scheduled for midnight takes effect by itself — no job has to run for it.
 *
 * Rows already in force are history and are never edited. A change that has
 * not taken effect yet may be replaced before it does.
 */
export const deliveryZoneFeesTable = pgTable(
  "delivery_zone_fees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => deliveryZonesTable.id, { onDelete: "restrict" }),
    feeMinor: integer("fee_minor").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    createdByHqStaffId: uuid("created_by_hq_staff_id").references(
      () => hqStaffTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("delivery_zone_fees_zone_effective_uq").on(
      table.zoneId,
      table.effectiveFrom,
    ),
    index("delivery_zone_fees_effective_idx").on(table.effectiveFrom),
    check("delivery_zone_fees_fee_minor_nonnegative", sql`${table.feeMinor} >= 0`),
  ],
);

export type DeliveryZoneFee = typeof deliveryZoneFeesTable.$inferSelect;
