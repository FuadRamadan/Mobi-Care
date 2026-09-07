/**
 * Seed a local database with enough data to exercise every interface.
 *
 * An empty MobiCare shows empty screens: no pharmacies to search, no stock to
 * order, nothing for HQ to oversee. This creates one of everything so the
 * patient app, pharmacy portal and HQ dashboard all have something real to
 * show.
 *
 * For local development only. It writes known passwords, so never point it at
 * a database anyone else can reach.
 *
 *   DATABASE_URL=postgresql://... node deploy/local/seed.cjs
 *
 * Safe to re-run: existing rows are left alone and matched by their unique
 * columns, so it tops up rather than duplicating.
 */

import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  drugCatalogueTable,
  hqStaffTable,
  patientsTable,
  pharmaciesTable,
  pharmacyInventoryTable,
} from "@workspace/db";

/** Deliberately obvious, and printed at the end. Local use only. */
export const CREDENTIALS = {
  hq: { username: "hqadmin", password: "HqAdmin#2026" },
  pharmacy: { username: "citypharmacy", password: "Pharmacy#2026" },
  patient: { phone: "+23276000001", password: "Patient#2026" },
};

const hash = (value: string): string => bcrypt.hashSync(value, 10);

/**
 * Medicines across all three tiers, so the tier rules are visible in the UI.
 *
 * The tiers run from most to least restricted, matching the application:
 *   1 = controlled  — prescription, collection only, ID checked in person,
 *                     and only from a pharmacy authorised for controlled stock
 *   2 = prescription — a pharmacist reviews the order
 *   3 = over the counter
 */
const DRUGS = [
  {
    name: "Paracetamol",
    genericName: "Paracetamol",
    description: "Pain and fever relief.",
    tier: "3" as const,
    unit: "tablets",
    commonStrengths: ["500mg", "1000mg"],
    commonForms: ["tablet", "syrup"],
    primaryCategory: "pain_inflammation" as const,
    subcategory: "analgesics_antipyretics" as const,
    price: "15.00",
    stock: 240,
  },
  {
    name: "Oral Rehydration Salts",
    genericName: "ORS",
    description: "Replaces fluids and salts lost through dehydration.",
    tier: "3" as const,
    unit: "sachets",
    commonStrengths: ["20.5g"],
    commonForms: ["sachet"],
    primaryCategory: "gastrointestinal_nutrition" as const,
    subcategory: "antidiarrheals_ors" as const,
    price: "8.50",
    stock: 180,
  },
  {
    name: "Amoxicillin",
    genericName: "Amoxicillin",
    description: "Antibiotic. A pharmacist reviews every order.",
    tier: "2" as const,
    unit: "capsules",
    commonStrengths: ["250mg", "500mg"],
    commonForms: ["capsule", "suspension"],
    primaryCategory: "anti_infectives" as const,
    subcategory: "antibiotics" as const,
    price: "45.00",
    stock: 90,
  },
  {
    name: "Artemether/Lumefantrine",
    genericName: "Artemether/Lumefantrine",
    description: "Antimalarial. A pharmacist reviews every order.",
    tier: "2" as const,
    unit: "tablets",
    commonStrengths: ["20mg/120mg"],
    commonForms: ["tablet"],
    primaryCategory: "anti_infectives" as const,
    subcategory: "antimalarials" as const,
    price: "72.00",
    stock: 60,
  },
  {
    name: "Amlodipine",
    genericName: "Amlodipine",
    description: "Lowers blood pressure.",
    tier: "2" as const,
    unit: "tablets",
    commonStrengths: ["5mg", "10mg"],
    commonForms: ["tablet"],
    primaryCategory: "cardiovascular" as const,
    subcategory: "antihypertensives" as const,
    price: "38.00",
    stock: 120,
  },
  {
    name: "Diazepam",
    genericName: "Diazepam",
    description: "Controlled medicine. Collection only, with ID checked in person.",
    tier: "1" as const,
    unit: "tablets",
    commonStrengths: ["5mg"],
    commonForms: ["tablet"],
    primaryCategory: "psychiatric_mental_health" as const,
    subcategory: "controlled_sedatives" as const,
    price: "95.00",
    stock: 25,
    // HQ requires a per-order cap on controlled medicines.
    maxUnitsPerOrder: 10,
  },
];

/** Insert a row only if one is not already there, and return the id either way. */
async function ensure<T extends { id: string }>(
  find: () => Promise<T | undefined>,
  create: () => Promise<T>,
  label: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await find();
  if (existing) {
    console.log(`  exists   ${label}`);
    return { id: existing.id, created: false };
  }
  const row = await create();
  console.log(`  created  ${label}`);
  return { id: row.id, created: true };
}

