import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  drugCatalogueTable,
  pharmacyInventoryTable,
  orderItemsTable,
  DRUG_PRIMARY_CATEGORIES,
  DRUG_SUBCATEGORIES,
  isValidDrugCategoryPair,
} from "@workspace/db/schema";
import { and, eq, desc, count, ne, sql } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { createPharmacyNotification } from "../../lib/pharmacyNotifications.js";

const router = safeRouter();

const TIERS = ["1", "2", "3"] as const;
const primaryCategorySchema = z.enum(
  DRUG_PRIMARY_CATEGORIES as [string, ...string[]],
);
const subcategorySchema = z.enum(DRUG_SUBCATEGORIES as [string, ...string[]]);

function oneBusinessDayAfter(createdAt: Date): string {
  const due = new Date(createdAt);
  do {
    due.setUTCDate(due.getUTCDate() + 1);
  } while (due.getUTCDay() === 0 || due.getUTCDay() === 6);
  return due.toISOString();
}

function withReviewDueAt<T extends { createdAt: Date }>(drug: T) {
  return { ...drug, reviewDueAt: oneBusinessDayAfter(drug.createdAt) };
}

/** Tier 1 (controlled) MUST carry a max-units-per-order cap — server-enforced. */
function validateTierCap(
  tier: string,
  maxUnitsPerOrder: number | null | undefined,
): string | null {
  if (tier === "1" && (maxUnitsPerOrder == null || maxUnitsPerOrder < 1)) {
    return "Tier 1 (controlled) drugs require maxUnitsPerOrder of at least 1";
  }
  return null;
}

// ── GET /hq/drugs?status=held|approved ───────────────────────────────────────
router.get("/", async (req, res) => {
  const status = req.query.status as string | undefined;
  let rows;
  if (status === "held") {
    rows = await db
      .select()
      .from(drugCatalogueTable)
      .where(eq(drugCatalogueTable.isApproved, false))
      .orderBy(desc(drugCatalogueTable.createdAt));
  } else if (status === "approved") {
    rows = await db
      .select()
      .from(drugCatalogueTable)
      .where(eq(drugCatalogueTable.isApproved, true))
      .orderBy(desc(drugCatalogueTable.createdAt));
  } else if (status === "rejected") {
    rows = await db
      .select()
      .from(drugCatalogueTable)
      .where(eq(drugCatalogueTable.reviewStatus, "rejected"))
      .orderBy(desc(drugCatalogueTable.createdAt));
  } else {
    rows = await db
      .select()
      .from(drugCatalogueTable)
      .orderBy(desc(drugCatalogueTable.createdAt));
  }
  res.json(rows.map(withReviewDueAt));
});

// ── POST /hq/drugs — add to master catalogue (approved immediately) ──────────
router.post("/", async (req: AuthRequest, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      genericName: z.string().optional(),
      description: z.string().optional(),
      tier: z.enum(TIERS),
      unit: z.string().min(1).default("tablets"),
      commonStrengths: z.array(z.string().trim().min(1).max(50)).min(1),
      commonForms: z.array(z.string().trim().min(1).max(50)).min(1),
      primaryCategory: primaryCategorySchema,
      subcategory: subcategorySchema,
      maxUnitsPerOrder: z.number().min(1).nullable().optional(),
    })
    .safeParse(req.body);

  if (!body.success) {
    res
      .status(400)
      .json({ error: body.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const capError = validateTierCap(body.data.tier, body.data.maxUnitsPerOrder);
  if (capError) {
    res.status(400).json({ error: capError });
    return;
  }
  if (
    !isValidDrugCategoryPair(body.data.primaryCategory, body.data.subcategory)
  ) {
    res
      .status(400)
      .json({
        error: "The selected subcategory does not belong to that category",
      });
    return;
  }

  const [created] = await db
    .insert(drugCatalogueTable)
    .values({
      name: body.data.name,
      genericName: body.data.genericName ?? null,
      description: body.data.description ?? null,
      tier: body.data.tier,
      unit: body.data.unit,
      commonStrengths: [...new Set(body.data.commonStrengths)],
      commonForms: [...new Set(body.data.commonForms)],
      primaryCategory: body.data.primaryCategory,
      subcategory: body.data.subcategory,
      maxUnitsPerOrder: body.data.maxUnitsPerOrder ?? null,
      isApproved: true,
      reviewStatus: "approved",
      reviewedAt: new Date(),
      reviewedByHqStaffId: req.pharmacy!.sub,
    })
    .returning();

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "drug.create",
    entityType: "drug",
    entityId: created!.id,
    details: {
      name: created!.name,
      tier: created!.tier,
      maxUnitsPerOrder: created!.maxUnitsPerOrder,
    },
  });

  res.status(201).json(withReviewDueAt(created!));
});

