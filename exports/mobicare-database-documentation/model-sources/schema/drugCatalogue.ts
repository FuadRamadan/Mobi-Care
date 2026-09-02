import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pharmaciesTable } from "./pharmacies";
import { hqStaffTable } from "./hqStaff";

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

export const DRUG_CATEGORY_TAXONOMY = [
  {
    value: "pain_fever",
    label: "Pain & fever",
    subcategories: [
      { value: "analgesics_antipyretics", label: "Pain and fever relief" },
      { value: "anti_inflammatory", label: "Anti-inflammatory medicines" },
    ],
  },
  {
    value: "infection",
    label: "Infections",
    subcategories: [
      { value: "antibiotics", label: "Antibiotics" },
      {
        value: "antifungal_antiparasitic",
        label: "Antifungal & antiparasitic",
      },
    ],
  },
  {
    value: "malaria",
    label: "Malaria",
    subcategories: [{ value: "antimalarials", label: "Antimalarials" }],
  },
  {
    value: "respiratory_allergy",
    label: "Respiratory & allergy",
    subcategories: [
      { value: "cough_cold", label: "Cough & cold" },
      { value: "allergy", label: "Allergy relief" },
    ],
  },
  {
    value: "digestive",
    label: "Digestive health",
    subcategories: [
      { value: "gastrointestinal", label: "Gastrointestinal medicines" },
      { value: "oral_rehydration", label: "Oral rehydration" },
    ],
  },
  {
    value: "cardiovascular",
    label: "Heart & blood pressure",
    subcategories: [
      { value: "hypertension", label: "Blood pressure" },
      { value: "heart_health", label: "Heart health" },
    ],
  },
  {
    value: "diabetes_endocrine",
    label: "Diabetes & endocrine",
    subcategories: [{ value: "diabetes", label: "Diabetes care" }],
  },
  {
    value: "womens_reproductive",
    label: "Women's & reproductive health",
    subcategories: [
      { value: "reproductive_health", label: "Reproductive health" },
      { value: "maternal_health", label: "Maternal health" },
    ],
  },
  {
    value: "child_health",
    label: "Child health",
    subcategories: [{ value: "pediatric", label: "Paediatric medicines" }],
  },
  {
    value: "mental_neurological",
    label: "Mental & neurological health",
    subcategories: [
      { value: "neurological", label: "Neurological medicines" },
      { value: "mental_health", label: "Mental health medicines" },
    ],
  },
  {
    value: "skin_wound",
    label: "Skin & wound care",
    subcategories: [
      { value: "dermatology", label: "Skin care" },
      { value: "wound_care", label: "Wound care" },
    ],
  },
  {
    value: "eye_ear",
    label: "Eye & ear care",
    subcategories: [
      { value: "eye_care", label: "Eye care" },
      { value: "ear_care", label: "Ear care" },
    ],
  },
  {
    value: "vitamins_nutrition",
    label: "Vitamins & nutrition",
    subcategories: [
      { value: "vitamins_minerals", label: "Vitamins & minerals" },
    ],
  },
  {
    value: "other",
    label: "Other",
    subcategories: [{ value: "other", label: "Other" }],
  },
] as const;

export const DRUG_PRIMARY_CATEGORIES = DRUG_CATEGORY_TAXONOMY.map(
  (category) => category.value,
);
export const DRUG_SUBCATEGORIES = DRUG_CATEGORY_TAXONOMY.flatMap((category) =>
  category.subcategories.map((subcategory) => subcategory.value),
);

export type DrugPrimaryCategory = (typeof DRUG_PRIMARY_CATEGORIES)[number];
export type DrugSubcategory = (typeof DRUG_SUBCATEGORIES)[number];

export const drugPrimaryCategoryEnum = pgEnum(
  "drug_primary_category",
  DRUG_PRIMARY_CATEGORIES as [string, ...string[]],
);
export const drugSubcategoryEnum = pgEnum(
  "drug_subcategory",
  DRUG_SUBCATEGORIES as [string, ...string[]],
);
export const drugReviewStatusEnum = pgEnum("drug_review_status", [
  "pending",
  "approved",
  "rejected",
]);

export function isValidDrugCategoryPair(
  primaryCategory: string,
  subcategory: string,
): boolean {
  return DRUG_CATEGORY_TAXONOMY.some(
    (category) =>
      category.value === primaryCategory &&
      category.subcategories.some(
        (candidate) => candidate.value === subcategory,
      ),
  );
}

export const drugCatalogueTable = pgTable("drug_catalogue", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  genericName: text("generic_name"),
  description: text("description"),
  tier: drugTierEnum("tier").notNull().default("3"),
  unit: text("unit").notNull().default("tablets"), // e.g. tablets, ml, capsules
  commonStrengths: text("common_strengths").array().notNull().default([]),
  commonForms: text("common_forms").array().notNull().default([]),
  primaryCategory: drugPrimaryCategoryEnum("primary_category"),
  subcategory: drugSubcategoryEnum("subcategory"),
  // Whether HQ has approved this entry. Pharmacy-proposed drugs start as false
  // ("held" awaiting a tier assignment from HQ).
  isApproved: boolean("is_approved").notNull().default(true),
  reviewStatus: drugReviewStatusEnum("review_status")
    .notNull()
    .default("approved"),
  rejectionReason: text("rejection_reason"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedByHqStaffId: uuid("reviewed_by_hq_staff_id").references(
    () => hqStaffTable.id,
    { onDelete: "set null" },
  ),
  // Tier 1 (controlled) drugs MUST have a units-per-order cap — enforced
  // server-side in the HQ catalogue routes, not just in the frontend form.
  maxUnitsPerOrder: integer("max_units_per_order"),
  // Which pharmacy proposed this drug (null = HQ-seeded)
  proposedByPharmacyId: uuid("proposed_by_pharmacy_id").references(
    () => pharmaciesTable.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertDrugCatalogueSchema = createInsertSchema(
  drugCatalogueTable,
).omit({
  id: true,
  isApproved: true,
  reviewStatus: true,
  rejectionReason: true,
  reviewedAt: true,
  reviewedByHqStaffId: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDrugCatalogue = z.infer<typeof insertDrugCatalogueSchema>;
export type DrugCatalogue = typeof drugCatalogueTable.$inferSelect;
