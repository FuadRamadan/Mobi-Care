import crypto from "node:crypto";
import ExcelJS from "exceljs";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  drugCatalogueTable,
  pharmaciesTable,
  pharmacyInventoryTable,
  type DrugCatalogue,
  type PharmacyInventory,
} from "@workspace/db/schema";
import {
  GENERIC_BRAND,
  listingProblem,
  normalizeBrand,
  productKey,
  todayIso,
} from "./listing.js";
import { addVariants, describeVariants, formatForm, listsFromVariants, matchVariant, sameText } from "../catalogue/variants.js";
import {
  addRangeValidation,
  editDistance,
  headerKey,
  parseDate,
  parseMoney,
  parseWholeNumber,
  parseYesNo,
  plainCell,
  SpreadsheetError,
  toFile,
  writeHeader,
  type SheetColumn,
  type UploadedRow,
  type UploadedTable,
  type WorkbookFile,
} from "../spreadsheets/table.js";

/**
 * Bulk inventory upload for one pharmacy: the template, the export of current
 * stock in the same format, and the check-then-apply of an uploaded file.
 *
 * Nothing is saved while checking. Applying checks the file again from
 * scratch (it never trusts an earlier preview) and saves every valid row in
 * one transaction; rows with problems are returned in an error report.
 */

export const INVENTORY_SHEET = "Inventory";

const COLUMNS = {
  listingId: { header: "Listing ID", width: 38, note: "Leave blank for a new listing. Filled in when you export your inventory, so the row updates exactly that listing." },
  medicine: { header: "Medicine", width: 28, required: true, note: "As named in the Catalogue sheet. Unknown medicines go to MobiCare HQ for review." },
  strength: { header: "Strength", width: 12, required: true, note: "e.g. 500mg" },
  form: { header: "Form", width: 14, required: true },
  unitOfSale: { header: "Pack / unit of sale", width: 24, required: true, note: "e.g. Pack of 21 capsules" },
  brand: { header: "Brand", width: 18, note: "Brand name, or Generic for an unbranded product. Blank means Generic." },
  manufacturer: { header: "Manufacturer", width: 22, required: true },
  countryOfOrigin: { header: "Country of origin", width: 18, required: true },
  price: { header: "Price (Le)", width: 12, required: true, note: "Price per pack, e.g. 25.00" },
  stock: { header: "Stock quantity", width: 14, required: true, note: "Number of packs in stock" },
  lowStock: { header: "Low-stock alert at", width: 16, note: "Default 10" },
  expiry: { header: "Expiry date", width: 14, required: true, note: "DD/MM/YYYY" },
  delivery: { header: "Available for delivery", width: 20, note: "Yes or No (default Yes)" },
  collection: { header: "Available for collection", width: 22, note: "Yes or No (default Yes)" },
  action: { header: "Action", width: 10, note: "Leave blank to add or update. Remove takes the listing down." },
  lastUpdated: { header: "Last updated", width: 22, hidden: true },
} satisfies Record<string, SheetColumn>;

type ColumnName = keyof typeof COLUMNS;
const COLUMN_ORDER = Object.keys(COLUMNS) as ColumnName[];

/** Other headers people commonly use for the same columns. */
const ALIASES: Record<ColumnName, string[]> = {
  listingId: ["id"],
  medicine: ["drug", "medicinename", "drugname", "name"],
  strength: [],
  form: [],
  unitOfSale: ["unitofsale", "pack", "packsize", "unit"],
  brand: ["brandname"],
  manufacturer: ["maker"],
  countryOfOrigin: ["country", "origin"],
  price: ["price", "priceleones", "unitprice"],
  stock: ["stock", "quantity", "qty"],
  lowStock: ["lowstock", "lowstockalert"],
  expiry: ["expiry", "expirydate", "expires"],
  delivery: ["delivery"],
  collection: ["collection"],
  action: [],
  lastUpdated: [],
};

const REQUIRED: ColumnName[] = ["medicine", "strength", "form", "unitOfSale", "manufacturer", "countryOfOrigin", "price", "stock", "expiry"];

function cell(row: UploadedRow, column: ColumnName): string {
  for (const key of [headerKey(COLUMNS[column].header), ...ALIASES[column]]) {
    const value = row.cells[key];
    if (value !== undefined) return value;
  }
  return "";
}

function hasColumn(table: UploadedTable, column: ColumnName): boolean {
  const keys = new Set(table.headers.map(headerKey));
  return [headerKey(COLUMNS[column].header), ...ALIASES[column]].some((key) => keys.has(key));
}

