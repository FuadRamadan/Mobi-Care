import { pgTable, uuid, numeric, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { hqStaffTable } from "./hqStaff";

/**
 * How deliveries are priced, by distance (migration 0043). Like zone fees, a
 * change is a new row that starts at the next midnight; rows already in force
 * are history and are never edited. See api-server lib/delivery/kmPricing.ts.
 *
 *   fee   = fuel there and back + pickup + service rate × km (rounded up)
 *   rider = all the fuel + rider share % of the rest
 */
export const deliveryPricingTable = pgTable(
  "delivery_pricing",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fuelPricePerLitre: numeric("fuel_price_per_litre", { precision: 12, scale: 2 }).notNull(),
    kmPerLitre: numeric("km_per_litre", { precision: 8, scale: 2 }).notNull(),
    pickupLeones: numeric("pickup_leones", { precision: 12, scale: 2 }).notNull(),
    serviceRatePerKm: numeric("service_rate_per_km", { precision: 12, scale: 2 }).notNull(),
    riderSharePercent: numeric("rider_share_percent", { precision: 5, scale: 2 }).notNull(),
    roundToLeones: numeric("round_to_leones", { precision: 12, scale: 2 }).notNull(),
    minimumFeeLeones: numeric("minimum_fee_leones", { precision: 12, scale: 2 }).notNull(),
    /** Beyond this many km from the pharmacy: collection only. Null = no limit. */
    maxKm: numeric("max_km", { precision: 8, scale: 1 }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    createdByHqStaffId: uuid("created_by_hq_staff_id").references(() => hqStaffTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("delivery_pricing_effective_idx").on(t.effectiveFrom),
    check("delivery_pricing_km_per_litre_positive", sql`${t.kmPerLitre} > 0`),
    check("delivery_pricing_rider_share_range", sql`${t.riderSharePercent} >= 0 AND ${t.riderSharePercent} <= 100`),
  ],
);

export type DeliveryPricingRow = typeof deliveryPricingTable.$inferSelect;
