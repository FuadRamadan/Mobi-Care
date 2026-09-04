import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  pharmacyInventoryTable,
  drugCatalogueTable,
  DRUG_PRIMARY_CATEGORIES,
  DRUG_SUBCATEGORIES,
  isValidDrugCategoryPair,
} from "@workspace/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { pharmaciesTable } from "@workspace/db/schema";

const router = safeRouter();

const primaryCategorySchema = z.enum(
  DRUG_PRIMARY_CATEGORIES as [string, ...string[]],
);
const subcategorySchema = z.enum(DRUG_SUBCATEGORIES as [string, ...string[]]);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD expiry date");

const inventoryFields = z.object({
  strength: z.string().trim().min(1).max(50),
  form: z.string().trim().min(1).max(50),
  unitOfSale: z.string().trim().min(1).max(80),
  expiryDate: dateSchema,
  brand: z.string().trim().max(100).nullable().optional(),
  manufacturer: z.string().trim().max(150).nullable().optional(),
  countryOfOrigin: z.string().trim().max(100).nullable().optional(),
  primaryCategory: primaryCategorySchema.nullable().optional(),
  subcategory: subcategorySchema.nullable().optional(),
  otherCategoryText: z.string().trim().max(300).nullable().optional(),
  priceLeones: z.number().finite().positive().multipleOf(0.01),
  stockQuantity: z.number().int().min(0),
  lowStockAlertAt: z.number().int().min(0).default(10),
  availableForDelivery: z.boolean().default(true),
  availableForCollection: z.boolean().default(true),
});

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function catalogueAllowsValue(
  approvedValues: string[],
  submittedValue: string,
): boolean {
  return approvedValues.length === 0 || approvedValues.includes(submittedValue);
}

function validateListing(
  data: z.infer<typeof inventoryFields>,
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

function serializeInventoryPrice<T extends { priceLeones: string }>(row: T) {
  return { ...row, priceLeones: Number(row.priceLeones) };
}

function serializeInventoryItem(
  row: typeof pharmacyInventoryTable.$inferSelect,
  drug: typeof drugCatalogueTable.$inferSelect,
) {
  return {
    ...serializeInventoryPrice(row),
    drug: {
      name: drug.name,
      genericName: drug.genericName,
      tier: drug.tier,
      unit: drug.unit,
      commonStrengths: drug.commonStrengths,
      commonForms: drug.commonForms,
      primaryCategory: drug.primaryCategory,
      subcategory: drug.subcategory,
    },
  };
}

// ── List this pharmacy's inventory ────────────────────────────────────────────
router.get("/", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;

  const rows = await db
    .select({
      id: pharmacyInventoryTable.id,
      drugId: pharmacyInventoryTable.drugId,
      strength: pharmacyInventoryTable.strength,
      form: pharmacyInventoryTable.form,
      unitOfSale: pharmacyInventoryTable.unitOfSale,
      expiryDate: pharmacyInventoryTable.expiryDate,
      brand: pharmacyInventoryTable.brand,
      manufacturer: pharmacyInventoryTable.manufacturer,
      countryOfOrigin: pharmacyInventoryTable.countryOfOrigin,
      primaryCategory: pharmacyInventoryTable.primaryCategory,
      subcategory: pharmacyInventoryTable.subcategory,
      otherCategoryText: pharmacyInventoryTable.otherCategoryText,
      requiresHqReview: pharmacyInventoryTable.requiresHqReview,
      completionStatus: pharmacyInventoryTable.completionStatus,
      priceLeones: pharmacyInventoryTable.priceLeones,
      stockQuantity: pharmacyInventoryTable.stockQuantity,
      lowStockAlertAt: pharmacyInventoryTable.lowStockAlertAt,
      availableForDelivery: pharmacyInventoryTable.availableForDelivery,
      availableForCollection: pharmacyInventoryTable.availableForCollection,
      isActive: pharmacyInventoryTable.isActive,
      updatedAt: pharmacyInventoryTable.updatedAt,
      drug: {
        name: drugCatalogueTable.name,
        genericName: drugCatalogueTable.genericName,
        tier: drugCatalogueTable.tier,
        unit: drugCatalogueTable.unit,
        commonStrengths: drugCatalogueTable.commonStrengths,
        commonForms: drugCatalogueTable.commonForms,
        primaryCategory: drugCatalogueTable.primaryCategory,
        subcategory: drugCatalogueTable.subcategory,
      },
    })
    .from(pharmacyInventoryTable)
    .innerJoin(
      drugCatalogueTable,
      eq(pharmacyInventoryTable.drugId, drugCatalogueTable.id),
    )
    .where(eq(pharmacyInventoryTable.pharmacyId, pharmacyId));

  res.json(rows.map(serializeInventoryPrice));
});

