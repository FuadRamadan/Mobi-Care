import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { drugCatalogueTable, pharmaciesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";

const router = Router();

// ── Master catalogue (approved drugs only for pharmacy view) ──────────────────
router.get("/", async (_req, res) => {
  const drugs = await db
    .select()
    .from(drugCatalogueTable)
    .where(eq(drugCatalogueTable.isApproved, true))
    .orderBy(drugCatalogueTable.name);

  res.json(drugs);
});

// ── Propose a new drug ────────────────────────────────────────────────────────
router.post("/", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;

  const body = z.object({
    name: z.string().min(2),
    genericName: z.string().optional(),
    description: z.string().optional(),
    // Pharmacies may NOT assign tier — HQ owns tier classification.
    // The proposal starts at tier 3 (OTC) pending HQ review.
    unit: z.string().min(1).default("tablets"),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "Validation failed", issues: body.error.issues });
    return;
  }

  const [inserted] = await db
    .insert(drugCatalogueTable)
    .values({
      ...body.data,
      tier: "3",         // Provisional — HQ will review and assign correct tier
      isApproved: false, // Held for HQ review before it becomes listable
      proposedByPharmacyId: pharmacyId,
    })
    .returning();

  res.status(202).json({
    ...inserted,
    message:
      "Drug proposal submitted. It is not listable until MobiCare HQ reviews and approves it. HQ will also assign the correct medicine tier.",
  });
});

export default router;
