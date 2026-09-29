import ExcelJS from "exceljs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  drugCatalogueTable,
  pharmaciesTable,
  pharmacyInventoryTable,
  DRUG_CATEGORY_TAXONOMY,
  type DrugCatalogue,
} from "@workspace/db/schema";
import {
  addRangeValidation,
  editDistance,
  headerKey,
  parseWholeNumber,
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
 * Bulk upload of the MobiCare master catalogue by HQ.
 *
 * New medicines are saved held (not listable), so someone with catalogue
 * permission confirms each one's tier in the Held queue before pharmacies can
 * stock it. Rows with a Catalogue ID update that entry directly.
 */

export const CATALOGUE_SHEET = "Catalogue";

const COLUMNS = {
  catalogueId: { header: "Catalogue ID", width: 38, note: "Leave blank for a new medicine. Filled in by the catalogue export." },
  name: { header: "Medicine name", width: 28, required: true },
  genericName: { header: "Generic name", width: 26 },
  tier: { header: "Tier", width: 22, required: true, note: "1 Controlled, 2 Prescription, or 3 Over the counter" },
  category: { header: "Category", width: 32, required: true },
  subcategory: { header: "Subcategory", width: 32, required: true },
  strengths: { header: "Strengths", width: 26, required: true, note: "Separate several with commas, e.g. 250mg, 500mg" },
  forms: { header: "Forms", width: 22, required: true, note: "Separate several with commas, e.g. tablet, syrup" },
  unit: { header: "Unit", width: 12, note: "e.g. tablets, ml. Default tablets" },
  maxUnits: { header: "Max units per order", width: 18, note: "Required for tier 1" },
  description: { header: "Description", width: 40 },
  lastUpdated: { header: "Last updated", width: 22, hidden: true },
} satisfies Record<string, SheetColumn>;

type ColumnName = keyof typeof COLUMNS;
const COLUMN_ORDER = Object.keys(COLUMNS) as ColumnName[];
const REQUIRED: ColumnName[] = ["name", "tier", "category", "subcategory", "strengths", "forms"];
const ALIASES: Partial<Record<ColumnName, string[]>> = {
  catalogueId: ["id"],
  name: ["name", "medicine", "drug", "drugname"],
  genericName: ["generic"],
  strengths: ["strength", "commonstrengths"],
  forms: ["form", "commonforms"],
  maxUnits: ["maxunits", "maxunitsperorder"],
};

function cell(row: UploadedRow, column: ColumnName): string {
  for (const key of [headerKey(COLUMNS[column].header), ...(ALIASES[column] ?? [])]) {
    const value = row.cells[key];
    if (value !== undefined) return value;
  }
  return "";
}

function hasColumn(table: UploadedTable, column: ColumnName): boolean {
  const keys = new Set(table.headers.map(headerKey));
  return [headerKey(COLUMNS[column].header), ...(ALIASES[column] ?? [])].some((key) => keys.has(key));
}

const TIER_LABELS: Record<string, string> = {
  "1": "1 · Controlled",
  "2": "2 · Prescription",
  "3": "3 · Over the counter",
};

/** "1", "Tier 1", "Controlled", "1 · Controlled" → "1"; unknown → null. */
export function parseTier(text: string): "1" | "2" | "3" | null {
  const value = text.trim().toLowerCase().replace(/^tier\s*/, "");
  if (/^1\b/.test(value) || value.startsWith("controlled")) return "1";
  if (/^2\b/.test(value) || value.startsWith("prescription") || value === "pom" || value === "rx") return "2";
  if (/^3\b/.test(value) || value.startsWith("over the counter") || value === "otc") return "3";
  return null;
}

/** A category or subcategory given by its label or its stored value. */
export function parseCategory(categoryText: string, subcategoryText: string):
  | { primaryCategory: string; subcategory: string }
  | { error: string } {
  const key = (text: string) => text.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  const category = DRUG_CATEGORY_TAXONOMY.find(
    (candidate) => key(candidate.value) === key(categoryText) || key(candidate.label) === key(categoryText),
  );
  if (!category) return { error: `"${categoryText}" is not a MobiCare category. Pick one from the Categories sheet` };
  const subcategory = category.subcategories.find(
    (candidate) => key(candidate.value) === key(subcategoryText) || key(candidate.label) === key(subcategoryText),
  );
  if (!subcategory) return { error: `"${subcategoryText}" is not a subcategory of ${category.label}` };
  return { primaryCategory: category.value, subcategory: subcategory.value };
}

/** Other names the same medicine goes by; compared in lower case. */
const SYNONYMS: string[][] = [
  ["paracetamol", "acetaminophen"],
  ["salbutamol", "albuterol"],
  ["adrenaline", "epinephrine"],
  ["noradrenaline", "norepinephrine"],
  ["frusemide", "furosemide"],
  ["lignocaine", "lidocaine"],
  ["amoxycillin", "amoxicillin"],
  ["glibenclamide", "glyburide"],
  ["pethidine", "meperidine"],
  ["co-trimoxazole", "cotrimoxazole", "sulfamethoxazole/trimethoprim"],
  ["artemether/lumefantrine", "artemether-lumefantrine", "coartem"],
  ["hyoscine butylbromide", "buscopan"],
  ["ferrous sulphate", "ferrous sulfate"],
];

export function nameVariants(name: string): string[] {
  const lower = name.trim().toLowerCase().replace(/\s+/g, " ");
  const group = SYNONYMS.find((names) => names.includes(lower));
  return group ?? [lower];
}

function splitList(text: string): string[] {
  return [...new Set(text.split(/[,;\n]/).map((value) => value.trim()).filter(Boolean))];
}

const DEFAULT_UNIT = "tablets";

type DrugValues = {
  name: string;
  genericName: string | null;
  tier: "1" | "2" | "3";
  primaryCategory: string;
  subcategory: string;
  commonStrengths: string[];
  commonForms: string[];
  unit: string;
  maxUnitsPerOrder: number | null;
  description: string | null;
};

export type CatalogueRowStatus = "new" | "change" | "duplicate" | "unchanged" | "error";

export interface CatalogueRowChange {
  field: string;
  from: string;
  to: string;
}

export interface AnalysedCatalogueRow {
  rowNumber: number;
  status: CatalogueRowStatus;
  message: string | null;
  warnings: string[];
  changes: CatalogueRowChange[];
  summary: string;
  catalogueId: string | null;
}

type Plan =
  | { kind: "insert"; values: DrugValues }
  | { kind: "update"; drugId: string; values: DrugValues; wasApproved: boolean }
  | { kind: "none" };

interface RowResult extends AnalysedCatalogueRow {
  plan: Plan;
  raw: string[];
}

export interface CatalogueAnalysis {
  headers: string[];
  rows: RowResult[];
}

function readRow(row: UploadedRow): { values: DrugValues } | { error: string } {
  const problems: string[] = [];
  for (const column of REQUIRED) {
    if (!cell(row, column)) problems.push(`${COLUMNS[column].header} is missing`);
  }
  if (problems.length) return { error: problems.join("; ") };
  const tier = parseTier(cell(row, "tier"));
  if (!tier) problems.push("Tier must be 1 (Controlled), 2 (Prescription) or 3 (Over the counter)");
  const category = parseCategory(cell(row, "category"), cell(row, "subcategory"));
  if ("error" in category) problems.push(category.error);
  const maxText = cell(row, "maxUnits");
  const maxUnits = maxText ? parseWholeNumber(maxText) : null;
  if (maxText && (maxUnits == null || maxUnits < 1)) problems.push("Max units per order must be a whole number of 1 or more");
  if (tier === "1" && maxUnits == null) problems.push("Tier 1 (controlled) medicines need a Max units per order");
  const strengths = splitList(cell(row, "strengths"));
  const forms = splitList(cell(row, "forms"));
  if (strengths.some((value) => value.length > 50)) problems.push("Each strength must be 50 characters or fewer");
  if (forms.some((value) => value.length > 50)) problems.push("Each form must be 50 characters or fewer");
  if (cell(row, "name").length > 200) problems.push("Medicine name is longer than 200 characters");
  if (problems.length) return { error: problems.join("; ") };
  const { primaryCategory, subcategory } = category as { primaryCategory: string; subcategory: string };
  return {
    values: {
      name: cell(row, "name").replace(/\s+/g, " "),
      genericName: cell(row, "genericName") || null,
      tier: tier!,
      primaryCategory,
      subcategory,
      commonStrengths: strengths,
      commonForms: forms,
      unit: cell(row, "unit") || DEFAULT_UNIT,
      maxUnitsPerOrder: tier === "1" ? maxUnits : maxUnits ?? null,
      description: cell(row, "description") || null,
    },
  };
}

/**
 * A row that matched an existing entry by name, not by its Catalogue ID, adds
 * to that entry rather than replacing it: the entry keeps its name, blank
 * cells keep what is saved, and strengths and forms are added, never removed
 * (pharmacies may already stock the ones the file leaves out).
 */
export function mergeIntoExisting(existing: DrugCatalogue, values: DrugValues, unitGiven: boolean): DrugValues {
  const union = (saved: string[], typed: string[]) => [
    ...saved,
    ...typed.filter((value) => !saved.some((kept) => kept.toLowerCase() === value.toLowerCase())),
  ];
  return {
    ...values,
    name: existing.name,
    genericName: values.genericName ?? existing.genericName,
    commonStrengths: union(existing.commonStrengths, values.commonStrengths),
    commonForms: union(existing.commonForms, values.commonForms),
    unit: unitGiven ? values.unit : existing.unit,
    maxUnitsPerOrder: values.maxUnitsPerOrder ?? existing.maxUnitsPerOrder,
    description: values.description ?? existing.description,
  };
}

function categoryLabel(value: string | null): string {
  if (!value) return "—";
  for (const category of DRUG_CATEGORY_TAXONOMY) {
    if (category.value === value) return category.label;
    const sub = category.subcategories.find((candidate) => candidate.value === value);
    if (sub) return sub.label;
  }
  return value;
}

function diff(existing: DrugCatalogue, values: DrugValues): CatalogueRowChange[] {
  const pairs: Array<[string, string, string]> = [
    ["Name", existing.name, values.name],
    ["Generic name", existing.genericName ?? "—", values.genericName ?? "—"],
    ["Tier", TIER_LABELS[existing.tier]!, TIER_LABELS[values.tier]!],
    ["Category", categoryLabel(existing.primaryCategory), categoryLabel(values.primaryCategory)],
    ["Subcategory", categoryLabel(existing.subcategory), categoryLabel(values.subcategory)],
    ["Strengths", existing.commonStrengths.join(", "), values.commonStrengths.join(", ")],
    ["Forms", existing.commonForms.join(", "), values.commonForms.join(", ")],
    ["Unit", existing.unit, values.unit],
    ["Max units per order", existing.maxUnitsPerOrder?.toString() ?? "—", values.maxUnitsPerOrder?.toString() ?? "—"],
    ["Description", existing.description ?? "—", values.description ?? "—"],
  ];
  return pairs.filter(([, from, to]) => from !== to).map(([field, from, to]) => ({ field, from, to }));
}

type Reader = Pick<typeof db, "select">;

/** Active listings of each medicine, and at how many pharmacies. */
async function listingCounts(drugIds: string[], reader: Reader) {
  if (drugIds.length === 0) return new Map<string, { listings: number; pharmacies: number; unauthorised: number }>();
  const rows = await reader
    .select({
      drugId: pharmacyInventoryTable.drugId,
      listings: sql<number>`count(*)::int`,
      pharmacies: sql<number>`count(distinct ${pharmacyInventoryTable.pharmacyId})::int`,
      unauthorised: sql<number>`count(distinct ${pharmacyInventoryTable.pharmacyId}) filter (where not ${pharmaciesTable.controlledSubstanceAuthorized})::int`,
    })
    .from(pharmacyInventoryTable)
    .innerJoin(pharmaciesTable, eq(pharmaciesTable.id, pharmacyInventoryTable.pharmacyId))
    .where(and(inArray(pharmacyInventoryTable.drugId, drugIds), eq(pharmacyInventoryTable.isActive, true)))
    .groupBy(pharmacyInventoryTable.drugId);
  return new Map(rows.map((row) => [row.drugId, row]));
}

export async function analyseCatalogueUpload(table: UploadedTable, reader: Reader = db): Promise<CatalogueAnalysis> {
  const missing = REQUIRED.filter((column) => !hasColumn(table, column));
  if (missing.length) {
    throw new SpreadsheetError(
      `The file is missing these columns: ${missing.map((column) => COLUMNS[column].header).join(", ")}. Download the template and copy your rows into it.`,
    );
  }
  const catalogue = (await reader.select().from(drugCatalogueTable)).filter((drug) => drug.reviewStatus !== "rejected");
  const byId = new Map(catalogue.map((drug) => [drug.id, drug]));
  const byName = new Map<string, DrugCatalogue>();
  for (const drug of catalogue) {
    for (const name of [drug.name, drug.genericName].filter(Boolean) as string[]) {
      for (const variant of nameVariants(name)) if (!byName.has(variant)) byName.set(variant, drug);
    }
  }

  const results: RowResult[] = [];
  const seenNames = new Map<string, RowResult>();
  const tierChanges: Array<{ result: RowResult; drugId: string; to: string }> = [];

  for (const row of table.rows) {
    const catalogueId = cell(row, "catalogueId") || null;
    const base = { rowNumber: row.rowNumber, warnings: [] as string[], changes: [] as CatalogueRowChange[], raw: row.raw, catalogueId };
    const name = cell(row, "name");
    const fail = (message: string): RowResult => ({ ...base, status: "error", message, summary: name || `Row ${row.rowNumber}`, plan: { kind: "none" } });

    const read = readRow(row);
    if ("error" in read) {
      results.push(fail(read.error));
      continue;
    }
    const { values } = read;
    const summary = `${values.name} · tier ${values.tier}`;

    const nameKey = values.name.toLowerCase();
    const earlier = seenNames.get(nameKey);
    if (earlier) {
      const message = `Rows ${earlier.rowNumber} and ${row.rowNumber} are the same medicine. Put all its strengths and forms on one row.`;
      Object.assign(earlier, { status: "error", message, plan: { kind: "none" } });
      results.push(fail(message));
      continue;
    }

    let result: RowResult;
    if (catalogueId) {
      const existing = byId.get(catalogueId);
      if (!existing) {
        result = fail("This Catalogue ID is not in the catalogue. Clear it to add the row as a new medicine");
      } else {
        const clash = nameVariants(values.name).map((variant) => byName.get(variant)).find((drug) => drug && drug.id !== existing.id);
        if (clash && clash.name.toLowerCase() === nameKey) {
          result = fail(`Another catalogue entry is already called ${clash.name}`);
        } else {
          const changes = diff(existing, values);
          const lastUpdated = Date.parse(cell(row, "lastUpdated"));
          const warnings: string[] = [];
          if (Number.isFinite(lastUpdated) && existing.updatedAt.getTime() > lastUpdated + 1000) {
            warnings.push("This entry changed in MobiCare after your file was downloaded. Saving overwrites those changes");
          }
          result = {
            ...base, warnings, changes, summary,
            status: changes.length ? "change" : "unchanged",
            message: existing.isApproved ? null : "Still held: confirm it in the Held queue",
            plan: changes.length ? { kind: "update", drugId: existing.id, values, wasApproved: existing.isApproved } : { kind: "none" },
          };
          if (existing.tier !== values.tier) tierChanges.push({ result, drugId: existing.id, to: values.tier });
        }
      }
    } else {
      const existing = nameVariants(values.name)
        .concat(values.genericName ? nameVariants(values.genericName) : [])
        .map((variant) => byName.get(variant))
        .find(Boolean);
      if (existing) {
        const merged = mergeIntoExisting(existing, values, Boolean(cell(row, "unit")));
        const changes = diff(existing, merged);
        const sameName = existing.name.toLowerCase() === nameKey;
        result = {
          ...base, changes, summary, catalogueId: existing.id,
          status: changes.length ? "duplicate" : "unchanged",
          message: changes.length
            ? `${sameName ? "Already in the catalogue" : `Looks like the same medicine as ${existing.name}`}. Choose Override to update it, or Skip`
            : "Already in the catalogue with the same details",
          plan: changes.length ? { kind: "update", drugId: existing.id, values: merged, wasApproved: existing.isApproved } : { kind: "none" },
        };
        if (changes.length && existing.tier !== values.tier) tierChanges.push({ result, drugId: existing.id, to: values.tier });
      } else {
        const similar = catalogue
          .map((drug) => ({ drug, distance: editDistance(nameKey, drug.name.toLowerCase()) }))
          .filter(({ distance }) => distance > 0 && distance <= 2)
          .sort((a, b) => a.distance - b.distance)[0]?.drug;
        result = {
          ...base, summary, status: "new",
          message: "Saved held: confirm its tier in the Held queue before pharmacies can list it",
          warnings: similar ? [`Similar to ${similar.name}. Check this is not a typing mistake`] : [],
          plan: { kind: "insert", values },
        };
      }
    }
    seenNames.set(nameKey, result);
    results.push(result);
  }

  const counts = await listingCounts([...new Set(tierChanges.map((change) => change.drugId))], reader);
  for (const { result, drugId, to } of tierChanges) {
    const count = counts.get(drugId);
    if (!count) continue;
    result.warnings.push(
      `The tier change affects ${count.listings} listing${count.listings === 1 ? "" : "s"} across ${count.pharmacies} pharmac${count.pharmacies === 1 ? "y" : "ies"}`,
    );
    if (to === "1" && count.unauthorised > 0) {
      result.warnings.push(
        `${count.unauthorised} of those pharmacies are not authorised for controlled medicines. Their listings will be taken down`,
      );
    }
  }

  return { headers: table.headers, rows: results };
}

export function summariseCatalogue(rows: AnalysedCatalogueRow[]) {
  const count = (status: CatalogueRowStatus) => rows.filter((row) => row.status === status).length;
  return {
    total: rows.length,
    new: count("new"),
    change: count("change"),
    duplicate: count("duplicate"),
    unchanged: count("unchanged"),
    error: count("error"),
    warnings: rows.filter((row) => row.warnings.length > 0).length,
  };
}

export function publicCatalogueRows(analysis: CatalogueAnalysis): AnalysedCatalogueRow[] {
  return analysis.rows.map(({ plan: _plan, raw: _raw, ...row }) => row);
}

export interface CatalogueApplyResult {
  added: number;
  updated: number;
  skipped: number;
  unchanged: number;
  failed: number;
  listingsTakenDown: number;
  errorReport: WorkbookFile | null;
}

export class CatalogueDecisionsMissing extends Error {
  constructor(public readonly rows: number[]) {
    super(`Choose Override or Skip for the duplicate rows: ${rows.join(", ")}`);
  }
}

export async function applyCatalogueUpload(
  analysis: CatalogueAnalysis,
  decisions: Record<string, "override" | "skip">,
  duplicateDefault: "override" | "skip" | null,
  fileName: string,
  hqStaffId: string,
): Promise<CatalogueApplyResult> {
  const undecided = analysis.rows
    .filter((row) => row.status === "duplicate" && !decisions[String(row.rowNumber)] && !duplicateDefault)
    .map((row) => row.rowNumber);
  if (undecided.length) throw new CatalogueDecisionsMissing(undecided);

  const result: CatalogueApplyResult = { added: 0, updated: 0, skipped: 0, unchanged: 0, failed: 0, listingsTakenDown: 0, errorReport: null };
  const failures: Array<{ raw: string[]; problem: string }> = [];

  await db.transaction(async (tx) => {
    for (const row of analysis.rows) {
      if (row.status === "error") {
        failures.push({ raw: row.raw, problem: row.message ?? "Invalid row" });
        continue;
      }
      if (row.status === "unchanged") {
        result.unchanged++;
        continue;
      }
      if (row.status === "duplicate" && (decisions[String(row.rowNumber)] ?? duplicateDefault) !== "override") {
        result.skipped++;
        continue;
      }
      const plan = row.plan;
      if (plan.kind === "insert") {
        await tx.insert(drugCatalogueTable).values({
          ...plan.values,
          isApproved: false,
          reviewStatus: "pending",
        });
        result.added++;
      } else if (plan.kind === "update") {
        const [previous] = await tx
          .select({ tier: drugCatalogueTable.tier })
          .from(drugCatalogueTable)
          .where(eq(drugCatalogueTable.id, plan.drugId))
          .limit(1);
        await tx
          .update(drugCatalogueTable)
          .set({ ...plan.values, updatedAt: new Date(), reviewedByHqStaffId: plan.wasApproved ? hqStaffId : undefined })
          .where(eq(drugCatalogueTable.id, plan.drugId));
        result.updated++;
        // A medicine that becomes controlled leaves pharmacies not authorised
        // to sell controlled medicines, the same rule as listing one by hand.
        if (previous && previous.tier !== "1" && plan.values.tier === "1") {
          const takenDown = await tx
            .update(pharmacyInventoryTable)
            .set({ isActive: false, updatedAt: new Date() })
            .where(
              and(
                eq(pharmacyInventoryTable.drugId, plan.drugId),
                eq(pharmacyInventoryTable.isActive, true),
                sql`${pharmacyInventoryTable.pharmacyId} in (select id from pharmacies where not controlled_substance_authorized)`,
              ),
            )
            .returning({ id: pharmacyInventoryTable.id });
          result.listingsTakenDown += takenDown.length;
        }
      }
    }
  });

  result.failed = failures.length;
  if (failures.length) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(CATALOGUE_SHEET);
    writeHeader(sheet, [...analysis.headers.map((header) => ({ header, width: 20 })), { header: "Problem", width: 60, required: true }]);
    for (const failure of failures) sheet.addRow([...failure.raw.map(plainCell), failure.problem]);
    result.errorReport = await toFile(workbook, `${fileName.replace(/\.(xlsx|csv)$/i, "")} - rows to fix.xlsx`);
  }
  return result;
}

