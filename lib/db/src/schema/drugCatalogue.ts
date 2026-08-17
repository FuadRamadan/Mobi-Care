import { pgTable, uuid, text, boolean, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pharmaciesTable } from "./pharmacies";

/**
 * Drug tier:
 *   1 = Controlled (Tier 1) — collection-only, in-person ID check required, never delivered.
 *       Only pharmacies HQ-authorised for controlled substances can list Tier 1 drugs.
 *   2 = Prescription-required — a licensed pharmacist reviews the uploaded prescription.
 *   3 = OTC (over-the-counter) — no prescription required.
 *
 * NOTE ON OWNERSHIP:
 *   In the full MobiCare platform the drug catalogue is owned by HQ.
 *   This pharmacy phase holds a local copy for development; in production this
 *   should be a read replica of the HQ catalogue or fetched via the HQ service API.
 *   Pharmacies may PROPOSE new drugs; HQ decides tier and approves.
 */
export const drugTierEnum = pgEnum("drug_tier", ["1", "2", "3"]);

export const drugCatalogueTable = pgTable("drug_catalogue", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  genericName: text("generic_name"),
  description: text("description"),
  tier: drugTierEnum("tier").notNull().default("3"),
  unit: text("unit").notNull().default("tablets"), // e.g. tablets, ml, capsules
  // Whether HQ has approved this entry. Pharmacy-proposed drugs start as false.
  isApproved: boolean("is_approved").notNull().default(true),
  // Which pharmacy proposed this drug (null = HQ-seeded)
  proposedByPharmacyId: uuid("proposed_by_pharmacy_id").references(
    () => pharmaciesTable.id,
    { onDelete: "set null" }
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDrugCatalogueSchema = createInsertSchema(drugCatalogueTable).omit({
  id: true,
  isApproved: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDrugCatalogue = z.infer<typeof insertDrugCatalogueSchema>;
export type DrugCatalogue = typeof drugCatalogueTable.$inferSelect;
