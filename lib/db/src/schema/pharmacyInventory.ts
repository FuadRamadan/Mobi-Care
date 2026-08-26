import {
  pgTable,
  uuid,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  varchar,
  text,
  numeric,
  date,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pharmaciesTable } from "./pharmacies";
import {
  drugCatalogueTable,
  drugPrimaryCategoryEnum,
  drugSubcategoryEnum,
} from "./drugCatalogue";

export const inventoryCompletionStatusEnum = pgEnum(
  "inventory_completion_status",
  ["incomplete", "complete"],
);

export const pharmacyInventoryTable = pgTable(
  "pharmacy_inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pharmacyId: uuid("pharmacy_id")
      .notNull()
      .references(() => pharmaciesTable.id, { onDelete: "cascade" }),
    drugId: uuid("drug_id")
      .notNull()
      .references(() => drugCatalogueTable.id, { onDelete: "restrict" }),
    strength: varchar("strength", { length: 50 }),
    form: varchar("form", { length: 50 }),
    unitOfSale: varchar("unit_of_sale", { length: 80 }),
    expiryDate: date("expiry_date", { mode: "string" }),
    brand: varchar("brand", { length: 100 }),
    manufacturer: varchar("manufacturer", { length: 150 }),
    countryOfOrigin: varchar("country_of_origin", { length: 100 }),
    primaryCategory: drugPrimaryCategoryEnum("primary_category"),
    subcategory: drugSubcategoryEnum("subcategory"),
    otherCategoryText: text("other_category_text"),
    requiresHqReview: boolean("requires_hq_review").notNull().default(false),
    completionStatus: inventoryCompletionStatusEnum("completion_status")
      .notNull()
      .default("incomplete"),
    // Exact decimal storage. API responses convert this value to a JSON number.
    priceLeones: numeric("price_leones", { precision: 12, scale: 2 }).notNull(),
    stockQuantity: integer("stock_quantity").notNull().default(0),
    lowStockAlertAt: integer("low_stock_alert_at").notNull().default(10),
    availableForDelivery: boolean("available_for_delivery")
      .notNull()
      .default(true),
    availableForCollection: boolean("available_for_collection")
      .notNull()
      .default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_active_pharmacy_drug_variant")
      .on(
        table.pharmacyId,
        table.drugId,
        table.strength,
        table.form,
        table.unitOfSale,
      )
      .where(sql`${table.isActive} = true`),
  ],
);

export const insertInventorySchema = createInsertSchema(
  pharmacyInventoryTable,
).omit({
  id: true,
  pharmacyId: true, // server-set from token
  createdAt: true,
  updatedAt: true,
});

export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type PharmacyInventory = typeof pharmacyInventoryTable.$inferSelect;
