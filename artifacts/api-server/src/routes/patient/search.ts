import { safeRouter } from "../../lib/safeRouter.js";
import { mobileMoneyLines } from "../../lib/mobileMoney.js";
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
import {
  haversineDistanceKm,
  isLatitude,
  isLongitude,
} from "../../lib/geo.js";

const router = safeRouter();
const DISTRICTS = [
  "bo", "bombali", "bonthe", "falaba", "freetown", "kailahun", "kambia",
  "kenema", "koinadugu", "kono", "moyamba", "port loko", "karene",
  "pujehun", "tonkolili", "western area",
];

function coarseDistrict(address: string | null | undefined): string {
  const normalized = address
    ?.toLocaleLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Unknown";
  const district = DISTRICTS.find((item) => normalized.includes(item));
  return district ? district.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unknown";
}

function queryCoordinate(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
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
  const pharmacyId =
    typeof req.query.pharmacyId === "string" ? req.query.pharmacyId : "";
  // patientLatitude/patientLongitude are the documented names; lat/lng were
  // what this route actually read, so the two clients disagreed and the Expo
  // app's coordinates were silently ignored, leaving its results unsorted by
  // distance. Both are accepted so neither client breaks.
  const patientLatitude = queryCoordinate(
    req.query.patientLatitude ?? req.query.lat,
  );
  const patientLongitude = queryCoordinate(
    req.query.patientLongitude ?? req.query.lng,
  );
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
  if (
    (patientLatitude === null) !== (patientLongitude === null) ||
    (patientLatitude !== null &&
      patientLongitude !== null &&
      (!isLatitude(patientLatitude) || !isLongitude(patientLongitude)))
  ) {
    res.status(400).json({
      error:
        "lat and lng must be supplied together and be valid coordinates",
    });
    return;
  }
  if (
    pharmacyId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      pharmacyId,
    )
  ) {
    res.status(400).json({ error: "Invalid pharmacyId" });
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
  if (pharmacyId) filters.push(eq(pharmaciesTable.id, pharmacyId));

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
      orangeMoneyNumber: pharmaciesTable.orangeMoneyNumber,
      afriMoneyNumber: pharmaciesTable.afriMoneyNumber,
      mobileMoneyNumber: pharmaciesTable.mobileMoneyNumber,
      mobileMoneyProvider: pharmaciesTable.mobileMoneyProvider,
      mobileMoneyAccountName: pharmaciesTable.mobileMoneyAccountName,
      pharmacyLatitude: pharmaciesTable.latitude,
      pharmacyLongitude: pharmaciesTable.longitude,
      pharmacyOnline: pharmaciesTable.isActive,
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
    const paymentLines = mobileMoneyLines(r);
    entry.offers.push({
      inventoryId: r.inventoryId,
      pharmacyId: r.pharmacyId,
      pharmacyName: r.pharmacyName,
      pharmacyAddress: r.pharmacyAddress,
      pharmacyPhone: r.pharmacyPhone,
      mobileMoneyLines: paymentLines,
      // Kept for clients that predate the two-line split (the Expo app), and
      // now carrying a display-ready provider name rather than a raw enum.
      mobileMoneyNumber: paymentLines[0]?.number ?? null,
      mobileMoneyProvider: paymentLines[0]?.provider ?? null,
      mobileMoneyAccountName: r.mobileMoneyAccountName,
      online: r.pharmacyOnline,
      estimatedDistanceKm:
        patientLatitude !== null &&
        patientLongitude !== null &&
        r.pharmacyLatitude !== null &&
        r.pharmacyLongitude !== null &&
        isLatitude(Number(r.pharmacyLatitude)) &&
        isLongitude(Number(r.pharmacyLongitude))
          ? haversineDistanceKm(
              patientLatitude,
              patientLongitude,
              Number(r.pharmacyLatitude),
              Number(r.pharmacyLongitude),
            )
          : null,
      brand: r.brand,
      manufacturer: r.manufacturer,
      priceLeones: Number(r.priceLeones),
      unitOfSale: r.unitOfSale,
      inStock: r.stockQuantity > 0,
      stockQuantity: r.stockQuantity,
      availableForDelivery: r.availableForDelivery && r.tier !== "1",
      availableForCollection: r.availableForCollection,
    });
  }

  const results = [...byDrug.values()].map((d) => ({
    ...d,
    offers: d.offers.sort((a: any, b: any) => a.priceLeones - b.priceLeones),
  }));

  // This handler is called only for a submitted search; filters and pagination
  // use the returned result set client-side and do not write additional events.
  const [patient] = await db
    .select({ address: patientsTable.address })
    .from(patientsTable)
    .where(eq(patientsTable.id, req.pharmacy!.sub))
    .limit(1);
  // Category/subcategory-only requests are filter changes, not a drug-search
  // submission. This prevents page/filter activity from inflating search KPIs.
  if (q) {
    await db.insert(searchEventsTable).values({
      normalizedQuery: q.toLocaleLowerCase(),
      patientId: req.pharmacy!.sub,
      pharmacyId: pharmacyId || null,
      primaryCategory: category || null,
      subcategory: subcategory || null,
      areaDistrict: coarseDistrict(patient?.address),
      resultCount: results.length,
    });
  }
  res.json(results);
});

export default router;
