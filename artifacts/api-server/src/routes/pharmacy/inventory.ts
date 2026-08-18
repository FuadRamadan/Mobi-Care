import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { pharmacyInventoryTable, drugCatalogueTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { pharmaciesTable } from "@workspace/db/schema";

const router = Router();

// ── List this pharmacy's inventory ────────────────────────────────────────────
router.get("/", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;

  const rows = await db
    .select({
      id: pharmacyInventoryTable.id,
      drugId: pharmacyInventoryTable.drugId,
      brand: pharmacyInventoryTable.brand,
      countryOfOrigin: pharmacyInventoryTable.countryOfOrigin,
      priceLeones: pharmacyInventoryTable.priceLeones,
      stockQuantity: pharmacyInventoryTable.stockQuantity,
      lowStockAlertAt: pharmacyInventoryTable.lowStockAlertAt,
      availableForDelivery: pharmacyInventoryTable.availableForDelivery,
      availableForCollection: pharmacyInventoryTable.availableForCollection,
      isActive: pharmacyInventoryTable.isActive,
      updatedAt: pharmacyInventoryTable.updatedAt,
      drug: {
        name: drugCatalogueTable.name,
        genericName: drugCatalogueTable.genericName,
        tier: drugCatalogueTable.tier,
        unit: drugCatalogueTable.unit,
      },
    })
    .from(pharmacyInventoryTable)
    .innerJoin(drugCatalogueTable, eq(pharmacyInventoryTable.drugId, drugCatalogueTable.id))
    .where(eq(pharmacyInventoryTable.pharmacyId, pharmacyId));

  res.json(rows);
});

// ── Add listing ───────────────────────────────────────────────────────────────
router.post("/", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;

  const body = z.object({
    drugId: z.string().uuid(),
    brand: z.string().max(100).optional(),
    countryOfOrigin: z.string().max(100).optional(),
    priceLeones: z.number().int().positive(),
    stockQuantity: z.number().int().min(0).default(0),
    lowStockAlertAt: z.number().int().min(0).default(10),
    availableForDelivery: z.boolean().default(true),
    availableForCollection: z.boolean().default(true),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "Validation failed", issues: body.error.issues });
    return;
  }

  // Check the drug exists and is approved
  const [drug] = await db
    .select()
    .from(drugCatalogueTable)
    .where(eq(drugCatalogueTable.id, body.data.drugId))
    .limit(1);

  if (!drug) { res.status(404).json({ error: "Drug not found in catalogue" }); return; }
  if (!drug.isApproved) {
    res.status(403).json({ error: "Drug is pending HQ approval and cannot be listed yet" });
    return;
  }

  // Controlled-substance authorisation check
  if (drug.tier === "1") {
    const [pharm] = await db
      .select({ auth: pharmaciesTable.controlledSubstanceAuthorized })
      .from(pharmaciesTable)
      .where(eq(pharmaciesTable.id, pharmacyId))
      .limit(1);

    if (!pharm?.auth) {
      res.status(403).json({
        error: "Only pharmacies authorised by MobiCare HQ can list Tier-1 controlled substances",
      });
      return;
    }
  }

  const [inserted] = await db
    .insert(pharmacyInventoryTable)
    .values({ ...body.data, pharmacyId })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    res.status(409).json({ error: "A listing for this drug already exists" });
    return;
  }

  await writeAudit({
    actorType: "pharmacy",
    actorId: pharmacyId,
    actorName: req.pharmacy!.name,
    action: "inventory.add",
    entityType: "inventory",
    entityId: inserted.id,
    details: { drugId: inserted.drugId, priceLeones: inserted.priceLeones },
  });

  res.status(201).json(inserted);
});

// ── Update listing ────────────────────────────────────────────────────────────
router.patch("/:id", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const id = req.params.id as string;

  const body = z.object({
    brand: z.string().max(100).optional(),
    countryOfOrigin: z.string().max(100).optional(),
    priceLeones: z.number().int().positive().optional(),
    stockQuantity: z.number().int().min(0).optional(),
    lowStockAlertAt: z.number().int().min(0).optional(),
    availableForDelivery: z.boolean().optional(),
    availableForCollection: z.boolean().optional(),
    isActive: z.boolean().optional(),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "Validation failed", issues: body.error.issues });
    return;
  }

  const [updated] = await db
    .update(pharmacyInventoryTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(
      and(eq(pharmacyInventoryTable.id, id), eq(pharmacyInventoryTable.pharmacyId, pharmacyId))
    )
    .returning();

  if (!updated) { res.status(404).json({ error: "Listing not found" }); return; }

  await writeAudit({
    actorType: "pharmacy",
    actorId: pharmacyId,
    actorName: req.pharmacy!.name,
    action: "inventory.update",
    entityType: "inventory",
    entityId: id,
    details: { changes: body.data },
  });

  res.json(updated);
});

// ── Delete listing ────────────────────────────────────────────────────────────
router.delete("/:id", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const id = req.params.id as string;

  const [deleted] = await db
    .delete(pharmacyInventoryTable)
    .where(
      and(eq(pharmacyInventoryTable.id, id), eq(pharmacyInventoryTable.pharmacyId, pharmacyId))
    )
    .returning();

  if (!deleted) { res.status(404).json({ error: "Listing not found" }); return; }

  await writeAudit({
    actorType: "pharmacy",
    actorId: pharmacyId,
    actorName: req.pharmacy!.name,
    action: "inventory.delete",
    entityType: "inventory",
    entityId: id,
    details: { drugId: deleted.drugId },
  });

  res.json({ message: "Listing removed" });
});

export default router;