// ── Analysis ────────────────────────────────────────────────────────────────

export type RowStatus = "new" | "change" | "duplicate" | "unchanged" | "remove" | "review" | "error";

export interface RowChange {
  field: string;
  from: string;
  to: string;
}

export interface AnalysedRow {
  rowNumber: number;
  status: RowStatus;
  /** What is wrong (errors) or what will happen (review, duplicate). */
  message: string | null;
  warnings: string[];
  /** For changes and duplicates: what saving would change on the listing. */
  changes: RowChange[];
  /** A short description of the product, e.g. "Paracetamol 500mg tablet · Panadol". */
  summary: string;
  listingId: string | null;
}

type ListingValues = {
  strength: string;
  form: string;
  unitOfSale: string;
  expiryDate: string;
  brand: string;
  manufacturer: string;
  countryOfOrigin: string;
  priceLeones: string;
  stockQuantity: number;
  lowStockAlertAt: number;
  availableForDelivery: boolean;
  availableForCollection: boolean;
};

type Plan =
  | { kind: "insert"; drug: DrugCatalogue; values: ListingValues }
  | { kind: "update"; listingId: string; values: ListingValues }
  | { kind: "deactivate"; listingId: string }
  | { kind: "propose"; medicine: string; values: ListingValues }
  | { kind: "none" };

interface RowResult extends AnalysedRow {
  plan: Plan;
  raw: string[];
}

export interface Analysis {
  headers: string[];
  rows: RowResult[];
}

const FIELD_LABELS: Record<keyof ListingValues, string> = {
  strength: "Strength",
  form: "Form",
  unitOfSale: "Pack",
  expiryDate: "Expiry",
  brand: "Brand",
  manufacturer: "Manufacturer",
  countryOfOrigin: "Origin",
  priceLeones: "Price",
  stockQuantity: "Stock",
  lowStockAlertAt: "Low-stock alert",
  availableForDelivery: "Delivery",
  availableForCollection: "Collection",
};

function display(field: keyof ListingValues, value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field === "priceLeones") return `Le ${Number(value).toFixed(2)}`;
  return String(value);
}

function diff(existing: PharmacyInventory, values: ListingValues): RowChange[] {
  const current: ListingValues = {
    strength: existing.strength ?? "",
    form: existing.form ?? "",
    unitOfSale: existing.unitOfSale ?? "",
    expiryDate: existing.expiryDate ?? "",
    brand: normalizeBrand(existing.brand),
    manufacturer: existing.manufacturer ?? "",
    countryOfOrigin: existing.countryOfOrigin ?? "",
    priceLeones: Number(existing.priceLeones).toFixed(2),
    stockQuantity: existing.stockQuantity,
    lowStockAlertAt: existing.lowStockAlertAt,
    availableForDelivery: existing.availableForDelivery,
    availableForCollection: existing.availableForCollection,
  };
  // Names differing only in capitals are the same maker, not a change.
  const caseless = new Set<keyof ListingValues>(["brand", "manufacturer", "countryOfOrigin"]);
  const same = (field: keyof ListingValues) =>
    caseless.has(field)
      ? String(current[field]).toLowerCase() === String(values[field]).toLowerCase()
      : String(current[field]) === String(values[field]);
  return (Object.keys(FIELD_LABELS) as Array<keyof ListingValues>)
    .filter((field) => !same(field))
    .map((field) => ({
      field: FIELD_LABELS[field],
      from: display(field, current[field]),
      to: display(field, values[field]),
    }));
}

/** Keeps the saved spelling of names that differ only in capitals. */
function keepSpelling(existing: PharmacyInventory, values: ListingValues): ListingValues {
  const keep = (saved: string | null, typed: string) =>
    saved && saved.toLowerCase() === typed.toLowerCase() ? saved : typed;
  return {
    ...values,
    brand: keep(normalizeBrand(existing.brand), values.brand),
    manufacturer: keep(existing.manufacturer, values.manufacturer),
    countryOfOrigin: keep(existing.countryOfOrigin, values.countryOfOrigin),
  };
}

function priceJumpWarning(existing: PharmacyInventory, values: ListingValues): string | null {
  const before = Number(existing.priceLeones);
  const after = Number(values.priceLeones);
  if (before > 0 && Math.abs(after - before) / before > 0.5) {
    return `The price changes by more than half (Le ${before.toFixed(2)} → Le ${after.toFixed(2)}). Check it is not a typing mistake.`;
  }
  return null;
}

