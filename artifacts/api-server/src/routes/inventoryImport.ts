import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Response } from "express";
import { db } from "@workspace/db";
import { pharmaciesTable } from "@workspace/db/schema";
import { safeRouter } from "../lib/safeRouter.js";
import type { AuthRequest } from "../middlewares/auth.js";
import { writeAudit } from "../lib/audit.js";
import {
  analyseInventoryUpload,
  applyInventoryUpload,
  DecisionsMissing,
  fileFingerprint,
  INVENTORY_SHEET,
  inventoryWorkbook,
  publicRows,
  summarise,
} from "../lib/inventory/bulk.js";
import { decodeUpload, readUpload, SpreadsheetError } from "../lib/spreadsheets/table.js";

/**
 * Bulk inventory routes, mounted twice: for a pharmacy's own stock
 * (/pharmacy/inventory/...) and for HQ acting on a pharmacy's behalf
 * (/hq/pharmacies/:pharmacyId/inventory/...). Both run exactly the same
 * checks; only where the pharmacy comes from differs.
 */

const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentBase64: z.string().min(1),
});

const applySchema = uploadSchema.extend({
  decisions: z.record(z.string(), z.enum(["override", "skip"])).default({}),
  duplicateDefault: z.enum(["override", "skip"]).nullable().default(null),
});

type Scope = "pharmacy" | "hq";

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "pharmacy";
}

async function resolvePharmacy(scope: Scope, req: AuthRequest, res: Response) {
  const pharmacyId = scope === "pharmacy" ? req.pharmacy!.sub : (req.params.pharmacyId as string);
  if (!z.string().uuid().safeParse(pharmacyId).success) {
    res.status(404).json({ error: "Pharmacy not found" });
    return null;
  }
  const [pharmacy] = await db
    .select({ id: pharmaciesTable.id, name: pharmaciesTable.name })
    .from(pharmaciesTable)
    .where(eq(pharmaciesTable.id, pharmacyId))
    .limit(1);
  if (!pharmacy) {
    res.status(404).json({ error: "Pharmacy not found" });
    return null;
  }
  return pharmacy;
}

function spreadsheetProblem(error: unknown, res: Response): boolean {
  if (error instanceof SpreadsheetError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  return false;
}

export function inventoryImportRouter(scope: Scope) {
  const router = safeRouter({ mergeParams: true });

  router.get("/import/template", async (req: AuthRequest, res) => {
    const pharmacy = await resolvePharmacy(scope, req, res);
    if (!pharmacy) return;
    res.json(await inventoryWorkbook(null, "MobiCare inventory template.xlsx"));
  });

  router.get("/export", async (req: AuthRequest, res) => {
    const pharmacy = await resolvePharmacy(scope, req, res);
    if (!pharmacy) return;
    const date = new Date().toISOString().slice(0, 10);
    res.json(await inventoryWorkbook(pharmacy.id, `${slug(pharmacy.name)}-inventory-${date}.xlsx`));
  });

  router.post("/import/preview", async (req: AuthRequest, res) => {
    const body = uploadSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Choose a file to upload" });
      return;
    }
    const pharmacy = await resolvePharmacy(scope, req, res);
    if (!pharmacy) return;
    try {
      const table = await readUpload(decodeUpload(body.data.contentBase64), INVENTORY_SHEET);
      const analysis = await analyseInventoryUpload(pharmacy.id, table);
      const rows = publicRows(analysis);
      res.json({ fileName: body.data.fileName, summary: summarise(rows), rows });
    } catch (error) {
      if (!spreadsheetProblem(error, res)) throw error;
    }
  });

  router.post("/import/apply", async (req: AuthRequest, res) => {
    const body = applySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Choose a file to upload" });
      return;
    }
    const pharmacy = await resolvePharmacy(scope, req, res);
    if (!pharmacy) return;
    try {
      const bytes = decodeUpload(body.data.contentBase64);
      // Checked again from scratch: stock may have changed since the preview.
      const analysis = await analyseInventoryUpload(pharmacy.id, await readUpload(bytes, INVENTORY_SHEET));
      const result = await applyInventoryUpload(
        pharmacy.id,
        analysis,
        body.data.decisions,
        body.data.duplicateDefault,
        body.data.fileName,
      );
      await writeAudit({
        actorType: scope,
        actorId: req.pharmacy!.sub,
        actorName: req.pharmacy!.name,
        action: "inventory.bulk_upload",
        entityType: "pharmacy",
        entityId: pharmacy.id,
        details: {
          fileName: body.data.fileName,
          sha256: fileFingerprint(bytes),
          rows: analysis.rows.length,
          added: result.added,
          updated: result.updated,
          removed: result.removed,
          sentForReview: result.sentForReview,
          skipped: result.skipped,
          failed: result.failed,
          onBehalfOf: scope === "hq" ? pharmacy.name : undefined,
        },
      });
      res.json(result);
    } catch (error) {
      if (error instanceof DecisionsMissing) {
        res.status(409).json({ error: error.message, code: "DUPLICATE_DECISIONS_NEEDED", rows: error.rows });
        return;
      }
      if (!spreadsheetProblem(error, res)) throw error;
    }
  });

  return router;
}
