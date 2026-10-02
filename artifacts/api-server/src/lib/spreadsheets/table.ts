import ExcelJS from "exceljs";
import JSZip from "jszip";

/**
 * Reading uploaded spreadsheets (Excel .xlsx or CSV) into plain rows of text,
 * and writing simple .xlsx files back. Uploads are parsed as data only:
 * formulas are never evaluated (a formula cell contributes its saved result,
 * if any), and macros, links and embedded objects are ignored.
 */

/** Largest file accepted, before base64 encoding. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Most data rows accepted in one upload. */
export const MAX_ROWS = 5000;

export interface UploadedRow {
  /** The row number the person sees in their spreadsheet. */
  rowNumber: number;
  /** Cell text by normalised header, trimmed; missing cells are "". */
  cells: Record<string, string>;
  /** Cell text in the order the headers appeared, for error reports. */
  raw: string[];
}

export interface UploadedTable {
  headers: string[];
  rows: UploadedRow[];
}

export class SpreadsheetError extends Error {}

/** Header text compared loosely: case, spacing and punctuation ignored. */
export function headerKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isZip(bytes: Buffer): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) {
    // Excel stores dates as UTC midnight; take the date part only.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    if ("result" in value) return cellText((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ("richText" in value) return (value as ExcelJS.CellRichTextValue).richText.map((part) => part.text).join("");
    if ("text" in value) return String((value as ExcelJS.CellHyperlinkValue).text ?? "");
    if ("error" in value) return "";
    return "";
  }
  return String(value);
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (inQuotes) throw new SpreadsheetError("The CSV file has an unclosed quotation mark.");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toTable(grid: Array<{ rowNumber: number; values: string[] }>): UploadedTable {
  const headerRow = grid.find((row) => row.values.some((value) => value.trim() !== ""));
  if (!headerRow) throw new SpreadsheetError("The file is empty.");
  const headers = headerRow.values.map((value) => value.trim());
  const keys = headers.map(headerKey);
  const rows: UploadedRow[] = [];
  for (const line of grid) {
    if (line.rowNumber <= headerRow.rowNumber) continue;
    if (line.values.every((value) => value.trim() === "")) continue;
    const cells: Record<string, string> = {};
    keys.forEach((key, index) => {
      if (key && cells[key] === undefined) cells[key] = (line.values[index] ?? "").trim();
    });
    rows.push({ rowNumber: line.rowNumber, cells, raw: headers.map((_, index) => line.values[index] ?? "") });
  }
  if (rows.length > MAX_ROWS) {
    throw new SpreadsheetError(`The file has ${rows.length} rows; the most one upload can take is ${MAX_ROWS}. Split it into smaller files.`);
  }
  return { headers, rows };
}

async function loadWorkbook(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const unreadable = () =>
    new SpreadsheetError("The Excel file could not be read. Save it as .xlsx (not .xls), without a password, and try again.");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
    return workbook;
  } catch {
    // ExcelJS reads cell notes (comments) only from the place Excel itself
    // saves them, and fails on files from tools that store them elsewhere
    // (openpyxl, some exporters). Notes are never needed to read the data,
    // so try again with them removed.
    const withoutNotes = await removeNotes(bytes).catch(() => null);
    if (!withoutNotes) throw unreadable();
    const retry = new ExcelJS.Workbook();
    try {
      await retry.xlsx.load(withoutNotes as unknown as ArrayBuffer);
      return retry;
    } catch {
      throw unreadable();
    }
  }
}

/** The file with every sheet's links to its notes removed; null if it has none. */
export async function removeNotes(bytes: Buffer): Promise<Buffer | null> {
  const zip = await JSZip.loadAsync(bytes);
  let changed = false;
  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/_rels\/[^/]+\.rels$/.test(name)) continue;
    const xml = await zip.file(name)!.async("string");
    const stripped = xml.replace(/<Relationship\b[^>]*\/relationships\/(?:comments|vmlDrawing)"[^>]*\/>/g, "");
    if (stripped !== xml) {
      zip.file(name, stripped);
      changed = true;
    }
  }
  if (!changed) return null;
  return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * Reads an uploaded .xlsx or .csv file. For Excel, reads the sheet named
 * `preferredSheet` if there is one, otherwise the first sheet.
 */
