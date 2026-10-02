import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  drugCatalogueTable,
  pharmacyInventoryTable,
  orderItemsTable,
  DRUG_CATEGORY_TAXONOMY,
  DRUG_PRIMARY_CATEGORIES,
  DRUG_SUBCATEGORIES,
  isValidDrugCategoryPair,
} from "@workspace/db/schema";
import { and, eq, desc, count, inArray, ne, sql } from "drizzle-orm";
import { AuthRequest, requireManageCatalogue } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { createPharmacyNotification } from "../../lib/pharmacyNotifications.js";
import { cleanForms, cleanList, listsFromVariants, variantsOf, withLists } from "../../lib/catalogue/variants.js";

const router = safeRouter();

const TIERS = ["1", "2", "3"] as const;
const primaryCategorySchema = z.enum(
  DRUG_PRIMARY_CATEGORIES as [string, ...string[]],
);
const subcategorySchema = z.enum(DRUG_SUBCATEGORIES as [string, ...string[]]);

const listSchema = z.array(z.string().trim().min(1).max(50));
const variantsSchema = z
  .array(z.object({ strength: z.string().trim().min(1).max(50), form: z.string().trim().min(1).max(50) }))
  .min(1);

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

// ── GET /hq/drugs/categories — the category taxonomy for the catalogue form ──
// The same list pharmacies see. HQ has its own route because the pharmacy one
// admits pharmacy logins only, which left HQ's category dropdowns empty.
router.get("/categories", (_req, res) => {
  res.json(DRUG_CATEGORY_TAXONOMY);
});

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
router.post("/", requireManageCatalogue, async (req: AuthRequest, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      genericName: z.string().optional(),
      description: z.string().optional(),
      tier: z.enum(TIERS),
      unit: z.string().min(1).default("tablets"),
      commonStrengths: listSchema.optional(),
      commonForms: listSchema.optional(),
      // The strength + form combinations it comes in. When given, the
      // strength and form lists are taken from these.
      variants: variantsSchema.optional(),
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
  const lists = body.data.variants
    ? listsFromVariants(body.data.variants)
    : { commonStrengths: cleanList(body.data.commonStrengths ?? []), commonForms: cleanForms(body.data.commonForms ?? []), variants: [] };
  if (!lists.commonStrengths.length || !lists.commonForms.length) {
    res.status(400).json({ error: "Add at least one strength and one form" });
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
      ...lists,
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

type Drug = typeof drugCatalogueTable.$inferSelect;
type Staff = { sub: string; name: string };

class ReviewError extends Error {
  constructor(public readonly status: number, message: string, public readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

/**
 * Saves HQ's changes to one catalogue entry, including approving or rejecting
 * a held one, with every rule a release has to pass. Used by the edit form
 * and by approving many held medicines at once, so both behave the same.
 */
async function saveReview(
  existing: Drug,
  changes: {
    tier?: "1" | "2" | "3";
    maxUnitsPerOrder?: number | null;
    isApproved?: boolean;
    reviewStatus?: "approved" | "rejected";
    rejectionReason?: string | null;
    name?: string;
    genericName?: string | null;
    description?: string | null;
    unit?: string;
    commonStrengths?: string[];
    commonForms?: string[];
    variants?: Array<{ strength: string; form: string }>;
    primaryCategory?: string;
    subcategory?: string;
  },
  staff: Staff,
): Promise<Drug> {
  const id = existing.id;
  // Enforce the Tier-1 cap on the RESULTING record, not just the patch payload.
  const resultingTier = changes.tier ?? existing.tier;
  const resultingCap =
    changes.maxUnitsPerOrder !== undefined ? changes.maxUnitsPerOrder : existing.maxUnitsPerOrder;
  const capError = validateTierCap(resultingTier, resultingCap);
  if (capError) throw new ReviewError(400, capError);
  const resultingPrimaryCategory = changes.primaryCategory ?? existing.primaryCategory;
  const resultingSubcategory = changes.subcategory ?? existing.subcategory;
  if (
    resultingPrimaryCategory &&
    resultingSubcategory &&
    !isValidDrugCategoryPair(resultingPrimaryCategory, resultingSubcategory)
  ) {
    throw new ReviewError(400, "The selected subcategory does not belong to that category");
  }

  // The strengths, forms and combinations after this change.
  const lists = changes.variants
    ? listsFromVariants(changes.variants)
    : changes.commonStrengths || changes.commonForms
      ? withLists(existing, changes.commonStrengths ?? existing.commonStrengths, changes.commonForms ?? existing.commonForms)
      : null;
  const resultingLists = lists ?? existing;

  const requestedReviewStatus =
    changes.reviewStatus ??
    (changes.isApproved === true && !existing.isApproved ? "approved" : undefined);
  if (requestedReviewStatus === "approved") {
    const missing = [
      !resultingPrimaryCategory || !resultingSubcategory ? "a category and subcategory" : null,
      resultingLists.commonStrengths.length === 0 ? "a strength" : null,
      resultingLists.commonForms.length === 0 ? "a form" : null,
    ].filter(Boolean);
    if (missing.length) {
      throw new ReviewError(400, `Needs ${missing.join(", ")} before it can be approved.`);
    }
  }
  if (requestedReviewStatus === "rejected" && !(changes.rejectionReason ?? "").trim()) {
    throw new ReviewError(400, "A rejection reason is required");
  }

  const { variants: _variants, commonStrengths: _strengths, commonForms: _forms, ...rest } = changes;
  const updateValues = {
    ...rest,
    ...(lists ?? {}),
    isApproved: requestedReviewStatus ? requestedReviewStatus === "approved" : changes.isApproved,
    reviewStatus: requestedReviewStatus,
    rejectionReason: requestedReviewStatus === "approved" ? null : changes.rejectionReason,
    reviewedAt: requestedReviewStatus ? new Date() : undefined,
    reviewedByHqStaffId: requestedReviewStatus ? staff.sub : undefined,
    updatedAt: new Date(),
  };
  const releasing = requestedReviewStatus === "approved" && !existing.isApproved;
  const firstVariant = variantsOf(resultingLists)[0];

  const updated = await db.transaction(async (tx) => {
    // A proposal is a held catalogue request. Releasing it and making its
    // requesting pharmacy able to price/stock it happen in one transaction.
    if (releasing) {
      const [duplicate] = await tx
        .select({ id: drugCatalogueTable.id })
        .from(drugCatalogueTable)
        .where(
          and(
            ne(drugCatalogueTable.id, id),
            eq(drugCatalogueTable.isApproved, true),
            sql`lower(${drugCatalogueTable.name}) = lower(${changes.name ?? existing.name})`,
            sql`lower(${firstVariant?.strength ?? ""}) = any(select lower(value) from unnest(${drugCatalogueTable.commonStrengths}) as value)`,
            sql`lower(${firstVariant?.form ?? ""}) = any(select lower(value) from unnest(${drugCatalogueTable.commonForms}) as value)`,
          ),
        )
        .limit(1);
      if (duplicate) {
        throw new ReviewError(409, "An approved drug with the same name, strength, and form already exists", { duplicateDrugId: duplicate.id });
      }
    }
    const [releasedDrug] = await tx
      .update(drugCatalogueTable)
      .set(updateValues)
      .where(and(eq(drugCatalogueTable.id, id), eq(drugCatalogueTable.reviewStatus, existing.reviewStatus)))
      .returning();
    if (!releasedDrug) throw new ReviewError(409, "Drug request changed while it was being reviewed");
    // Listings sent in a bulk upload already exist, priced and stocked:
    // they take the approved category instead of getting a placeholder.
    const [uploadedListing] = releasing
      ? await tx
          .update(pharmacyInventoryTable)
          .set({
            primaryCategory: resultingPrimaryCategory,
            subcategory: resultingSubcategory,
            requiresHqReview: false,
            updatedAt: new Date(),
          })
          .where(eq(pharmacyInventoryTable.drugId, id))
          .returning({ id: pharmacyInventoryTable.id })
      : [];
    if (requestedReviewStatus === "rejected") {
      await tx
        .update(pharmacyInventoryTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(pharmacyInventoryTable.drugId, id));
    }
    if (releasing && existing.proposedByPharmacyId && !uploadedListing) {
      await tx.insert(pharmacyInventoryTable).values({
        pharmacyId: existing.proposedByPharmacyId,
        drugId: releasedDrug.id,
        strength: firstVariant?.strength ?? null,
        form: firstVariant?.form ?? null,
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

  await writeAudit({
    actorType: "hq",
    actorId: staff.sub,
    actorName: staff.name,
    action:
      requestedReviewStatus === "rejected"
        ? "drug.reject"
        : releasing
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
        ? `${updated.name} is now available in your catalogue. Add a price and stock to make it searchable by patients.`
        : `Your request for ${updated.name} was rejected: ${changes.rejectionReason}`,
      type: "drug_request_review",
      referenceId: updated.id,
    });
  }
  return updated;
}

// ── POST /hq/drugs/approve — approve several held medicines at once ──────────
// For a bulk catalogue upload: each one passes the same checks as approving
// it from its own form. Ones that cannot be approved yet (no category, a
// controlled medicine without a cap) are reported and stay held.
router.post("/approve", requireManageCatalogue, async (req: AuthRequest, res) => {
  const body = z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Choose the medicines to approve" });
    return;
  }
  const held = await db
    .select()
    .from(drugCatalogueTable)
    .where(and(inArray(drugCatalogueTable.id, [...new Set(body.data.ids)]), eq(drugCatalogueTable.isApproved, false), eq(drugCatalogueTable.reviewStatus, "pending")));
  const approved: string[] = [];
  const notApproved: Array<{ id: string; name: string; reason: string }> = [];
  for (const drug of held.sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      await saveReview(drug, { isApproved: true, reviewStatus: "approved" }, req.pharmacy!);
      approved.push(drug.id);
    } catch (error) {
      if (!(error instanceof ReviewError)) throw error;
      notApproved.push({ id: drug.id, name: drug.name, reason: error.message });
    }
  }
  const missing = body.data.ids.length - held.length;
  res.json({ approved: approved.length, notApproved, alreadyReviewed: Math.max(missing, 0) });
});

// ── PATCH /hq/drugs/:id — change tier / cap / release held drug ──────────────
router.patch("/:id", requireManageCatalogue, async (req: AuthRequest, res) => {
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
      commonStrengths: listSchema.min(1).optional(),
      commonForms: listSchema.min(1).optional(),
      variants: variantsSchema.optional(),
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

  try {
    const updated = await saveReview(existing, body.data, req.pharmacy!);
    res.json(withReviewDueAt(updated));
  } catch (error) {
    if (!(error instanceof ReviewError)) throw error;
    res.status(error.status).json({ error: error.message, ...error.extra });
  }
});

// ── DELETE /hq/drugs/:id — remove from active catalogue safely ──────────────
router.delete("/:id", requireManageCatalogue, async (req: AuthRequest, res) => {
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
