import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { drugCatalogueTable, pharmaciesTable, pharmacyInventoryTable } from "@workspace/db/schema";
import {
  editDistance,
  parseCsv,
  parseDate,
  parseMoney,
  parseWholeNumber,
  parseYesNo,
  readUpload,
  removeNotes,
  SpreadsheetError,
} from "./table";
import { listsFromVariants, matchVariant, withLists } from "../catalogue/variants";
import { normalizeBrand, productKey } from "../inventory/listing";
import { analyseInventoryUpload } from "../inventory/bulk";
import { analyseCatalogueUpload, nameVariants, parseCategory, parseTier } from "../catalogue/bulk";

// ── A stand-in for the database reader: each table returns fixed rows ────────

function fakeReader(tables: Map<unknown, unknown[]>) {
  return {
    select: () => ({
      from: (table: unknown) => {
        const rows = tables.get(table) ?? [];
        const chain: Record<string, unknown> = {
          then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
            Promise.resolve(rows).then(resolve, reject),
        };
        for (const method of ["where", "limit", "innerJoin", "groupBy", "orderBy"]) chain[method] = () => chain;
        return chain;
      },
    }),
  } as never;
}

const future = `${new Date().getUTCFullYear() + 2}-06-30`;
const pharmacyId = "11111111-1111-4111-8111-111111111111";

function drug(overrides: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    name: "Paracetamol",
    genericName: "Paracetamol",
    description: null,
    tier: "3",
    unit: "tablets",
    commonStrengths: ["500mg"],
    commonForms: ["tablet"],
    variants: [],
    primaryCategory: "pain_inflammation",
    subcategory: "analgesics_antipyretics",
    isApproved: true,
    reviewStatus: "approved",
    rejectionReason: null,
    reviewedAt: null,
    reviewedByHqStaffId: null,
    maxUnitsPerOrder: null,
    proposedByPharmacyId: null,
    createdAt: new Date(),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function csv(rows: string[][]): Buffer {
  return Buffer.from(rows.map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(",")).join("\r\n"));
}

// ── Reading files ────────────────────────────────────────────────────────────

test("CSV parsing handles quotes, commas and line breaks inside quotes", () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\r\n1,"two\nlines",3\n'), [
    ["a", "b, c", 'say "hi"'],
    ["1", "two\nlines", "3"],
  ]);
  assert.throws(() => parseCsv('a,"unclosed'), SpreadsheetError);
});

test("cell values are parsed the way pharmacies type them", () => {
  assert.equal(parseMoney("Le 1,500.50"), 1500.5);
  assert.equal(parseMoney("25"), 25);
  assert.equal(parseMoney("25.505"), null);
  assert.equal(parseMoney("abc"), null);
  assert.equal(parseWholeNumber("1,200"), 1200);
  assert.equal(parseWholeNumber("1.5"), null);
  assert.equal(parseDate("31/12/2027"), "2027-12-31");
  assert.equal(parseDate("2027-12-31"), "2027-12-31");
  assert.equal(parseDate("31/02/2027"), null);
  assert.equal(parseYesNo("", true), true);
  assert.equal(parseYesNo("No", true), false);
  assert.equal(parseYesNo("maybe", true), null);
  assert.equal(editDistance("amoxicilin", "amoxicillin"), 1);
});

test("Excel uploads read the named sheet, dates, and never run formulas", async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Notes").addRow(["ignore me"]);
  const sheet = workbook.addWorksheet("Inventory");
  sheet.addRow(["Medicine", "Expiry date", "Price (Le)"]);
  sheet.addRow(["Paracetamol", new Date(Date.UTC(2027, 11, 31)), { formula: "1+1", result: 2 }]);
  sheet.addRow([]);
  sheet.addRow(["Amoxicillin", "31/12/2027", { formula: "HYPERLINK(\"http://x\")" }]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const table = await readUpload(bytes, "Inventory");
  assert.deepEqual(table.headers, ["Medicine", "Expiry date", "Price (Le)"]);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0]!.cells.expirydate, "2027-12-31");
  assert.equal(table.rows[0]!.cells.pricele, "2");
  assert.equal(table.rows[1]!.rowNumber, 4);
  assert.equal(table.rows[1]!.cells.pricele, "");
});

