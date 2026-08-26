import { safeRouter } from "../../lib/safeRouter.js";
import { db } from "@workspace/db";
import {
  drugCatalogueTable,
  pharmacyInventoryTable,
  pharmaciesTable,
  DRUG_CATEGORY_TAXONOMY,
  DRUG_PRIMARY_CATEGORIES,
  DRUG_SUBCATEGORIES,
  isValidDrugCategoryPair,
} from "@workspace/db/schema";
import { and, eq, gt, ilike, or, type SQL } from "drizzle-orm";

const router = safeRouter();

router.get("/categories", (_req, res) => {
  res.json(DRUG_CATEGORY_TAXONOMY);
});

/**
 * GET /patient/search?q=para
 *
 * Search the approved drug catalogue across every active pharmacy's live
 * inventory. Returns one entry per drug with a list of price offers so the
 * patient can compare pharmacies.
 */
router.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const category =
    typeof req.query.category === "string" ? req.query.category : "";
  const subcategory =
    typeof req.query.subcategory === "string" ? req.query.subcategory : "";
  if (q.length > 0 && q.length < 2) {
    res
      .status(400)
      .json({ error: "Query 'q' must be at least 2 characters when supplied" });
    return;
  }
  if (!q && !category) {
    res.status(400).json({ error: "Provide a search query or category" });
    return;
  }
  if (category && !DRUG_PRIMARY_CATEGORIES.includes(category as never)) {
    res.status(400).json({ error: "Unknown category" });
    return;
  }
  if (subcategory && !DRUG_SUBCATEGORIES.includes(subcategory as never)) {
    res.status(400).json({ error: "Unknown subcategory" });
    return;
  }
  if (
    category &&
    subcategory &&
    !isValidDrugCategoryPair(category, subcategory)
  ) {
    res
      .status(400)
      .json({ error: "The subcategory does not belong to that category" });
    return;
  }

  const pattern = `%${q}%`;
  const filters: SQL[] = [
    eq(drugCatalogueTable.isApproved, true),
    eq(pharmacyInventoryTable.isActive, true),
    eq(pharmacyInventoryTable.completionStatus, "complete"),
    gt(
      pharmacyInventoryTable.expiryDate,
      new Date().toISOString().slice(0, 10),
    ),
    eq(pharmaciesTable.isActive, true),
  ];
  if (q) {
    filters.push(
      or(
        ilike(drugCatalogueTable.name, pattern),
        ilike(drugCatalogueTable.genericName, pattern),
        ilike(pharmacyInventoryTable.brand, pattern),
      )!,
    );
  }
  if (category) {
    filters.push(eq(pharmacyInventoryTable.primaryCategory, category as never));
  }
  if (subcategory) {
    filters.push(eq(pharmacyInventoryTable.subcategory, subcategory as never));
  }

  const rows = await db
    .select({
      drugId: drugCatalogueTable.id,
      name: drugCatalogueTable.name,
      genericName: drugCatalogueTable.genericName,
      description: drugCatalogueTable.description,
      tier: drugCatalogueTable.tier,
      unit: drugCatalogueTable.unit,
      strength: pharmacyInventoryTable.strength,
      form: pharmacyInventoryTable.form,
      unitOfSale: pharmacyInventoryTable.unitOfSale,
      primaryCategory: pharmacyInventoryTable.primaryCategory,
      subcategory: pharmacyInventoryTable.subcategory,
      maxUnitsPerOrder: drugCatalogueTable.maxUnitsPerOrder,
      inventoryId: pharmacyInventoryTable.id,
      brand: pharmacyInventoryTable.brand,
      manufacturer: pharmacyInventoryTable.manufacturer,
      priceLeones: pharmacyInventoryTable.priceLeones,
      stockQuantity: pharmacyInventoryTable.stockQuantity,
      availableForDelivery: pharmacyInventoryTable.availableForDelivery,
      availableForCollection: pharmacyInventoryTable.availableForCollection,
      pharmacyId: pharmaciesTable.id,
      pharmacyName: pharmaciesTable.name,
      pharmacyAddress: pharmaciesTable.address,
      controlledSubstanceAuthorized:
        pharmaciesTable.controlledSubstanceAuthorized,
    })
    .from(drugCatalogueTable)
    .innerJoin(
      pharmacyInventoryTable,
      eq(pharmacyInventoryTable.drugId, drugCatalogueTable.id),
    )
    .innerJoin(
      pharmaciesTable,
      eq(pharmaciesTable.id, pharmacyInventoryTable.pharmacyId),
    )
    .where(and(...filters))
    .limit(200);

  // Group offers per drug.
  const byDrug = new Map<string, any>();
  for (const r of rows) {
    // Tier-1 (controlled) drugs may only be offered by authorised pharmacies.
    if (r.tier === "1" && !r.controlledSubstanceAuthorized) continue;

    if (!r.strength || !r.form || !r.unitOfSale) continue;
    const listingKey = [r.drugId, r.strength, r.form, r.unitOfSale].join("|");
    let entry = byDrug.get(listingKey);
    if (!entry) {
      entry = {
        listingKey,
        drugId: r.drugId,
        name: r.name,
        genericName: r.genericName,
        description: r.description,
        tier: r.tier,
        unit: r.unit,
        strength: r.strength,
        form: r.form,
        unitOfSale: r.unitOfSale,
        primaryCategory: r.primaryCategory,
        subcategory: r.subcategory,
        maxUnitsPerOrder: r.maxUnitsPerOrder,
        prescriptionRequired: r.tier === "1" || r.tier === "2",
        collectionOnly: r.tier === "1",
        offers: [],
      };
      byDrug.set(listingKey, entry);
    }
    entry.offers.push({
      inventoryId: r.inventoryId,
      pharmacyId: r.pharmacyId,
      pharmacyName: r.pharmacyName,
      pharmacyAddress: r.pharmacyAddress,
      brand: r.brand,
      manufacturer: r.manufacturer,
      priceLeones: Number(r.priceLeones),
      unitOfSale: r.unitOfSale,
      inStock: r.stockQuantity > 0,
      availableForDelivery: r.availableForDelivery && r.tier !== "1",
      availableForCollection: r.availableForCollection,
    });
  }

  const results = [...byDrug.values()].map((d) => ({
    ...d,
    offers: d.offers.sort((a: any, b: any) => a.priceLeones - b.priceLeones),
  }));

  res.json(results);
});

export default router;