/** The catalogue as a spreadsheet: the empty template, or every entry. */
export async function catalogueWorkbook(withEntries: boolean, fileName: string): Promise<WorkbookFile> {
  const entries = withEntries
    ? (await db.select().from(drugCatalogueTable))
        .filter((drug) => drug.reviewStatus !== "rejected")
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MobiCare";
  const sheet = workbook.addWorksheet(CATALOGUE_SHEET);
  writeHeader(sheet, COLUMN_ORDER.map((name) => COLUMNS[name]));
  for (const drug of entries) {
    sheet.addRow([
      drug.id,
      drug.name,
      drug.genericName,
      TIER_LABELS[drug.tier],
      drug.primaryCategory ? categoryLabel(drug.primaryCategory) : null,
      drug.subcategory ? categoryLabel(drug.subcategory) : null,
      drug.commonStrengths.join(", "),
      drug.commonForms.join(", "),
      drug.unit,
      drug.maxUnitsPerOrder,
      drug.description,
      drug.updatedAt.toISOString(),
    ].map((value) => plainCell(value ?? null)));
  }

  const categories = workbook.addWorksheet("Categories");
  writeHeader(categories, [
    { header: "Category", width: 36, required: true },
    { header: "Subcategory", width: 40, required: true },
  ]);
  const categoryNames: string[] = [];
  for (const category of DRUG_CATEGORY_TAXONOMY) {
    categoryNames.push(category.label);
    for (const sub of category.subcategories) categories.addRow([category.label, sub.label]);
  }
  const lists = workbook.addWorksheet("Lists", { state: "hidden" });
  categoryNames.forEach((label, index) => { lists.getCell(index + 1, 1).value = label; });
  const subLabels = DRUG_CATEGORY_TAXONOMY.flatMap((category) => category.subcategories.map((sub) => sub.label));
  subLabels.forEach((label, index) => { lists.getCell(index + 1, 2).value = label; });
  Object.values(TIER_LABELS).forEach((label, index) => { lists.getCell(index + 1, 3).value = label; });

  const last = entries.length + 2000;
  const letter = (name: ColumnName) => sheet.getColumn(COLUMN_ORDER.indexOf(name) + 1).letter;
  const range = (name: ColumnName) => `${letter(name)}2:${letter(name)}${last}`;
  const warn = { showErrorMessage: true, errorStyle: "warning" as const };
  addRangeValidation(sheet, range("tier"), { type: "list", allowBlank: true, formulae: [`Lists!$C$1:$C$3`], ...warn, error: "Pick a tier from the list." });
  addRangeValidation(sheet, range("category"), { type: "list", allowBlank: true, formulae: [`Lists!$A$1:$A$${categoryNames.length}`], ...warn, error: "Pick a category from the list." });
  addRangeValidation(sheet, range("subcategory"), { type: "list", allowBlank: true, formulae: [`Lists!$B$1:$B$${subLabels.length}`], ...warn, error: "Pick a subcategory from the list. See the Categories sheet for which belong to which category." });
  addRangeValidation(sheet, range("maxUnits"), { type: "whole", operator: "greaterThanOrEqual", allowBlank: true, formulae: [1], ...warn, error: "Enter a whole number of 1 or more." });

  const help = workbook.addWorksheet("Instructions");
  help.getColumn(1).width = 110;
  [
    "How to use this file",
    "",
    "1. One row per medicine. Put all of its strengths and forms in one row, separated by commas.",
    "2. Green headers are required. Tier 1 (controlled) medicines also need Max units per order.",
    "3. Category and subcategory must match the Categories sheet.",
    "4. New medicines are saved held. Confirm each one's tier in Catalogue → Held before pharmacies can list it.",
    "5. To change entries, export the catalogue, edit it, and upload it again. Keep the Catalogue ID column.",
    "6. Rows left out of the file are never deleted.",
    "7. After uploading you see a preview. Nothing is saved until you confirm.",
  ].forEach((line, index) => {
    const row = help.getRow(index + 1);
    row.getCell(1).value = line;
    if (index === 0) row.font = { bold: true, size: 14 };
  });

  return toFile(workbook, fileName);
}