test("files that are neither Excel nor CSV are refused", async () => {
  await assert.rejects(readUpload(Buffer.from([0x00, 0x01, 0x02]), "Inventory"), SpreadsheetError);
  await assert.rejects(readUpload(Buffer.alloc(0), "Inventory"), SpreadsheetError);
});

// ── Brand rules ──────────────────────────────────────────────────────────────

test("a blank brand or any spelling of generic is saved as Generic", () => {
  assert.equal(normalizeBrand(""), "Generic");
  assert.equal(normalizeBrand(" GENERIC "), "Generic");
  assert.equal(normalizeBrand("  Panadol   Extra "), "Panadol Extra");
  const base = { drugId: "d", strength: "500mg", form: "tablet", unitOfSale: "Pack of 10" };
  assert.equal(
    productKey({ ...base, brand: "panadol", manufacturer: "GSK" }),
    productKey({ ...base, brand: "Panadol", manufacturer: "gsk " }),
  );
  assert.notEqual(
    productKey({ ...base, brand: null, manufacturer: "Emzor" }),
    productKey({ ...base, brand: "Generic", manufacturer: "Juhel" }),
  );
});

// ── Pharmacy inventory analysis ──────────────────────────────────────────────

const HEADER = ["Listing ID", "Medicine", "Strength", "Form", "Pack / unit of sale", "Brand", "Manufacturer", "Country of origin", "Price (Le)", "Stock quantity", "Expiry date", "Action"];