export async function readUpload(bytes: Buffer, preferredSheet: string): Promise<UploadedTable> {
  if (bytes.length === 0) throw new SpreadsheetError("The file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new SpreadsheetError("The file is larger than 5 MB.");

  if (isZip(bytes)) {
    const workbook = await loadWorkbook(bytes);
    const sheet = workbook.getWorksheet(preferredSheet) ?? workbook.worksheets[0];
    if (!sheet) throw new SpreadsheetError("The Excel file has no sheets.");
    const grid: Array<{ rowNumber: number; values: string[] }> = [];
    const width = sheet.columnCount;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values: string[] = [];
      for (let column = 1; column <= width; column++) values.push(cellText(row.getCell(column).value));
      grid.push({ rowNumber, values });
    });
    return toTable(grid);
  }

  const text = bytes.toString("utf8");
  if (text.includes("\u0000")) throw new SpreadsheetError("That file is neither an Excel (.xlsx) nor a CSV file.");
  return toTable(parseCsv(text).map((values, index) => ({ rowNumber: index + 1, values })));
}

export interface SheetColumn {
  header: string;
  width?: number;
  /** A short note shown when the header cell is hovered in Excel. */
  note?: string;
  required?: boolean;
  hidden?: boolean;
}

export interface WorkbookFile {
  fileName: string;
  mimeType: string;
  contentBase64: string;
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Styles a header row: bold, green for required columns, frozen in place. */
export function writeHeader(sheet: ExcelJS.Worksheet, columns: SheetColumn[]): void {
  sheet.columns = columns.map((column) => ({
    header: column.header,
    width: column.width ?? 18,
    hidden: column.hidden ?? false,
  }));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  columns.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: column.required ? "FF0B3D2E" : "FF5B6B64" },
    };
    if (column.note) cell.note = column.note;
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

/**
 * Cells are written as plain values. A value that starts with = + - or @ is
 * stored as text, never as a formula, so opening an export cannot run
 * anything.
 */
export function plainCell(value: string | number | null | undefined): string | number | null {
  if (value == null) return null;
  return value;
}

/**
 * A dropdown or value check over a whole range such as "B2:B2000". ExcelJS
 * supports ranges at runtime but only types per-cell validations.
 */
export function addRangeValidation(sheet: ExcelJS.Worksheet, range: string, validation: ExcelJS.DataValidation): void {
  (sheet as unknown as { dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void } })
    .dataValidations.add(range, validation);
}

export async function toFile(workbook: ExcelJS.Workbook, fileName: string): Promise<WorkbookFile> {
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { fileName, mimeType: XLSX_MIME, contentBase64: buffer.toString("base64") };
}

/** Decodes a base64 upload, accepting a data URL prefix. */
export function decodeUpload(contentBase64: string): Buffer {
  const base64 = contentBase64.includes(",") ? contentBase64.slice(contentBase64.indexOf(",") + 1) : contentBase64;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new SpreadsheetError("The file is larger than 5 MB.");
  return bytes;
}

// ── Cell value parsing ──────────────────────────────────────────────────────

/** "Le 1,500.50", "1500.5" → 1500.5; anything else → null. */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/^le\s*/i, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function parseWholeNumber(text: string): number | null {
  const cleaned = text.replace(/,/g, "").trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

/** YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY → YYYY-MM-DD; invalid dates → null. */
export function parseDate(text: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : dmy
      ? [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])]
      : [NaN, NaN, NaN];
  if (!Number.isInteger(year)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** Yes/No in the forms people type; blank gives the default. */
export function parseYesNo(text: string, fallback: boolean): boolean | null {
  const value = text.trim().toLowerCase();
  if (!value) return fallback;
  if (["yes", "y", "true", "1"].includes(value)) return true;
  if (["no", "n", "false", "0"].includes(value)) return false;
  return null;
}

/** Edit distance, for "did you mean" suggestions on medicine names. */
export function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j]!;
      previous[j] = Math.min(
        previous[j]! + 1,
        previous[j - 1]! + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length]!;
}