// ── PATCH /hq/drugs/:id — change tier / cap / release held drug ──────────────
router.patch("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const body = z
    .object({
      tier: z.enum(TIERS).optional(),
      maxUnitsPerOrder: z.number().min(1).nullable().optional(),
      isApproved: z.boolean().optional(), // true = release a held (pharmacy-proposed) drug
      reviewStatus: z.enum(["approved", "rejected"]).optional(),
      rejectionReason: z.string().trim().min(5).max(500).nullable().optional(),
      name: z.string().min(1).optional(),
      genericName: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      unit: z.string().min(1).optional(),
      commonStrengths: z
        .array(z.string().trim().min(1).max(50))
        .min(1)
        .optional(),
      commonForms: z.array(z.string().trim().min(1).max(50)).min(1).optional(),
      primaryCategory: primaryCategorySchema.optional(),
      subcategory: subcategorySchema.optional(),
    })
    .safeParse(req.body);

  if (!body.success || Object.keys(body.data).length === 0) {
    res.status(400).json({ error: "No valid fields provided" });
    return;
  }

  const [existing] = await db
    .select()
    .from(drugCatalogueTable)
    .where(eq(drugCatalogueTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Drug not found" });
    return;
  }

  // Enforce the Tier-1 cap on the RESULTING record, not just the patch payload.
  const resultingTier = body.data.tier ?? existing.tier;
  const resultingCap =
    body.data.maxUnitsPerOrder !== undefined
      ? body.data.maxUnitsPerOrder
      : existing.maxUnitsPerOrder;
  const capError = validateTierCap(resultingTier, resultingCap);
  if (capError) {
    res.status(400).json({ error: capError });
    return;
  }
  const resultingPrimaryCategory =
    body.data.primaryCategory ?? existing.primaryCategory;
  const resultingSubcategory = body.data.subcategory ?? existing.subcategory;
  if (
    resultingPrimaryCategory &&
    resultingSubcategory &&
    !isValidDrugCategoryPair(resultingPrimaryCategory, resultingSubcategory)
  ) {
    res
      .status(400)
      .json({
        error: "The selected subcategory does not belong to that category",
      });
    return;
  }

  const requestedReviewStatus =
    body.data.reviewStatus ??
    (body.data.isApproved === true && !existing.isApproved
      ? "approved"
      : undefined);
  if (requestedReviewStatus === "approved") {
    if (
      !resultingPrimaryCategory ||
      !resultingSubcategory ||
      (body.data.commonStrengths ?? existing.commonStrengths).length === 0 ||
      (body.data.commonForms ?? existing.commonForms).length === 0
    ) {
      res.status(400).json({
        error:
          "Approved catalogue drugs require category, subcategory, common strengths, and common forms",
      });
      return;
    }
  }
  if (
    requestedReviewStatus === "rejected" &&
    !(body.data.rejectionReason ?? "").trim()
  ) {
    res.status(400).json({ error: "A rejection reason is required" });
    return;
  }

  const updateValues = {
    ...body.data,
    commonStrengths: body.data.commonStrengths
      ? [...new Set(body.data.commonStrengths)]
      : undefined,
    commonForms: body.data.commonForms
      ? [...new Set(body.data.commonForms)]
      : undefined,
    isApproved: requestedReviewStatus
      ? requestedReviewStatus === "approved"
      : body.data.isApproved,
    reviewStatus: requestedReviewStatus,
    rejectionReason:
      requestedReviewStatus === "approved" ? null : body.data.rejectionReason,
    reviewedAt: requestedReviewStatus ? new Date() : undefined,
    reviewedByHqStaffId: requestedReviewStatus ? req.pharmacy!.sub : undefined,
    updatedAt: new Date(),
  };

  let updated: typeof drugCatalogueTable.$inferSelect | undefined;
  try {
    updated = await db.transaction(async (tx) => {
      // A proposal is a held catalogue request. Releasing it and making its
      // requesting pharmacy able to price/stock it happen in one transaction.
      if (requestedReviewStatus === "approved" && !existing.isApproved) {
        const [duplicate] = await tx
          .select({ id: drugCatalogueTable.id })
          .from(drugCatalogueTable)
          .where(
            and(
              ne(drugCatalogueTable.id, id),
              eq(drugCatalogueTable.isApproved, true),
              sql`lower(${drugCatalogueTable.name}) = lower(${body.data.name ?? existing.name})`,
              sql`${body.data.commonStrengths?.[0] ?? existing.commonStrengths[0]} = any(${drugCatalogueTable.commonStrengths})`,
              sql`${body.data.commonForms?.[0] ?? existing.commonForms[0]} = any(${drugCatalogueTable.commonForms})`,
            ),
          )
          .limit(1);
        if (duplicate) throw Object.assign(new Error("DUPLICATE_DRUG"), { code: "DUPLICATE_DRUG", duplicateId: duplicate.id });
      }
      const [releasedDrug] = await tx
        .update(drugCatalogueTable)
        .set(updateValues)
        .where(and(eq(drugCatalogueTable.id, id), eq(drugCatalogueTable.reviewStatus, existing.reviewStatus)))
        .returning();
      if (!releasedDrug) throw Object.assign(new Error("REQUEST_CHANGED"), { code: "REQUEST_CHANGED" });
      if (requestedReviewStatus === "approved" && !existing.isApproved && existing.proposedByPharmacyId) {
        await tx.insert(pharmacyInventoryTable).values({
          pharmacyId: existing.proposedByPharmacyId,
          drugId: releasedDrug.id,
          strength: body.data.commonStrengths?.[0] ?? existing.commonStrengths[0] ?? null,
          form: body.data.commonForms?.[0] ?? existing.commonForms[0] ?? null,
          unitOfSale: releasedDrug.unit,
          primaryCategory: resultingPrimaryCategory,
          subcategory: resultingSubcategory,
          priceLeones: "0.00",
          stockQuantity: 0,
          completionStatus: "incomplete",
          isActive: true,
        }).onConflictDoNothing();
      }
      return releasedDrug;
    });
  } catch (error: any) {
    if (error?.code === "DUPLICATE_DRUG") {
      res.status(409).json({ error: "An approved drug with the same name, strength, and form already exists", duplicateDrugId: error.duplicateId });
      return;
    }
    if (error?.code === "REQUEST_CHANGED") {
      res.status(409).json({ error: "Drug request changed while it was being reviewed" });
      return;
    }
    throw error;
  }

  const released = requestedReviewStatus === "approved" && !existing.isApproved;
  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action:
      requestedReviewStatus === "rejected"
        ? "drug.reject"
        : released
          ? "drug.release"
          : "drug.update",
    entityType: "drug",
    entityId: id,
    details: { changes: updateValues },
  });
  if (requestedReviewStatus && existing.proposedByPharmacyId) {
    void createPharmacyNotification({
      pharmacyId: existing.proposedByPharmacyId,
      title: requestedReviewStatus === "approved" ? "Drug request approved" : "Drug request rejected",
      body: requestedReviewStatus === "approved"
        ? `${updated!.name} is now available in your catalogue. Add a price and stock to make it searchable by patients.`
        : `Your request for ${updated!.name} was rejected: ${body.data.rejectionReason}`,
      type: "drug_request_review",
      referenceId: updated!.id,
    });
  }

  res.json(withReviewDueAt(updated!));
});