test("inventory rows are sorted into new, duplicate, review and error", async () => {
  const paracetamol = drug({});
  const morphine = drug({ name: "Morphine", genericName: "Morphine", tier: "1", commonStrengths: ["10mg"], commonForms: ["tablet"] });
  const existing = {
    id: "22222222-2222-4222-8222-222222222222",
    pharmacyId,
    drugId: paracetamol.id,
    strength: "500mg",
    form: "tablet",
    unitOfSale: "Pack of 10",
    brand: "Generic",
    manufacturer: "Emzor",
    countryOfOrigin: "Nigeria",
    priceLeones: "12.00",
    stockQuantity: 50,
    lowStockAlertAt: 10,
    expiryDate: future,
    availableForDelivery: true,
    availableForCollection: true,
    isActive: true,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
  const reader = fakeReader(new Map<unknown, unknown[]>([
    [drugCatalogueTable, [paracetamol, morphine]],
    [pharmacyInventoryTable, [existing]],
    [pharmaciesTable, [{ controlled: false }]],
  ]));
  const expiry = future.split("-").reverse().join("/");
  const table = await readUpload(csv([
    HEADER,
    ["", "Paracetamol", "500mg", "tablet", "Pack of 10", "Panadol", "GSK", "UK", "32", "20", expiry, ""],
    ["", "paracetamol", "500mg", "tablet", "Pack of 20", "generic", "emzor", "Nigeria", "22", "50", expiry, ""],
    [existing.id, "Paracetamol", "500mg", "tablet", "Pack of 10", "", "Emzor", "Nigeria", "12", "50", expiry, ""],
    ["", "Paracetamoll", "500mg", "tablet", "Pack of 10", "", "Emzor", "Nigeria", "12", "50", expiry, ""],
    ["", "Zinc sulphate", "20mg", "tablet", "Pack of 10", "", "Emzor", "Nigeria", "8", "40", expiry, ""],
    ["", "Morphine", "10mg", "tablet", "Pack of 10", "", "Martindale", "UK", "90", "5", expiry, ""],
    ["", "Paracetamol", "500mg", "tablet", "Pack of 10", "Panadol", "GSK", "UK", "30", "20", expiry, ""],
    ["", "Paracetamol", "", "tablet", "Pack of 10", "", "Emzor", "", "abc", "5", "31/02/2027", ""],
    [existing.id, "Paracetamol", "", "", "", "", "", "", "", "", "", "Remove"],
  ]), "Inventory");
  const { rows } = await analyseInventoryUpload(pharmacyId, table, reader);
  const status = rows.map((row) => row.status);
  assert.deepEqual(status, ["error", "new", "unchanged", "error", "review", "error", "error", "error", "remove"]);
  assert.match(rows[0]!.message!, /Rows 2 and 8 are the same product/);
  assert.match(rows[3]!.message!, /Did you mean Paracetamol/);
  assert.match(rows[5]!.message!, /authorised/);
  assert.match(rows[7]!.message!, /Strength is missing/);
  assert.match(rows[7]!.message!, /Price must be a number/);
});

test("a row matching an existing listing without its ID asks override or skip", async () => {
  const paracetamol = drug({});
  const reader = fakeReader(new Map<unknown, unknown[]>([
    [drugCatalogueTable, [paracetamol]],
    [pharmacyInventoryTable, [{
      id: crypto.randomUUID(), pharmacyId, drugId: paracetamol.id, strength: "500mg", form: "tablet",
      unitOfSale: "Pack of 10", brand: "Generic", manufacturer: "Emzor", countryOfOrigin: "Nigeria",
      priceLeones: "12.00", stockQuantity: 50, lowStockAlertAt: 10, expiryDate: future,
      availableForDelivery: true, availableForCollection: true, isActive: true, updatedAt: new Date(),
    }]],
    [pharmaciesTable, [{ controlled: false }]],
  ]));
  const table = await readUpload(csv([
    HEADER,
    ["", "paracetamol", "500mg", "tablet", "Pack of 10", "generic", "emzor", "Nigeria", "30", "50", future, ""],
  ]), "Inventory");
  const { rows } = await analyseInventoryUpload(pharmacyId, table, reader);
  assert.equal(rows[0]!.status, "duplicate");
  assert.deepEqual(rows[0]!.changes.map((change) => change.field), ["Price"]);
  assert.match(rows[0]!.warnings[0]!, /more than half/);
});

test("an inventory file without the required columns is refused whole", async () => {
  const reader = fakeReader(new Map());
  const table = await readUpload(csv([["Medicine", "Price"], ["Paracetamol", "10"]]), "Inventory");
  await assert.rejects(analyseInventoryUpload(pharmacyId, table, reader), /missing these columns/);
});

// ── Catalogue analysis ───────────────────────────────────────────────────────

test("a name match adds strengths and forms without removing or renaming", async () => {
  const paracetamol = drug({ commonForms: ["tablet", "syrup"], description: "Pain and fever relief." });
  const reader = fakeReader(new Map<unknown, unknown[]>([[drugCatalogueTable, [paracetamol]]]));
  const table = await readUpload(csv([
    ["Medicine name", "Tier", "Category", "Subcategory", "Strengths", "Forms"],
    ["Acetaminophen", "3", "Pain, inflammation & anaesthesia", "Analgesics & antipyretics", "500mg, 1g", "tablet"],
  ]), "Catalogue");
  const { rows } = await analyseCatalogueUpload(table, reader);
  assert.equal(rows[0]!.status, "duplicate");
  assert.deepEqual(rows[0]!.changes, [{ field: "Strengths", from: "500mg", to: "500mg, 1g" }]);
});

test("tiers and categories are read from labels or stored values", () => {
  assert.equal(parseTier("Tier 1"), "1");
  assert.equal(parseTier("2 · Prescription"), "2");
  assert.equal(parseTier("OTC"), "3");
  assert.equal(parseTier("4"), null);
  assert.deepEqual(parseCategory("Anti-infectives", "Antibiotics"), { primaryCategory: "anti_infectives", subcategory: "antibiotics" });
  assert.deepEqual(parseCategory("pain_inflammation", "Analgesics & antipyretics"), { primaryCategory: "pain_inflammation", subcategory: "analgesics_antipyretics" });
  assert.ok("error" in parseCategory("Anti-infectives", "Antihypertensives"));
  assert.deepEqual(nameVariants("Acetaminophen"), ["paracetamol", "acetaminophen"]);
});

test("catalogue rows catch synonyms, missing tier-1 caps and typos", async () => {
  const paracetamol = drug({});
  const reader = fakeReader(new Map<unknown, unknown[]>([[drugCatalogueTable, [paracetamol]]]));
  const header = ["Catalogue ID", "Medicine name", "Generic name", "Tier", "Category", "Subcategory", "Strengths", "Forms", "Max units per order"];
  const table = await readUpload(csv([
    header,
    ["", "Acetaminophen", "", "3", "Pain, inflammation & anaesthesia", "Analgesics & antipyretics", "500mg", "tablet", ""],
    ["", "Morphine", "", "1", "Pain, inflammation & anaesthesia", "Analgesics & antipyretics", "10mg", "tablet", ""],
    ["", "Amoxicillin", "", "Prescription", "Anti-infectives", "Antibiotics", "250mg, 500mg", "capsule; syrup", ""],
    [paracetamol.id, "Paracetamol", "Paracetamol", "2", "pain_inflammation", "analgesics_antipyretics", "500mg", "tablet", ""],
  ]), "Catalogue");
  const { rows } = await analyseCatalogueUpload(table, reader);
  assert.deepEqual(rows.map((row) => row.status), ["unchanged", "error", "new", "change"]);
  // Matched by its other name: nothing to add, so nothing is renamed or removed.
  assert.match(rows[0]!.message!, /Already in the catalogue/);
  assert.match(rows[1]!.message!, /Max units per order/);
  assert.deepEqual(rows[3]!.changes.map((change) => change.field), ["Tier"]);
});

// ── Files from other tools ───────────────────────────────────────────────────

/** An .xlsx with a cell note stored the way openpyxl stores it. */
async function workbookWithForeignNote(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Inventory");
  sheet.addRow(["Medicine", "Strength"]);
  sheet.addRow(["Paracetamol", "500mg"]);
  const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  zip.file("xl/comments/comment1.xml",
    '<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>HQ</author></authors>' +
    '<commentList><comment ref="A1" authorId="0"><text><t>As named in the catalogue</t></text></comment></commentList></comments>');
  zip.file("xl/worksheets/_rels/sheet1.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="/xl/comments/comment1.xml" Id="comments"/>' +
    "</Relationships>");
  return zip.generateAsync({ type: "nodebuffer" });
}

test("Excel files with notes saved by other tools are still read", async () => {
  const bytes = await workbookWithForeignNote();
  const table = await readUpload(bytes, "Inventory");
  assert.deepEqual(table.rows.map((row) => row.cells["medicine"]), ["Paracetamol"]);
  assert.equal(await removeNotes(Buffer.from(await new ExcelJS.Workbook().xlsx.writeBuffer())), null);
});

// ── Held medicines, capitals and strength + form combinations ────────────────

test("rows naming a medicine waiting for HQ approval attach to it instead of proposing it again", async () => {
  const heldByHq = drug({ name: "Furosemide", genericName: "Furosemide", commonStrengths: ["40mg"], commonForms: ["Tablet"], isApproved: false, reviewStatus: "pending" });
  const request = drug({ name: "Zinc sulphate", genericName: "Zinc sulphate", commonStrengths: ["20mg"], commonForms: ["Tablet"], isApproved: false, reviewStatus: "pending", proposedByPharmacyId: crypto.randomUUID() });
  const reader = fakeReader(new Map<unknown, unknown[]>([
    [drugCatalogueTable, [heldByHq, request]],
    [pharmacyInventoryTable, []],
    [pharmaciesTable, [{ controlled: false }]],
  ]));
  const table = await readUpload(csv([
    HEADER,
    ["", "Furosemide", "40mg", "tablet", "Pack of 10", "", "Emzor", "Nigeria", "10", "5", future, ""],
    ["", "Furosemide", "80mg", "Tablet", "Pack of 10", "", "Emzor", "Nigeria", "10", "5", future, ""],
    ["", "zinc sulphate", "10mg", "dispersible tablet", "Pack of 10", "", "Emzor", "Nigeria", "10", "5", future, ""],
    ["", "Furosemid", "40mg", "Tablet", "Pack of 10", "", "Emzor", "Nigeria", "10", "5", future, ""],
  ]), "Inventory");
  const { rows } = await analyseInventoryUpload(pharmacyId, table, reader);
  assert.deepEqual(rows.map((row) => row.status), ["review", "error", "review", "error"]);
  assert.match(rows[0]!.message!, /Furosemide is waiting for MobiCare HQ approval/);
  assert.match(rows[1]!.message!, /comes in: 40mg/);
  assert.match(rows[2]!.message!, /added to the request/);
  assert.match(rows[3]!.message!, /Did you mean Furosemide/);
});

test("strength and form are matched ignoring capitals and must be a real combination", async () => {
  const paracetamol = drug({
    commonStrengths: ["500mg", "125mg/5ml"],
    commonForms: ["Tablet", "Syrup"],
    variants: [{ strength: "500mg", form: "Tablet" }, { strength: "125mg/5ml", form: "Syrup" }],
  });
  const reader = fakeReader(new Map<unknown, unknown[]>([
    [drugCatalogueTable, [paracetamol]],
    [pharmacyInventoryTable, []],
    [pharmaciesTable, [{ controlled: false }]],
  ]));
  const table = await readUpload(csv([
    HEADER,
    ["", "Paracetamol", "500MG", "tablet", "Pack of 10", "", "Emzor", "Nigeria", "10", "5", future, ""],
    ["", "Paracetamol", "125mg/5ml", "Tablet", "Pack of 10", "", "Emzor", "Nigeria", "10", "5", future, ""],
  ]), "Inventory");
  const { rows } = await analyseInventoryUpload(pharmacyId, table, reader);
  assert.deepEqual(rows.map((row) => row.status), ["new", "error"]);
  assert.match(rows[1]!.message!, /Paracetamol Tablet does not come in 125mg\/5ml. It comes in: 500mg/);
});

test("combinations: saved spelling, every-pair shorthand, and edits to the lists", () => {
  const entry = { name: "Paracetamol", commonStrengths: ["500mg", "125mg/5ml"], commonForms: ["Tablet", "Syrup"], variants: [{ strength: "500mg", form: "Tablet" }, { strength: "125mg/5ml", form: "Syrup" }] };
  assert.deepEqual(matchVariant(entry, "500mg", "TABLET"), { strength: "500mg", form: "Tablet" });
  assert.ok("error" in matchVariant(entry, "500mg", "Syrup"));
  // Every strength in every form is stored as "no restriction".
  assert.deepEqual(listsFromVariants([{ strength: "5mg", form: "tablet" }, { strength: "10mg", form: "Tablet" }]), {
    commonStrengths: ["5mg", "10mg"], commonForms: ["Tablet"], variants: [],
  });
  // A new form comes in every strength; a removed strength takes its pairs with it.
  const edited = withLists(entry, ["500mg"], ["Tablet", "Suppository"]);
  assert.deepEqual(edited, { commonStrengths: ["500mg"], commonForms: ["Tablet", "Suppository"], variants: [] });
  const added = withLists(entry, ["500mg", "125mg/5ml", "1g"], ["Tablet", "Syrup"]);
  assert.deepEqual(added.variants, [
    { strength: "500mg", form: "Tablet" }, { strength: "125mg/5ml", form: "Syrup" },
    { strength: "1g", form: "Tablet" }, { strength: "1g", form: "Syrup" },
  ]);
});