function daysUntil(isoDate: string): number {
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / 86_400_000);
}

/** Reads one row's listing fields; returns the problems found instead if any. */
function readListing(row: UploadedRow): { values: ListingValues } | { error: string } {
  const problems: string[] = [];
  const text = (column: ColumnName) => cell(row, column);
  for (const column of REQUIRED) {
    if (column !== "medicine" && !text(column)) problems.push(`${COLUMNS[column].header} is missing`);
  }
  const price = parseMoney(text("price"));
  if (text("price") && (price == null || price <= 0)) problems.push("Price must be a number above 0, like 25.00");
  const stock = parseWholeNumber(text("stock"));
  if (text("stock") && stock == null) problems.push("Stock quantity must be a whole number");
  const lowStockText = text("lowStock");
  const lowStock = lowStockText ? parseWholeNumber(lowStockText) : 10;
  if (lowStock == null) problems.push("Low-stock alert must be a whole number");
  const expiry = parseDate(text("expiry"));
  if (text("expiry") && !expiry) problems.push("Expiry date must be a date like 31/12/2027");
  const delivery = parseYesNo(text("delivery"), true);
  const collection = parseYesNo(text("collection"), true);
  if (delivery == null) problems.push("Available for delivery must be Yes or No");
  if (collection == null) problems.push("Available for collection must be Yes or No");
  const lengths: Array<[ColumnName, number]> = [["strength", 50], ["form", 50], ["unitOfSale", 80], ["brand", 100], ["manufacturer", 150], ["countryOfOrigin", 100]];
  for (const [column, max] of lengths) {
    if (text(column).length > max) problems.push(`${COLUMNS[column].header} is longer than ${max} characters`);
  }
  if (problems.length) return { error: problems.join("; ") };
  return {
    values: {
      strength: text("strength"),
      form: text("form"),
      unitOfSale: text("unitOfSale"),
      expiryDate: expiry!,
      brand: normalizeBrand(text("brand")),
      manufacturer: text("manufacturer"),
      countryOfOrigin: text("countryOfOrigin"),
      priceLeones: price!.toFixed(2),
      stockQuantity: stock!,
      lowStockAlertAt: lowStock!,
      availableForDelivery: delivery!,
      availableForCollection: collection!,
    },
  };
}

function describe(medicine: string, values: Partial<ListingValues>): string {
  return [
    [medicine, values.strength, values.form].filter(Boolean).join(" "),
    values.brand && values.brand !== GENERIC_BRAND ? values.brand : values.brand ? "Generic" : null,
  ].filter(Boolean).join(" · ");
}

type Reader = Pick<typeof db, "select">;

