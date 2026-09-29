import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  numeric,
} from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";
import { drugCatalogueTable } from "./drugCatalogue";
import { pharmacyInventoryTable } from "./pharmacyInventory";

export const orderItemsTable = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  drugId: uuid("drug_id")
    .notNull()
    .references(() => drugCatalogueTable.id, { onDelete: "restrict" }),
  // Exact pharmacy listing selected at checkout. Nullable only for legacy rows.
  inventoryId: uuid("inventory_id").references(
    () => pharmacyInventoryTable.id,
    {
      onDelete: "restrict",
    },
  ),
  // Snapshot of drug name at order time (catalogue name can change later)
  drugName: text("drug_name").notNull(),
  // The exact product sold, copied from the listing when the order is placed,
  // so the pharmacy dispenses the brand the patient chose.
  brand: text("brand"),
  manufacturer: text("manufacturer"),
  countryOfOrigin: text("country_of_origin"),
  quantity: integer("quantity").notNull(),
  unitPriceLeones: numeric("unit_price_leones", {
    precision: 12,
    scale: 2,
  }).notNull(),
  baseUnitPriceMinor: integer("base_unit_price_minor").notNull().default(0),
  patientUnitPriceMinor: integer("patient_unit_price_minor")
    .notNull()
    .default(0),
  // Exact patient line total. This captures basis-point rounding remainders
  // that cannot be represented by an integer per-unit price.
  patientLineTotalMinor: integer("patient_line_total_minor")
    .notNull()
    .default(0),
  // If this line item required a prescription
  prescriptionId: uuid("prescription_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type OrderItem = typeof orderItemsTable.$inferSelect;
