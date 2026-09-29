import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  drugCatalogueTable,
  pharmacyInventoryTable,
  DRUG_PRIMARY_CATEGORIES,
  DRUG_SUBCATEGORIES,
  isValidDrugCategoryPair,
} from "@workspace/db/schema";

/**
 * The rules every pharmacy listing follows, shared by the one-at-a-time form
 * and the bulk upload so both accept and refuse exactly the same things.
 */

/** The label for an unbranded product. */
export const GENERIC_BRAND = "Generic";

export const DUPLICATE_LISTING_MESSAGE =
  "You already list this exact product (same medicine, strength, form, pack, brand and manufacturer). Edit that listing instead.";

export const primaryCategorySchema = z.enum(
  DRUG_PRIMARY_CATEGORIES as [string, ...string[]],
);
export const subcategorySchema = z.enum(DRUG_SUBCATEGORIES as [string, ...string[]]);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD expiry date");

export const inventoryFields = z.object({
  strength: z.string().trim().min(1).max(50),
  form: z.string().trim().min(1).max(50),
  unitOfSale: z.string().trim().min(1).max(80),
  expiryDate: dateSchema,
  // Blank means an unbranded product, saved as "Generic".
  brand: z.string().trim().max(100).nullable().optional(),
  manufacturer: z.string().trim().min(1, "Enter the manufacturer").max(150),
  countryOfOrigin: z.string().trim().min(1, "Enter the country of origin").max(100),
  primaryCategory: primaryCategorySchema.nullable().optional(),
  subcategory: subcategorySchema.nullable().optional(),
  otherCategoryText: z.string().trim().max(300).nullable().optional(),
  priceLeones: z.number().finite().positive().multipleOf(0.01),
  stockQuantity: z.number().int().min(0),
  lowStockAlertAt: z.number().int().min(0).default(10),
  availableForDelivery: z.boolean().default(true),
  availableForCollection: z.boolean().default(true),
});

export type ListingInput = z.infer<typeof inventoryFields>;

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Trimmed, with blank or any spelling of "generic" saved as "Generic". */
export function normalizeBrand(value: string | null | undefined): string {
  const trimmed = value?.trim().replace(/\s+/g, " ") ?? "";
  if (!trimmed || trimmed.toLowerCase() === GENERIC_BRAND.toLowerCase()) {
    return GENERIC_BRAND;
  }
  return trimmed;
}

/**
 * What makes two listings the same product, compared as the database index
 * compares them: ignoring case, with a missing manufacturer counting as blank.
 */
export function productKey(listing: {
  drugId: string;
  strength: string;
  form: string;
  unitOfSale: string;
  brand: string | null | undefined;
  manufacturer: string | null | undefined;
}): string {
  return [
    listing.drugId,
    listing.strength,
    listing.form,
    listing.unitOfSale,
    normalizeBrand(listing.brand).toLowerCase(),
    (listing.manufacturer ?? "").trim().toLowerCase(),
  ].join("|");
}

export function catalogueAllowsValue(
  approvedValues: string[],
  submittedValue: string,
): boolean {
  return approvedValues.length === 0 || approvedValues.includes(submittedValue);
}

export function validateListing(
  data: {
    expiryDate: string;
    strength: string;
    form: string;
    primaryCategory?: string | null;
    subcategory?: string | null;
    otherCategoryText?: string | null;
  },
  drug: typeof drugCatalogueTable.$inferSelect,
): string | null {
  if (data.expiryDate <= todayIso()) {
    return "Expired stock cannot be saved. Enter an expiry date after today.";
  }
  if (!catalogueAllowsValue(drug.commonStrengths, data.strength)) {
    return "Select a strength approved in the MobiCare catalogue.";
  }
  if (!catalogueAllowsValue(drug.commonForms, data.form)) {
    return "Select a form approved in the MobiCare catalogue.";
  }
  const primaryCategory = data.primaryCategory ?? drug.primaryCategory;
  const subcategory = data.subcategory ?? drug.subcategory;
  if ((primaryCategory == null) !== (subcategory == null)) {
    return "Select both a category and subcategory.";
  }
  if (
    primaryCategory &&
    subcategory &&
    !isValidDrugCategoryPair(primaryCategory, subcategory)
  ) {
    return "The selected subcategory does not belong to that category.";
  }
  if (
    (primaryCategory === "other" || subcategory === "other") &&
    !normalizeOptional(data.otherCategoryText)
  ) {
    return "Explain the category when selecting Other.";
  }
  return null;
}

type Reader = Pick<typeof db, "select">;

/** An active listing of the same product at this pharmacy, if there is one. */
export async function findActiveDuplicate(
  listing: {
    pharmacyId: string;
    drugId: string;
    strength: string;
    form: string;
    unitOfSale: string;
    brand: string;
    manufacturer: string | null;
    exceptId?: string;
  },
  reader: Reader = db,
): Promise<{ id: string } | null> {
  const [duplicate] = await reader
    .select({ id: pharmacyInventoryTable.id })
    .from(pharmacyInventoryTable)
    .where(
      and(
        eq(pharmacyInventoryTable.pharmacyId, listing.pharmacyId),
        eq(pharmacyInventoryTable.drugId, listing.drugId),
        eq(pharmacyInventoryTable.strength, listing.strength),
        eq(pharmacyInventoryTable.form, listing.form),
        eq(pharmacyInventoryTable.unitOfSale, listing.unitOfSale),
        sql`lower(${pharmacyInventoryTable.brand}) = lower(${listing.brand})`,
        sql`lower(coalesce(${pharmacyInventoryTable.manufacturer}, '')) = lower(${listing.manufacturer ?? ""})`,
        eq(pharmacyInventoryTable.isActive, true),
        ...(listing.exceptId ? [ne(pharmacyInventoryTable.id, listing.exceptId)] : []),
      ),
    )
    .limit(1);
  return duplicate ?? null;
}