export async function analyseInventoryUpload(
  pharmacyId: string,
  table: UploadedTable,
  reader: Reader = db,
): Promise<Analysis> {
  const missing = REQUIRED.filter((column) => !hasColumn(table, column));
  if (missing.length) {
    throw new SpreadsheetError(
      `The file is missing these columns: ${missing.map((column) => COLUMNS[column].header).join(", ")}. Download the template and copy your rows into it.`,
    );
  }

  const [catalogue, listings, [pharmacy]] = await Promise.all([
    reader.select().from(drugCatalogueTable),
    reader.select().from(pharmacyInventoryTable).where(eq(pharmacyInventoryTable.pharmacyId, pharmacyId)),
    reader.select({ controlled: pharmaciesTable.controlledSubstanceAuthorized }).from(pharmaciesTable).where(eq(pharmaciesTable.id, pharmacyId)).limit(1),
  ]);
  // Medicines still waiting for HQ approval are matched too, so a row naming
  // one is attached to it instead of proposing the same medicine again.
  // Approved entries win when two share a name.
  const listable = catalogue
    .filter((drug) => drug.isApproved || drug.reviewStatus === "pending")
    .sort((a, b) => Number(b.isApproved) - Number(a.isApproved));
  const byName = new Map<string, DrugCatalogue>();
  const byGeneric = new Map<string, DrugCatalogue>();
  for (const drug of listable) {
    const name = drug.name.trim().toLowerCase();
    if (!byName.has(name)) byName.set(name, drug);
    const generic = drug.genericName?.trim().toLowerCase();
    if (generic && !byGeneric.has(generic)) byGeneric.set(generic, drug);
  }
  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  const activeByKey = new Map(
    listings
      .filter((listing) => listing.isActive && listing.strength && listing.form && listing.unitOfSale)
      .map((listing) => [
        productKey({
          drugId: listing.drugId,
          strength: listing.strength!,
          form: listing.form!,
          unitOfSale: listing.unitOfSale!,
          brand: listing.brand,
          manufacturer: listing.manufacturer,
        }),
        listing,
      ]),
  );

  const results: RowResult[] = [];
  const seenKeys = new Map<string, RowResult>();

  for (const row of table.rows) {
    const medicine = cell(row, "medicine");
    const listingId = cell(row, "listingId") || null;
    const action = cell(row, "action").toLowerCase();
    const base = { rowNumber: row.rowNumber, warnings: [] as string[], changes: [] as RowChange[], raw: row.raw, listingId };
    const fail = (message: string, summary = medicine || `Row ${row.rowNumber}`): RowResult => ({
      ...base, status: "error", message, summary, plan: { kind: "none" },
    });

    if (action && action !== "remove") {
      results.push(fail(`Action must be blank or Remove (found "${cell(row, "action")}")`));
      continue;
    }
    if (action === "remove") {
      const existing = listingId ? byId.get(listingId) : undefined;
      if (!existing) {
        results.push(fail("To remove a listing, keep its Listing ID from your inventory export"));
      } else {
        const drugName = catalogue.find((drug) => drug.id === existing.drugId)?.name ?? medicine;
        results.push({
          ...base,
          status: existing.isActive ? "remove" : "unchanged",
          message: existing.isActive ? "Will be taken down" : "Already removed",
          summary: describe(drugName, { strength: existing.strength ?? "", form: existing.form ?? "", brand: normalizeBrand(existing.brand) }),
          plan: existing.isActive ? { kind: "deactivate", listingId: existing.id } : { kind: "none" },
        });
      }
      continue;
    }

    if (!medicine) {
      results.push(fail("Medicine is missing"));
      continue;
    }
    const read = readListing(row);
    if ("error" in read) {
      results.push(fail(read.error));
      continue;
    }
    const { values } = read;
    const summary = describe(medicine, values);
    const warnings: string[] = [];
    const days = daysUntil(values.expiryDate);
    if (days > 0 && days <= 30) warnings.push(`Expires in ${days} day${days === 1 ? "" : "s"}`);

    const drug = byName.get(medicine.toLowerCase()) ?? byGeneric.get(medicine.toLowerCase());
    if (!drug) {
      const lower = medicine.toLowerCase();
      const suggestion = listable
        .map((candidate) => ({ candidate, distance: editDistance(lower, candidate.name.toLowerCase()) }))
        .filter(({ distance }) => distance > 0 && distance <= 2)
        .sort((a, b) => a.distance - b.distance)[0]?.candidate;
      if (suggestion) {
        results.push(fail(`"${medicine}" is not in the catalogue. Did you mean ${suggestion.name}?`, summary));
        continue;
      }
      if (listingId) {
        results.push(fail("A listing's medicine cannot be changed. Remove the listing and add the new medicine as a new row", summary));
        continue;
      }
      if (medicine.length < 2) {
        results.push(fail("Medicine name is too short", summary));
        continue;
      }
      const result: RowResult = {
        ...base,
        status: "review",
        message: "Not in the catalogue yet: sent to MobiCare HQ for review. It stays hidden from patients until approved.",
        warnings,
        summary,
        plan: { kind: "propose", medicine, values: { ...values, form: formatForm(values.form) } },
      };
      const key = `proposal|${[medicine, values.strength, values.form, values.unitOfSale, values.brand, values.manufacturer].join("|").toLowerCase()}`;
      const earlier = seenKeys.get(key);
      if (earlier) {
        const message = `Rows ${earlier.rowNumber} and ${row.rowNumber} are the same product. Keep one of them.`;
        Object.assign(earlier, { status: "error", message, plan: { kind: "none" } });
        results.push(fail(message, summary));
        continue;
      }
      seenKeys.set(key, result);
      results.push(result);
      continue;
    }

    const problem = listingProblem({ ...values, primaryCategory: null, subcategory: null }, drug);
    if (problem) {
      results.push(fail(problem, summary));
      continue;
    }
    // A pharmacy's own request is still being decided by HQ, so a strength or
    // form it does not list yet is added to the request for HQ to review.
    // Everything else must match what HQ approved (or is about to approve).
    const match = matchVariant(drug, values.strength, values.form);
    const isRequest = !drug.isApproved && drug.proposedByPharmacyId != null;
    if ("error" in match && !isRequest) {
      results.push(fail(match.error, summary));
      continue;
    }
    const extendsRequest = "error" in match;
    values.strength = "error" in match
      ? drug.commonStrengths.find((value) => sameText(value, values.strength)) ?? values.strength
      : match.strength;
    values.form = "error" in match
      ? drug.commonForms.find((value) => sameText(value, values.form)) ?? formatForm(values.form)
      : match.form;
    if (drug.tier === "1" && !pharmacy?.controlled) {
      results.push(fail("Only pharmacies authorised by MobiCare HQ can list tier 1 (controlled) medicines", summary));
      continue;
    }

    const key = productKey({ drugId: drug.id, ...values });
    const earlier = seenKeys.get(key);
    if (earlier) {
      const message = `Rows ${earlier.rowNumber} and ${row.rowNumber} are the same product. Keep one of them.`;
      Object.assign(earlier, { status: "error", message, plan: { kind: "none" } });
      results.push(fail(message, summary));
      continue;
    }

    let result: RowResult;
    if (listingId) {
      const existing = byId.get(listingId);
      if (!existing) {
        result = fail("This Listing ID is not in your inventory. Clear it to add the row as a new listing", summary);
      } else if (existing.drugId !== drug.id) {
        result = fail("A listing's medicine cannot be changed. Remove the listing and add the new medicine as a new row", summary);
      } else if (!existing.isActive) {
        result = fail("This listing was removed. Clear the Listing ID to add it again as a new listing", summary);
      } else {
        const clash = activeByKey.get(key);
        if (clash && clash.id !== existing.id) {
          result = fail("Another of your listings is already this exact product (same brand and manufacturer)", summary);
        } else {
          const changes = diff(existing, values);
          const lastUpdated = Date.parse(cell(row, "lastUpdated"));
          if (Number.isFinite(lastUpdated) && existing.updatedAt.getTime() > lastUpdated + 1000) {
            warnings.push("This listing changed in MobiCare after your file was downloaded. Saving overwrites those changes");
          }
          const jump = priceJumpWarning(existing, values);
          if (jump) warnings.push(jump);
          result = {
            ...base,
            status: changes.length ? "change" : "unchanged",
            message: null,
            warnings,
            changes,
            summary,
            plan: changes.length ? { kind: "update", listingId: existing.id, values: keepSpelling(existing, values) } : { kind: "none" },
          };
        }
      }
    } else {
      const existing = activeByKey.get(key);
      if (existing) {
        const changes = diff(existing, values);
        const jump = priceJumpWarning(existing, values);
        if (jump) warnings.push(jump);
        result = {
          ...base,
          status: changes.length ? "duplicate" : "unchanged",
          message: changes.length ? "You already list this exact product. Choose Override to update it, or Skip" : "Already listed with the same details",
          warnings,
          changes,
          summary,
          listingId: existing.id,
          plan: changes.length ? { kind: "update", listingId: existing.id, values: keepSpelling(existing, values) } : { kind: "none" },
        };
      } else if (!drug.isApproved) {
        result = {
          ...base, status: "review", warnings, summary,
          message: extendsRequest
            ? `${drug.name} is waiting for MobiCare HQ approval; this strength and form are added to the request. Saved now, shown to patients once approved.`
            : `${drug.name} is waiting for MobiCare HQ approval. Saved now, shown to patients once approved.`,
          plan: { kind: "insert", drug, values },
        };
      } else {
        result = { ...base, status: "new", message: null, warnings, summary, plan: { kind: "insert", drug, values } };
      }
    }
    seenKeys.set(key, result);
    results.push(result);
  }

  return { headers: table.headers, rows: results };
}