// ── Add listing ───────────────────────────────────────────────────────────────
router.post("/", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;

  const body = inventoryFields
    .extend({
      drugId: z.string().uuid(),
    })
    .safeParse(req.body);

  if (!body.success) {
    res
      .status(400)
      .json({ error: "Validation failed", issues: body.error.issues });
    return;
  }

  // Check the drug exists and is approved
  const [drug] = await db
    .select()
    .from(drugCatalogueTable)
    .where(eq(drugCatalogueTable.id, body.data.drugId))
    .limit(1);

  if (!drug) {
    res.status(404).json({ error: "Drug not found in catalogue" });
    return;
  }
  if (!drug.isApproved) {
    res
      .status(403)
      .json({ error: "Drug is pending HQ approval and cannot be listed yet" });
    return;
  }
  const validationError = validateListing(body.data, drug);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  // Controlled-substance authorisation check
  if (drug.tier === "1") {
    const [pharm] = await db
      .select({ auth: pharmaciesTable.controlledSubstanceAuthorized })
      .from(pharmaciesTable)
      .where(eq(pharmaciesTable.id, pharmacyId))
      .limit(1);

    if (!pharm?.auth) {
      res.status(403).json({
        error:
          "Only pharmacies authorised by MobiCare HQ can list Tier-1 controlled substances",
      });
      return;
    }
  }

  const primaryCategory = body.data.primaryCategory ?? drug.primaryCategory;
  const subcategory = body.data.subcategory ?? drug.subcategory;
  const requiresHqReview =
    primaryCategory === "other" || subcategory === "other";
  const [inserted] = await db
    .insert(pharmacyInventoryTable)
    .values({
      ...body.data,
      brand: normalizeOptional(body.data.brand),
      manufacturer: normalizeOptional(body.data.manufacturer),
      countryOfOrigin: normalizeOptional(body.data.countryOfOrigin),
      otherCategoryText: normalizeOptional(body.data.otherCategoryText),
      priceLeones: body.data.priceLeones.toFixed(2),
      primaryCategory,
      subcategory,
      requiresHqReview,
      completionStatus: "complete",
      pharmacyId,
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    res.status(409).json({
      error:
        "An active listing with this drug, strength, form, and unit of sale already exists. Edit the existing listing instead.",
      code: "DUPLICATE_ACTIVE_LISTING",
    });
    return;
  }

  await writeAudit({
    actorType: "pharmacy",
    actorId: pharmacyId,
    actorName: req.pharmacy!.name,
    action: "inventory.add",
    entityType: "inventory",
    entityId: inserted.id,
    details: {
      drugId: inserted.drugId,
      strength: inserted.strength,
      form: inserted.form,
      unitOfSale: inserted.unitOfSale,
      priceLeones: inserted.priceLeones,
    },
  });

  res.status(201).json(serializeInventoryItem(inserted, drug));
});