async function main(): Promise<void> {
  console.log("Seeding local demo data\n");

  // ── HQ administrator ───────────────────────────────────────────────────────
  await ensure(
    async () =>
      (
        await db.select().from(hqStaffTable)
          .where(eq(hqStaffTable.username, CREDENTIALS.hq.username)).limit(1)
      )[0],
    async () =>
      (
        await db.insert(hqStaffTable).values({
          name: "Fuad Ramadan",
          username: CREDENTIALS.hq.username,
          passwordHash: hash(CREDENTIALS.hq.password),
          // Full permissions, so every HQ screen is reachable.
          canManageIntegrations: true,
          canManageSettlements: true,
          canViewDataInsights: true,
        }).returning()
      )[0]!,
    `HQ staff "${CREDENTIALS.hq.username}"`,
  );

  // ── Partner pharmacy ───────────────────────────────────────────────────────
  const pharmacy = await ensure(
    async () =>
      (
        await db.select().from(pharmaciesTable)
          .where(eq(pharmaciesTable.username, CREDENTIALS.pharmacy.username)).limit(1)
      )[0],
    async () =>
      (
        await db.insert(pharmaciesTable).values({
          name: "City Pharmacy, Lumley",
          username: CREDENTIALS.pharmacy.username,
          phone: "+23276111222",
          address: "84 Sixth Road, Malama Lumley, Freetown",
          passwordHash: hash(CREDENTIALS.pharmacy.password),
          // Seeded ready to use: no forced password change on first login.
          mustChangePassword: false,
          controlledSubstanceAuthorized: true,
          email: "hello@citypharmacy.sl",
          // Both lines, so checkout and the search results show the two-wallet
          // case rather than only the simple one.
          orangeMoneyNumber: "+23276111222",
          afriMoneyNumber: "+23288444555",
          mobileMoneyAccountName: "City Pharmacy Lumley",
          locationLat: "8.4550",
          locationLng: "-13.2760",
        }).returning()
      )[0]!,
    `pharmacy "${CREDENTIALS.pharmacy.username}"`,
  );

  // ── Patient ────────────────────────────────────────────────────────────────
  await ensure(
    async () =>
      (
        await db.select().from(patientsTable)
          .where(eq(patientsTable.phone, CREDENTIALS.patient.phone)).limit(1)
      )[0],
    async () =>
      (
        await db.insert(patientsTable).values({
          name: "Aminata Kamara",
          phone: CREDENTIALS.patient.phone,
          passwordHash: hash(CREDENTIALS.patient.password),
          age: 32,
          dateOfBirth: "1993-04-12",
          address: "12 Wilkinson Road, Freetown",
          nationality: "Sierra Leonean",
          // A complete profile: without an email the app opens a "complete your
          // registration" prompt over the home screen on every sign-in.
          email: "aminata.kamara@example.sl",
        }).returning()
      )[0]!,
    `patient ${CREDENTIALS.patient.phone}`,
  );

  // ── Catalogue and stock ────────────────────────────────────────────────────
  for (const drug of DRUGS) {
    const catalogue = await ensure(
      async () =>
        (
          await db.select().from(drugCatalogueTable)
            .where(eq(drugCatalogueTable.name, drug.name)).limit(1)
        )[0],
      async () =>
        (
          await db.insert(drugCatalogueTable).values({
            name: drug.name,
            genericName: drug.genericName,
            description: drug.description,
            tier: drug.tier,
            unit: drug.unit,
            commonStrengths: drug.commonStrengths,
            commonForms: drug.commonForms,
            primaryCategory: drug.primaryCategory,
            subcategory: drug.subcategory,
            isApproved: true,
            reviewStatus: "approved",
            ...("maxUnitsPerOrder" in drug
              ? { maxUnitsPerOrder: (drug as { maxUnitsPerOrder: number }).maxUnitsPerOrder }
              : {}),
          }).returning()
        )[0]!,
      `medicine "${drug.name}" (tier ${drug.tier})`,
    );

    const listed = await db.select().from(pharmacyInventoryTable)
      .where(eq(pharmacyInventoryTable.drugId, catalogue.id)).limit(1);

    if (listed.length === 0) {
      await db.insert(pharmacyInventoryTable).values({
        pharmacyId: pharmacy.id,
        drugId: catalogue.id,
        strength: drug.commonStrengths[0]!,
        form: drug.commonForms[0]!,
        unitOfSale: `Pack of 10 ${drug.unit}`,
        // A year out, so nothing shows as expiring during a demo.
        expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000)
          .toISOString().slice(0, 10),
        manufacturer: "Generic Pharma Ltd",
        countryOfOrigin: "India",
        primaryCategory: drug.primaryCategory,
        subcategory: drug.subcategory,
        completionStatus: "complete",
        priceLeones: drug.price,
        stockQuantity: drug.stock,
        // Controlled medicines are collection-only, in person, with ID checked.
        availableForDelivery: drug.tier !== "1",
        availableForCollection: true,
      });
      console.log(`  created  stock for "${drug.name}" (${drug.stock} @ Le ${drug.price})`);
    }
  }

  console.log("\nDone. Sign in with:\n");
  console.log(`  HQ dashboard    /hq                  ${CREDENTIALS.hq.username} / ${CREDENTIALS.hq.password}`);
  console.log(`  Pharmacy portal /pharmacy-portal/    ${CREDENTIALS.pharmacy.username} / ${CREDENTIALS.pharmacy.password}`);
  console.log(`  Patient app     /app                 ${CREDENTIALS.patient.phone} / ${CREDENTIALS.patient.password}`);
  console.log("\nLocal demo passwords. Never use them anywhere reachable.\n");
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end().catch(() => {});
    process.exit(1);
  });

void randomUUID;
