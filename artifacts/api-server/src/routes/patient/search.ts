import { safeRouter } from "../../lib/safeRouter.js";
import { db } from "@workspace/db";
import {
  drugCatalogueTable,
  pharmacyInventoryTable,
  pharmaciesTable,
  DRUG_CATEGORY_TAXONOMY,
  DRUG_PRIMARY_CATEGORIES,
  DRUG_SUBCATEGORIES,
  searchEventsTable,
  patientsTable,
  isValidDrugCategoryPair,
} from "@workspace/db/schema";
import { and, eq, gt, ilike, or, type SQL } from "drizzle-orm";
import type { AuthRequest } from "../../middlewares/auth.js";

const router = safeRouter();
const DISTRICTS = ["bo", "bombali", "bonthe", "falaba", "freetown", "kailahun", "kambia", "kenema", "koinadugu", "kono", "moyamba", "port loko", "karene", "pujehun", "tonkolili", "western area"];

function parseCoordinate(value: string | null): number | null {
  if (value === null) return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

function haversineDistanceKm(
  patientLat: number | null,
  patientLng: number | null,
  pharmacyLat: number | null,
  pharmacyLng: number | null,
): number | null {
  if (
    patientLat === null ||
    patientLng === null ||
    pharmacyLat === null ||
    pharmacyLng === null ||
    Math.abs(patientLat) > 90 ||
    Math.abs(pharmacyLat) > 90 ||
    Math.abs(patientLng) > 180 ||
    Math.abs(pharmacyLng) > 180
  ) return null;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latDelta = radians(pharmacyLat - patientLat);
  const lngDelta = radians(pharmacyLng - patientLng);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(patientLat)) * Math.cos(radians(pharmacyLat)) *
      Math.sin(lngDelta / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(a)) * 10) / 10;
}

function coarseDistrict(address: string | null | undefined): string {
  const normalized = address?.toLocaleLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "Unknown";
  const district = DISTRICTS.find((item) => normalized.includes(item));
  return district ? district.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unknown";
}

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
router.get("/", async (req: AuthRequest, res) => {
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
      pharmacyPhone: pharmaciesTable.phone,
      pharmacyLocationLat: pharmaciesTable.locationLat,
      pharmacyLocationLng: pharmaciesTable.locationLng,
      mobileMoneyProvider: pharmaciesTable.mobileMoneyProvider,
      mobileMoneyNumber: pharmaciesTable.mobileMoneyNumber,
      mobileMoneyAccountName: pharmaciesTable.mobileMoneyAccountName,
      isOnline: pharmaciesTable.isOnline,
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
    .where(and(...filters));

  const [patient] = await db
    .select({
      address: patientsTable.address,
      locationLat: patientsTable.locationLat,
      locationLng: patientsTable.locationLng,
    })
    .from(patientsTable)
    .where(eq(patientsTable.id, req.pharmacy!.sub))
    .limit(1);
  const patientLat = parseCoordinate(patient?.locationLat ?? null);
  const patientLng = parseCoordinate(patient?.locationLng ?? null);

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
      pharmacyPhone: r.pharmacyPhone,
      mobileMoneyProvider: r.mobileMoneyProvider,
      mobileMoneyNumber: r.mobileMoneyNumber,
      mobileMoneyAccountName: r.mobileMoneyAccountName,
      isOnline: r.isOnline,
      distanceKm: haversineDistanceKm(
        patientLat,
        patientLng,
        parseCoordinate(r.pharmacyLocationLat),
        parseCoordinate(r.pharmacyLocationLng),
      ),
      brand: r.brand,
      manufacturer: r.manufacturer,
      priceLeones: Number(r.priceLeones),
      stockQuantity: r.stockQuantity,
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

  // Analytics is intentionally anonymous: only the normalized search and
  // aggregate-safe result count are retained, never patient/session/IP data.
  await db.insert(searchEventsTable).values({
    normalizedQuery: q ? q.toLocaleLowerCase() : null,
    primaryCategory: category || null,
    subcategory: subcategory || null,
    areaDistrict: coarseDistrict(patient?.address),
    resultCount: results.length,
  });
  res.json(results);
});

export default router;
