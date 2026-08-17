import { pgTable, uuid, integer, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pharmaciesTable } from "./pharmacies";
import { drugCatalogueTable } from "./drugCatalogue";

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
    // Price stored in Leone cents (integer) to avoid floating-point issues.
    // Display as "Le X" by dividing by 100 or storing as full Leones (both common).
    // We store full Leones as integer (Sierra Leone Leone has no subdivision in practice).
    priceLeones: integer("price_leones").notNull(),
    stockQuantity: integer("stock_quantity").notNull().default(0),
    availableForDelivery: boolean("available_for_delivery").notNull().default(true),
    availableForCollection: boolean("available_for_collection").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("uniq_pharmacy_drug").on(table.pharmacyId, table.drugId)]
);

export const insertInventorySchema = createInsertSchema(pharmacyInventoryTable).omit({
  id: true,
  pharmacyId: true, // server-set from token
  createdAt: true,
  updatedAt: true,
});

export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type PharmacyInventory = typeof pharmacyInventoryTable.$inferSelect;
