import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";
import { drugCatalogueTable } from "./drugCatalogue";

export const orderItemsTable = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  drugId: uuid("drug_id")
    .notNull()
    .references(() => drugCatalogueTable.id, { onDelete: "restrict" }),
  // Snapshot of drug name at order time (catalogue name can change later)
  drugName: text("drug_name").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceLeones: integer("unit_price_leones").notNull(),
  // If this line item required a prescription
  prescriptionId: uuid("prescription_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrderItem = typeof orderItemsTable.$inferSelect;