export function summarise(rows: AnalysedRow[]) {
  const count = (status: RowStatus) => rows.filter((row) => row.status === status).length;
  return {
    total: rows.length,
    new: count("new"),
    change: count("change"),
    duplicate: count("duplicate"),
    unchanged: count("unchanged"),
    remove: count("remove"),
    review: count("review"),
    error: count("error"),
    warnings: rows.filter((row) => row.warnings.length > 0).length,
  };
}

/** The analysis without internal plans, for sending to the browser. */
export function publicRows(analysis: Analysis): AnalysedRow[] {
  return analysis.rows.map(({ plan: _plan, raw: _raw, ...row }) => row);
}

// ── Applying ────────────────────────────────────────────────────────────────

export type DuplicateDecision = "override" | "skip";

export interface ApplyResult {
  added: number;
  updated: number;
  removed: number;
  sentForReview: number;
  skipped: number;
  unchanged: number;
  failed: number;
  errorReport: WorkbookFile | null;
}

export class DecisionsMissing extends Error {
  constructor(public readonly rows: number[]) {
    super(`Choose Override or Skip for the duplicate rows: ${rows.join(", ")}`);
  }
}

export async function applyInventoryUpload(
  pharmacyId: string,
  analysis: Analysis,
  decisions: Record<string, DuplicateDecision>,
  duplicateDefault: DuplicateDecision | null,
  fileName: string,
): Promise<ApplyResult> {
  const undecided = analysis.rows
    .filter((row) => row.status === "duplicate" && !decisions[String(row.rowNumber)] && !duplicateDefault)
    .map((row) => row.rowNumber);
  if (undecided.length) throw new DecisionsMissing(undecided);

  const result: ApplyResult = { added: 0, updated: 0, removed: 0, sentForReview: 0, skipped: 0, unchanged: 0, failed: 0, errorReport: null };
  const failures: Array<{ raw: string[]; problem: string }> = [];

  await db.transaction(async (tx) => {
    // The strength and form combinations of each request (a medicine waiting
    // for HQ approval) as this upload adds to it, and requests it creates.
    type Lists = ReturnType<typeof listsFromVariants>;
    const requestLists = new Map<string, Lists>();
    const newRequests = new Map<string, string>();
    const addToRequest = async (drugId: string, current: Lists, variant: { strength: string; form: string }) => {
      const lists = addVariants(current, [variant]);
      requestLists.set(drugId, lists);
      const same = (list: Lists) => JSON.stringify([list.commonStrengths, list.commonForms, list.variants]);
      if (same(lists) === same(current)) return;
      await tx.update(drugCatalogueTable).set({ ...lists, updatedAt: new Date() }).where(eq(drugCatalogueTable.id, drugId));
    };

    for (const row of analysis.rows) {
      if (row.status === "error") {
        failures.push({ raw: row.raw, problem: row.message ?? "Invalid row" });
        continue;
      }
      if (row.status === "unchanged") {
        result.unchanged++;
        continue;
      }
      if (row.status === "duplicate") {
        const decision = decisions[String(row.rowNumber)] ?? duplicateDefault;
        if (decision !== "override") {
          result.skipped++;
          continue;
        }
      }
      const plan = row.plan;
      if (plan.kind === "insert") {
        const held = !plan.drug.isApproved;
        if (held && plan.drug.proposedByPharmacyId) {
          await addToRequest(plan.drug.id, requestLists.get(plan.drug.id) ?? plan.drug, { strength: plan.values.strength, form: plan.values.form });
        }
        const [inserted] = await tx.insert(pharmacyInventoryTable).values({
          pharmacyId,
          drugId: plan.drug.id,
          ...plan.values,
          primaryCategory: plan.drug.primaryCategory,
          subcategory: plan.drug.subcategory,
          // A medicine still waiting for HQ approval keeps its listings hidden
          // until approval; approving it clears this flag.
          requiresHqReview: held || plan.drug.primaryCategory === "other" || plan.drug.subcategory === "other",
          completionStatus: "complete",
        }).onConflictDoNothing().returning({ id: pharmacyInventoryTable.id });
        if (!inserted) failures.push({ raw: row.raw, problem: "This exact product was listed while you were uploading. Upload again to update it" });
        else if (held) result.sentForReview++;
        else result.added++;
      } else if (plan.kind === "update") {
        await tx.update(pharmacyInventoryTable)
          .set({ ...plan.values, completionStatus: "complete", updatedAt: new Date() })
          .where(and(eq(pharmacyInventoryTable.id, plan.listingId), eq(pharmacyInventoryTable.pharmacyId, pharmacyId)));
        result.updated++;
      } else if (plan.kind === "deactivate") {
        await tx.update(pharmacyInventoryTable)
          .set({ isActive: false, updatedAt: new Date() })
          .where(and(eq(pharmacyInventoryTable.id, plan.listingId), eq(pharmacyInventoryTable.pharmacyId, pharmacyId)));
        result.removed++;
      } else if (plan.kind === "propose") {
        const nameKey = plan.medicine.toLowerCase();
        const variant = { strength: plan.values.strength, form: plan.values.form };
        let drugId = newRequests.get(nameKey);
        if (drugId) {
          await addToRequest(drugId, requestLists.get(drugId)!, variant);
        } else {
          const lists = listsFromVariants([variant]);
          const [proposal] = await tx.insert(drugCatalogueTable).values({
            name: plan.medicine,
            genericName: plan.medicine,
            description: "Submitted in a bulk inventory upload; HQ to confirm the details and tier.",
            unit: "units",
            ...lists,
            // HQ sets the category and tier when it reviews the request.
            tier: "3",
            isApproved: false,
            reviewStatus: "pending",
            proposedByPharmacyId: pharmacyId,
          }).returning({ id: drugCatalogueTable.id });
          drugId = proposal!.id;
          newRequests.set(nameKey, drugId);
          requestLists.set(drugId, lists);
        }
        // Saved now, shown to patients once HQ approves the medicine: search
        // and ordering only ever use approved catalogue entries.
        const [inserted] = await tx.insert(pharmacyInventoryTable).values({
          pharmacyId,
          drugId,
          ...plan.values,
          requiresHqReview: true,
          completionStatus: "complete",
        }).onConflictDoNothing().returning({ id: pharmacyInventoryTable.id });
        if (inserted) result.sentForReview++;
        else failures.push({ raw: row.raw, problem: "This product is already waiting for HQ review" });
      }
    }
  });

  result.failed = failures.length;
  if (failures.length) result.errorReport = await errorReport(analysis.headers, failures, fileName);
  return result;
}

