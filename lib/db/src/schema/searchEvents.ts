import { integer, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";

/**
 * Privacy-safe search telemetry. It deliberately has no patient/account,
 * session, phone, IP address, or result-row data: Data & Insights can only
 * report aggregates from this table.
 */
export const searchEventsTable = pgTable(
  "search_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    normalizedQuery: text("normalized_query"),
    primaryCategory: text("primary_category"),
    subcategory: text("subcategory"),
    /** Coarse district only; never an address, coordinate, or patient ID. */
    areaDistrict: text("area_district").notNull().default("Unknown"),
    resultCount: integer("result_count").notNull(),
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
  ],
);

export type SearchEvent = typeof searchEventsTable.$inferSelect;