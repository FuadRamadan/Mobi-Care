import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { pharmaciesTable } from "./pharmacies";

/**
 * One row per submitted patient search. Patient/session linkage supports
 * recalculation and auditability; no phone, IP address, coordinates or
 * result-row data is stored here.
 */
export const searchEventsTable = pgTable(
  "search_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id"),
    pharmacyId: uuid("pharmacy_id").references(() => pharmaciesTable.id, {
      onDelete: "set null",
    }),
    sessionId: text("session_id"),
    normalizedQuery: text("normalized_query"),
    primaryCategory: text("primary_category"),
    subcategory: text("subcategory"),
    /** Coarse district only; never an address, coordinate, or patient ID. */
    areaDistrict: text("area_district").notNull().default("Unknown"),
    resultCount: integer("result_count").notNull(),
    /** Delivery zone the search came from (name only), if inside one. */
    areaZone: text("area_zone"),
    /** location | delivery_pin | address | unknown: how the area was found. */
    areaSource: text("area_source"),
    /**
     * Set when nothing the patient could get came back:
     * out_of_stock | not_listed | misspelled | not_in_catalogue.
     */
    unavailableReason: text("unavailable_reason"),
    /** The catalogue medicine the search was about (spelling variants grouped). */
    matchedDrugId: uuid("matched_drug_id"),
    matchedDrugName: text("matched_drug_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("search_events_created_at_idx").on(table.createdAt),
    index("search_events_query_created_at_idx").on(
      table.normalizedQuery,
      table.createdAt,
    ),
    index("search_events_area_created_at_idx").on(
      table.areaDistrict,
      table.createdAt,
    ),
    index("search_events_unavailable_created_at_idx")
      .on(table.createdAt)
      .where(sql`unavailable_reason IS NOT NULL`),
  ],
);

export type SearchEvent = typeof searchEventsTable.$inferSelect;