async function errorReport(headers: string[], failures: Array<{ raw: string[]; problem: string }>, fileName: string): Promise<WorkbookFile> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(INVENTORY_SHEET);
  writeHeader(sheet, [...headers.map((header) => ({ header, width: 18 })), { header: "Problem", width: 60, required: true }]);
  for (const failure of failures) sheet.addRow([...failure.raw.map(plainCell), failure.problem]);
  const base = fileName.replace(/\.(xlsx|csv)$/i, "");
  return toFile(workbook, `${base} - rows to fix.xlsx`);
}

// ── Template and export ─────────────────────────────────────────────────────

/**
 * The inventory spreadsheet: the template when `listings` is empty, the
 * pharmacy's current stock when it is not. Both upload back unchanged.
 */
export async function inventoryWorkbook(pharmacyId: string | null, fileName: string): Promise<WorkbookFile> {
  const catalogue = (await db.select().from(drugCatalogueTable).where(eq(drugCatalogueTable.isApproved, true)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const listings = pharmacyId
    ? await db.select().from(pharmacyInventoryTable).where(and(eq(pharmacyInventoryTable.pharmacyId, pharmacyId), eq(pharmacyInventoryTable.isActive, true)))
    : [];
  const drugNames = new Map(
    (listings.length
      ? await db.select({ id: drugCatalogueTable.id, name: drugCatalogueTable.name }).from(drugCatalogueTable)
          .where(inArray(drugCatalogueTable.id, [...new Set(listings.map((listing) => listing.drugId))]))
      : []
    ).map((drug) => [drug.id, drug.name]),
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MobiCare";
  const sheet = workbook.addWorksheet(INVENTORY_SHEET);
  const columns = COLUMN_ORDER.map((name) => COLUMNS[name]);
  writeHeader(sheet, columns);

  for (const listing of listings.sort((a, b) => (drugNames.get(a.drugId) ?? "").localeCompare(drugNames.get(b.drugId) ?? ""))) {
    sheet.addRow([
      listing.id,
      drugNames.get(listing.drugId) ?? "",
      listing.strength,
      listing.form,
      listing.unitOfSale,
      normalizeBrand(listing.brand),
      listing.manufacturer,
      listing.countryOfOrigin,
      Number(listing.priceLeones),
      listing.stockQuantity,
      listing.lowStockAlertAt,
      listing.expiryDate ? new Date(`${listing.expiryDate}T00:00:00Z`) : null,
      listing.availableForDelivery ? "Yes" : "No",
      listing.availableForCollection ? "Yes" : "No",
      null,
      listing.updatedAt.toISOString(),
    ].map((value) => (value instanceof Date ? value : plainCell(value as string | number | null))));
  }

  // Reference lists for the dropdowns, and a readable catalogue.
  const reference = workbook.addWorksheet("Catalogue");
  writeHeader(reference, [
    { header: "Medicine", width: 30, required: true },
    { header: "Generic name", width: 26 },
    { header: "Tier", width: 20 },
    { header: "Allowed strengths", width: 30 },
    { header: "Allowed forms", width: 30 },
    { header: "Available as", width: 44 },
  ]);
  const tierName: Record<string, string> = { "1": "1 · Controlled", "2": "2 · Prescription", "3": "3 · Over the counter" };
  for (const drug of catalogue) {
    reference.addRow([
      drug.name, drug.genericName ?? "", tierName[drug.tier] ?? drug.tier, drug.commonStrengths.join(", "), drug.commonForms.join(", "),
      drug.variants.length ? describeVariants(drug.variants) : "Any allowed strength in any allowed form",
    ]);
  }
  const lists = workbook.addWorksheet("Lists", { state: "hidden" });
  const forms = [...new Set(catalogue.flatMap((drug) => drug.commonForms))].sort();
  forms.forEach((form, index) => { lists.getCell(index + 1, 1).value = form; });

  const lastRow = Math.max(listings.length + 1, 2) + 2000;
  const letter = (name: ColumnName) => sheet.getColumn(COLUMN_ORDER.indexOf(name) + 1).letter;
  const range = (name: ColumnName) => `${letter(name)}2:${letter(name)}${lastRow}`;
  const warn = { showErrorMessage: true, errorStyle: "warning" as const };
  addRangeValidation(sheet, range("medicine"), {
    type: "list", allowBlank: true, formulae: [`Catalogue!$A$2:$A$${Math.max(catalogue.length + 1, 2)}`],
    showErrorMessage: true, errorStyle: "information",
    errorTitle: "Not in the catalogue", error: "This medicine is not in the catalogue. It will be sent to MobiCare HQ for review.",
  });
  if (forms.length) {
    addRangeValidation(sheet, range("form"), { type: "list", allowBlank: true, formulae: [`Lists!$A$1:$A$${forms.length}`], ...warn, error: "Pick a form from the list." });
  }
  for (const name of ["delivery", "collection"] as const) {
    addRangeValidation(sheet, range(name), { type: "list", allowBlank: true, formulae: ['"Yes,No"'], ...warn, error: "Enter Yes or No." });
  }
  addRangeValidation(sheet, range("action"), { type: "list", allowBlank: true, formulae: ['"Remove"'], ...warn, error: "Leave blank, or choose Remove." });
  addRangeValidation(sheet, range("price"), { type: "decimal", operator: "greaterThan", allowBlank: true, formulae: [0], ...warn, error: "The price must be a number above 0, like 25.00." });
  addRangeValidation(sheet, range("stock"), { type: "whole", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], ...warn, error: "Stock must be a whole number." });
  addRangeValidation(sheet, range("expiry"), {
    type: "date", operator: "greaterThan", allowBlank: true, formulae: [new Date()],
    ...warn, error: "Expired stock cannot be listed. Enter a date after today.",
  });
  sheet.getColumn(COLUMN_ORDER.indexOf("expiry") + 1).numFmt = "dd/mm/yyyy";
  sheet.getColumn(COLUMN_ORDER.indexOf("price") + 1).numFmt = "0.00";

  const help = workbook.addWorksheet("Instructions");
  help.getColumn(1).width = 110;
  [
    "How to use this file",
    "",
    "1. Fill in one row per product on the Inventory sheet. Green headers are required.",
    "2. List each brand separately. For an unbranded product, write Generic in the Brand column.",
    "   Two generics from different manufacturers are different products: list both.",
    "3. Strength and form must be one of the combinations in the Catalogue sheet's Available as column (capitals do not matter).",
    "4. Medicine names must match the Catalogue sheet. A medicine that is not there is sent to MobiCare HQ for review,",
    "   and stays hidden from patients until HQ approves it.",
    "5. To change listings you already have, export your inventory from the portal, edit it, and upload it again.",
    "   Keep the Listing ID column: it tells MobiCare which listing each row updates.",
    "6. Rows you leave out are never deleted. To take a listing down, write Remove in the Action column.",
    "7. After uploading you see a preview. Nothing is saved until you confirm.",
    "8. Rows with problems are not saved. Download the 'rows to fix' file, correct them, and upload that file.",
    "",
    "Example row:",
    "Medicine: Amoxicillin | Strength: 500mg | Form: capsule | Pack: Pack of 21 capsules | Brand: Amoxil | Manufacturer: GSK |",
    "Country of origin: United Kingdom | Price (Le): 60.00 | Stock quantity: 40 | Expiry date: 31/12/2027",
  ].forEach((line, index) => {
    const row = help.getRow(index + 1);
    row.getCell(1).value = line;
    if (index === 0) row.font = { bold: true, size: 14 };
  });

  return toFile(workbook, fileName);
}

/** A fingerprint of the uploaded file, for the audit log. */
export function fileFingerprint(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