// ── Update listing ────────────────────────────────────────────────────────────
router.patch("/:id", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const id = req.params.id as string;

  const body = inventoryFields
    .partial()
    .extend({
      brand: z.string().trim().max(100).nullable().optional(),
      manufacturer: z.string().trim().max(150).nullable().optional(),
      countryOfOrigin: z.string().trim().max(100).nullable().optional(),
      primaryCategory: primaryCategorySchema.nullable().optional(),
      subcategory: subcategorySchema.nullable().optional(),
      otherCategoryText: z.string().trim().max(300).nullable().optional(),
      stockQuantity: z.number().int().min(0).optional(),
      lowStockAlertAt: z.number().int().min(0).optional(),
      availableForDelivery: z.boolean().optional(),
      availableForCollection: z.boolean().optional(),
      isActive: z.boolean().optional(),
    })
    .safeParse(req.body);

  if (!body.success) {
    res
      .status(400)
      .json({ error: "Validation failed", issues: body.error.issues });
    return;
  }

  const [existing] = await db
    .select({
      inventory: pharmacyInventoryTable,
      drug: drugCatalogueTable,
    })
    .from(pharmacyInventoryTable)
    .innerJoin(
      drugCatalogueTable,
      eq(drugCatalogueTable.id, pharmacyInventoryTable.drugId),
    )
    .where(
      and(
        eq(pharmacyInventoryTable.id, id),
        eq(pharmacyInventoryTable.pharmacyId, pharmacyId),
      ),
    )
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }

  const merged = {
    strength: body.data.strength ?? existing.inventory.strength ?? "",
    form: body.data.form ?? existing.inventory.form ?? "",
    unitOfSale: body.data.unitOfSale ?? existing.inventory.unitOfSale ?? "",
    expiryDate: body.data.expiryDate ?? existing.inventory.expiryDate ?? "",
    brand:
      body.data.brand === undefined
        ? existing.inventory.brand
        : body.data.brand,
    manufacturer:
      body.data.manufacturer === undefined
        ? existing.inventory.manufacturer
        : body.data.manufacturer,
    countryOfOrigin:
      body.data.countryOfOrigin === undefined
        ? existing.inventory.countryOfOrigin
        : body.data.countryOfOrigin,
    primaryCategory:
      body.data.primaryCategory === undefined
        ? existing.inventory.primaryCategory
        : body.data.primaryCategory,
    subcategory:
      body.data.subcategory === undefined
        ? existing.inventory.subcategory
        : body.data.subcategory,
    otherCategoryText:
      body.data.otherCategoryText === undefined
        ? existing.inventory.otherCategoryText
        : body.data.otherCategoryText,
    priceLeones:
      body.data.priceLeones ?? Number(existing.inventory.priceLeones),
    stockQuantity: body.data.stockQuantity ?? existing.inventory.stockQuantity,
    lowStockAlertAt:
      body.data.lowStockAlertAt ?? existing.inventory.lowStockAlertAt,
    availableForDelivery:
      body.data.availableForDelivery ?? existing.inventory.availableForDelivery,
    availableForCollection:
      body.data.availableForCollection ??
      existing.inventory.availableForCollection,
  };

  if (body.data.isActive !== false) {
    const validationError = validateListing(merged, existing.drug);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
  }

  const primaryCategory =
    merged.primaryCategory ?? existing.drug.primaryCategory;
  const subcategory = merged.subcategory ?? existing.drug.subcategory;
  const requiresHqReview =
    primaryCategory === "other" || subcategory === "other";

  if (body.data.isActive !== false) {
    const [duplicate] = await db
      .select({ id: pharmacyInventoryTable.id })
      .from(pharmacyInventoryTable)
      .where(
        and(
          eq(pharmacyInventoryTable.pharmacyId, pharmacyId),
          eq(pharmacyInventoryTable.drugId, existing.inventory.drugId),
          eq(pharmacyInventoryTable.strength, merged.strength),
          eq(pharmacyInventoryTable.form, merged.form),
          eq(pharmacyInventoryTable.unitOfSale, merged.unitOfSale),
          eq(pharmacyInventoryTable.isActive, true),
          ne(pharmacyInventoryTable.id, id),
        ),
      )
      .limit(1);
    if (duplicate) {
      res.status(409).json({
        error:
          "An active listing with this drug, strength, form, and unit of sale already exists. Edit that listing instead.",
        code: "DUPLICATE_ACTIVE_LISTING",
      });
      return;
    }
  }

  const [updated] = await db
    .update(pharmacyInventoryTable)
    .set({
      ...body.data,
      brand: normalizeOptional(merged.brand),
      manufacturer: normalizeOptional(merged.manufacturer),
      countryOfOrigin: normalizeOptional(merged.countryOfOrigin),
      otherCategoryText: normalizeOptional(merged.otherCategoryText),
      priceLeones: merged.priceLeones.toFixed(2),
      primaryCategory,
      subcategory,
      requiresHqReview,
      completionStatus:
        body.data.isActive === false
          ? existing.inventory.completionStatus
          : "complete",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pharmacyInventoryTable.id, id),
        eq(pharmacyInventoryTable.pharmacyId, pharmacyId),
      ),
    )
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }

  await writeAudit({
    actorType: "pharmacy",
    actorId: pharmacyId,
    actorName: req.pharmacy!.name,
    action: "inventory.update",
    entityType: "inventory",
    entityId: id,
    details: { changes: body.data },
  });

  res.json(serializeInventoryItem(updated, existing.drug));
});

// ── Delete listing ────────────────────────────────────────────────────────────
router.delete("/:id", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const id = req.params.id as string;

  const [deleted] = await db
    .delete(pharmacyInventoryTable)
    .where(
      and(
        eq(pharmacyInventoryTable.id, id),
        eq(pharmacyInventoryTable.pharmacyId, pharmacyId),
      ),
    )
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }

  await writeAudit({
    actorType: "pharmacy",
    actorId: pharmacyId,
    actorName: req.pharmacy!.name,
    action: "inventory.delete",
    entityType: "inventory",
    entityId: id,
    details: { drugId: deleted.drugId },
  });

  res.json({ message: "Listing removed" });
});

export default router;
