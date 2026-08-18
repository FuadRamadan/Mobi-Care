import { Router } from "express";
import { db } from "@workspace/db";
import {
  drugCatalogueTable,
  pharmacyInventoryTable,
  pharmaciesTable,
} from "@workspace/db/schema";
import { and, eq, gt, ilike, or } from "drizzle-orm";

const router = Router();

/**
 * GET /patient/search?q=para
 *
 * Search the approved drug catalogue across every active pharmacy's live
 * inventory. Returns one entry per drug with a list of price offers so the
 * patient can compare pharmacies.
 */
router.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 2) {
    res.status(400).json({ error: "Query 'q' must be at least 2 characters" });
    return;
  }

  const pattern = `%${q}%`;
  const rows = await db
    .select({
      drugId: drugCatalogueTable.id,
      name: drugCatalogueTable.name,
      genericName: drugCatalogueTable.genericName,
      description: drugCatalogueTable.description,
      tier: drugCatalogueTable.tier,
      unit: drugCatalogueTable.unit,
      maxUnitsPerOrder: drugCatalogueTable.maxUnitsPerOrder,
      inventoryId: pharmacyInventoryTable.id,
      brand: pharmacyInventoryTable.brand,
      priceLeones: pharmacyInventoryTable.priceLeones,
      stockQuantity: pharmacyInventoryTable.stockQuantity,
      availableForDelivery: pharmacyInventoryTable.availableForDelivery,
      availableForCollection: pharmacyInventoryTable.availableForCollection,
      pharmacyId: pharmaciesTable.id,
      pharmacyName: pharmaciesTable.name,
      pharmacyAddress: pharmaciesTable.address,
      controlledSubstanceAuthorized: pharmaciesTable.controlledSubstanceAuthorized,
    })
    .from(drugCatalogueTable)
    .innerJoin(
      pharmacyInventoryTable,
      eq(pharmacyInventoryTable.drugId, drugCatalogueTable.id)
    )
    .innerJoin(
      pharmaciesTable,
      eq(pharmaciesTable.id, pharmacyInventoryTable.pharmacyId)
    )
    .where(
      and(
        eq(drugCatalogueTable.isApproved, true),
        or(
          ilike(drugCatalogueTable.name, pattern),
          ilike(drugCatalogueTable.genericName, pattern)
        ),
        eq(pharmacyInventoryTable.isActive, true),
        gt(pharmacyInventoryTable.stockQuantity, 0),
        eq(pharmaciesTable.isActive, true)
      )
    )
    .limit(200);

  // Group offers per drug.
  const byDrug = new Map<string, any>();
  for (const r of rows) {
    // Tier-1 (controlled) drugs may only be offered by authorised pharmacies.
    if (r.tier === "1" && !r.controlledSubstanceAuthorized) continue;

    let entry = byDrug.get(r.drugId);
    if (!entry) {
      entry = {
        drugId: r.drugId,
        name: r.name,
        genericName: r.genericName,
        description: r.description,
        tier: r.tier,
        unit: r.unit,
        maxUnitsPerOrder: r.maxUnitsPerOrder,
        prescriptionRequired: r.tier === "1" || r.tier === "2",
        collectionOnly: r.tier === "1",
        offers: [],
      };
      byDrug.set(r.drugId, entry);
    }
    entry.offers.push({
      inventoryId: r.inventoryId,
      pharmacyId: r.pharmacyId,
      pharmacyName: r.pharmacyName,
      pharmacyAddress: r.pharmacyAddress,
      brand: r.brand,
      priceLeones: r.priceLeones,
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
