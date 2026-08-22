import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import { drugCatalogueTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";

const router = safeRouter();

const TIERS = ["1", "2", "3"] as const;

/** Tier 1 (controlled) MUST carry a max-units-per-order cap — server-enforced. */
function validateTierCap(tier: string, maxUnitsPerOrder: number | null | undefined): string | null {
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
    rows = await db.select().from(drugCatalogueTable)
      .where(eq(drugCatalogueTable.isApproved, false))
      .orderBy(desc(drugCatalogueTable.createdAt));
  } else if (status === "approved") {
    rows = await db.select().from(drugCatalogueTable)
      .where(eq(drugCatalogueTable.isApproved, true))
      .orderBy(desc(drugCatalogueTable.createdAt));
  } else {
    rows = await db.select().from(drugCatalogueTable)
      .orderBy(desc(drugCatalogueTable.createdAt));
  }
  res.json(rows);
});

// ── POST /hq/drugs — add to master catalogue (approved immediately) ──────────
router.post("/", async (req: AuthRequest, res) => {
  const body = z.object({
    name: z.string().min(1),
    genericName: z.string().optional(),
    description: z.string().optional(),
    tier: z.enum(TIERS),
    unit: z.string().min(1).default("tablets"),
    maxUnitsPerOrder: z.number().min(1).nullable().optional(),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const capError = validateTierCap(body.data.tier, body.data.maxUnitsPerOrder);
  if (capError) { res.status(400).json({ error: capError }); return; }

  const [created] = await db
    .insert(drugCatalogueTable)
    .values({
      name: body.data.name,
      genericName: body.data.genericName ?? null,
      description: body.data.description ?? null,
      tier: body.data.tier,
      unit: body.data.unit,
      maxUnitsPerOrder: body.data.maxUnitsPerOrder ?? null,
      isApproved: true,
    })
    .returning();

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "drug.create",
    entityType: "drug",
    entityId: created!.id,
    details: { name: created!.name, tier: created!.tier, maxUnitsPerOrder: created!.maxUnitsPerOrder },
  });

  res.status(201).json(created);
});

// ── PATCH /hq/drugs/:id — change tier / cap / release held drug ──────────────
router.patch("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const body = z.object({
    tier: z.enum(TIERS).optional(),
    maxUnitsPerOrder: z.number().min(1).nullable().optional(),
    isApproved: z.boolean().optional(), // true = release a held (pharmacy-proposed) drug
    name: z.string().min(1).optional(),
    genericName: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    unit: z.string().min(1).optional(),
  }).safeParse(req.body);

  if (!body.success || Object.keys(body.data).length === 0) {
    res.status(400).json({ error: "No valid fields provided" });
    return;
  }

  const [existing] = await db.select().from(drugCatalogueTable)
    .where(eq(drugCatalogueTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Drug not found" }); return; }

  // Enforce the Tier-1 cap on the RESULTING record, not just the patch payload.
  const resultingTier = body.data.tier ?? existing.tier;
  const resultingCap =
    body.data.maxUnitsPerOrder !== undefined ? body.data.maxUnitsPerOrder : existing.maxUnitsPerOrder;
  const capError = validateTierCap(resultingTier, resultingCap);
  if (capError) { res.status(400).json({ error: capError }); return; }

  const [updated] = await db
    .update(drugCatalogueTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(drugCatalogueTable.id, id))
    .returning();

  const released = body.data.isApproved === true && !existing.isApproved;
  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: released ? "drug.release" : "drug.update",
    entityType: "drug",
    entityId: id,
    details: { changes: body.data },
  });

  res.json(updated);
});

export default router;