// ── DELETE /hq/drugs/:id — remove from active catalogue safely ──────────────
router.delete("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const [existing] = await db
    .select()
    .from(drugCatalogueTable)
    .where(eq(drugCatalogueTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Drug not found" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [[inventoryRefs], [orderRefs]] = await Promise.all([
      tx
        .select({ count: count() })
        .from(pharmacyInventoryTable)
        .where(eq(pharmacyInventoryTable.drugId, id)),
      tx
        .select({ count: count() })
        .from(orderItemsTable)
        .where(eq(orderItemsTable.drugId, id)),
    ]);
    const referenced =
      Number(inventoryRefs?.count ?? 0) > 0 ||
      Number(orderRefs?.count ?? 0) > 0;
    if (referenced) {
      await tx
        .update(pharmacyInventoryTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(pharmacyInventoryTable.drugId, id));
      await tx
        .update(drugCatalogueTable)
        .set({
          isApproved: false,
          reviewStatus: "rejected",
          rejectionReason: "Removed from the MobiCare catalogue by HQ",
          reviewedAt: new Date(),
          reviewedByHqStaffId: req.pharmacy!.sub,
          updatedAt: new Date(),
        })
        .where(eq(drugCatalogueTable.id, id));
      return "retired" as const;
    }
    await tx
      .delete(drugCatalogueTable)
      .where(eq(drugCatalogueTable.id, id));
    return "deleted" as const;
  });

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: `drug.${result}`,
    entityType: "drug",
    entityId: id,
    details: { name: existing.name },
  });
  res.json({ removed: true, mode: result });
});

export default router;
