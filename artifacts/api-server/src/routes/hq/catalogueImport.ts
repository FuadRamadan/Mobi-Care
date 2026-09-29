import { z } from "zod";
import type { Response } from "express";
import { safeRouter } from "../../lib/safeRouter.js";
import { requireManageCatalogue, type AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { fileFingerprint } from "../../lib/inventory/bulk.js";
import {
  analyseCatalogueUpload,
  applyCatalogueUpload,
  CATALOGUE_SHEET,
  CatalogueDecisionsMissing,
  catalogueWorkbook,
  publicCatalogueRows,
  summariseCatalogue,
} from "../../lib/catalogue/bulk.js";
import { decodeUpload, readUpload, SpreadsheetError } from "../../lib/spreadsheets/table.js";

/** Bulk upload and export of the master catalogue (/hq/drugs/...). */
// Mounted ahead of the catalogue routes on the same path, so the permission
// check sits on each route: a router-level check would also block staff
// without catalogue permission from viewing the catalogue.
const router = safeRouter();

const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentBase64: z.string().min(1),
});
const applySchema = uploadSchema.extend({
  decisions: z.record(z.string(), z.enum(["override", "skip"])).default({}),
  duplicateDefault: z.enum(["override", "skip"]).nullable().default(null),
});

function spreadsheetProblem(error: unknown, res: Response): boolean {
  if (error instanceof SpreadsheetError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  return false;
}

router.get("/import/template", requireManageCatalogue, async (_req, res) => {
  res.json(await catalogueWorkbook(false, "MobiCare catalogue template.xlsx"));
});

router.get("/export", requireManageCatalogue, async (_req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  res.json(await catalogueWorkbook(true, `mobicare-catalogue-${date}.xlsx`));
});

router.post("/import/preview", requireManageCatalogue, async (req: AuthRequest, res) => {
  const body = uploadSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Choose a file to upload" });
    return;
  }
  try {
    const analysis = await analyseCatalogueUpload(await readUpload(decodeUpload(body.data.contentBase64), CATALOGUE_SHEET));
    const rows = publicCatalogueRows(analysis);
    res.json({ fileName: body.data.fileName, summary: summariseCatalogue(rows), rows });
  } catch (error) {
    if (!spreadsheetProblem(error, res)) throw error;
  }
});

router.post("/import/apply", requireManageCatalogue, async (req: AuthRequest, res) => {
  const body = applySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Choose a file to upload" });
    return;
  }
  try {
    const bytes = decodeUpload(body.data.contentBase64);
    const analysis = await analyseCatalogueUpload(await readUpload(bytes, CATALOGUE_SHEET));
    const result = await applyCatalogueUpload(
      analysis,
      body.data.decisions,
      body.data.duplicateDefault,
      body.data.fileName,
      req.pharmacy!.sub,
    );
    await writeAudit({
      actorType: "hq",
      actorId: req.pharmacy!.sub,
      actorName: req.pharmacy!.name,
      action: "drug.bulk_upload",
      entityType: "drug",
      details: {
        fileName: body.data.fileName,
        sha256: fileFingerprint(bytes),
        rows: analysis.rows.length,
        added: result.added,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
        listingsTakenDown: result.listingsTakenDown,
      },
    });
    res.json(result);
  } catch (error) {
    if (error instanceof CatalogueDecisionsMissing) {
      res.status(409).json({ error: error.message, code: "DUPLICATE_DECISIONS_NEEDED", rows: error.rows });
      return;
    }
    if (!spreadsheetProblem(error, res)) throw error;
  }
});

export default router;
