import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  drugCatalogueTable,
  DRUG_CATEGORY_TAXONOMY,
  DRUG_PRIMARY_CATEGORIES,
  DRUG_SUBCATEGORIES,
  isValidDrugCategoryPair,
} from "@workspace/db/schema";
import { and, eq, ne, or, sql } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { listsFromVariants } from "../../lib/catalogue/variants.js";

const router = safeRouter();
const primaryCategorySchema = z.enum(
  DRUG_PRIMARY_CATEGORIES as [string, ...string[]],
);
const subcategorySchema = z.enum(DRUG_SUBCATEGORIES as [string, ...string[]]);

// ── Master catalogue (approved drugs only for pharmacy view) ──────────────────
router.get("/", async (_req, res) => {
  const drugs = await db
    .select()
    .from(drugCatalogueTable)
    .where(eq(drugCatalogueTable.isApproved, true))
    .orderBy(drugCatalogueTable.name);

  res.json(drugs);
});

router.get("/categories", (_req, res) => {
  res.json(DRUG_CATEGORY_TAXONOMY);
});

// ── Propose a new drug ────────────────────────────────────────────────────────
router.post("/", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;

  const body = z
    .object({
      name: z.string().min(2),
      genericName: z.string().min(2),
      strength: z.string().trim().min(1).max(50),
      form: z.string().trim().min(1).max(50),
      suggestedCategory: primaryCategorySchema,
      suggestedSubcategory: subcategorySchema,
      description: z.string().optional(),
      // Pharmacies may NOT assign tier — HQ owns tier classification.
      // The proposal starts at tier 3 (OTC) pending HQ review.
      unit: z.string().min(1).default("tablets"),
    })
    .safeParse(req.body);

  if (!body.success) {
    res
      .status(400)
      .json({ error: "Validation failed", issues: body.error.issues });
    return;
  }
  if (
    !isValidDrugCategoryPair(
      body.data.suggestedCategory,
      body.data.suggestedSubcategory,
    )
  ) {
    res
      .status(400)
      .json({
        error: "The selected subcategory does not belong to that category",
      });
    return;
  }
  if (body.data.suggestedSubcategory === "other" && !body.data.description?.trim()) {
    res.status(400).json({
      error: "An explanation is required when selecting Other; HQ will review the request.",
    });
    return;
  }

  // The same medicine must not end up in the catalogue twice: one already
  // approved is listed from the catalogue, and one already requested (by any
  // pharmacy, or uploaded by HQ) is waiting for HQ.
  const [existing] = await db
    .select({ name: drugCatalogueTable.name, isApproved: drugCatalogueTable.isApproved })
    .from(drugCatalogueTable)
    .where(
      and(
        ne(drugCatalogueTable.reviewStatus, "rejected"),
        or(
          sql`lower(${drugCatalogueTable.name}) = lower(${body.data.name.trim()})`,
          sql`lower(${drugCatalogueTable.genericName}) = lower(${body.data.name.trim()})`,
        ),
      ),
    )
    .limit(1);
  if (existing) {
    res.status(409).json({
      error: existing.isApproved
        ? `${existing.name} is already in the catalogue. Add it from the catalogue list instead.`
        : `${existing.name} is already waiting for MobiCare HQ approval. You can list it once it is approved.`,
      code: "DRUG_ALREADY_IN_CATALOGUE",
    });
    return;
  }

  const lists = listsFromVariants([{ strength: body.data.strength, form: body.data.form }]);
  const [inserted] = await db
    .insert(drugCatalogueTable)
    .values({
      name: body.data.name,
      genericName: body.data.genericName,
      description: body.data.description,
      unit: body.data.unit,
      ...lists,
      primaryCategory: body.data.suggestedCategory,
      subcategory: body.data.suggestedSubcategory,
      tier: "3", // Provisional — HQ will review and assign correct tier
      isApproved: false, // Held for HQ review before it becomes listable
      reviewStatus: "pending",
      proposedByPharmacyId: pharmacyId,
    })
    .returning();

  await writeAudit({
    actorType: "pharmacy",
    actorId: pharmacyId,
    actorName: req.pharmacy!.name,
    action: "drug.propose",
    entityType: "drug",
    entityId: inserted!.id,
    details: {
      name: inserted!.name,
      genericName: inserted!.genericName,
      strength: body.data.strength,
      form: body.data.form,
      suggestedCategory: body.data.suggestedCategory,
      suggestedSubcategory: body.data.suggestedSubcategory,
      otherCategoryExplanation:
        body.data.suggestedSubcategory === "other" ? body.data.description : undefined,
    },
  });

  res.status(202).json({
    ...inserted,
    message:
      "Drug proposal submitted. It is not listable until MobiCare HQ reviews and approves it. HQ will also assign the correct medicine tier.",
  });
});

export default router;
