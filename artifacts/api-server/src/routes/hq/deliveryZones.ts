import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import { deliveryZoneFeesTable, deliveryZonesTable } from "@workspace/db/schema";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { AuthRequest, requireManageSettlements } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { isLatitude, isLongitude } from "../../lib/geo.js";
import {
  boundaryAreaSquareKm,
  validateBoundary,
  type Boundary,
} from "../../lib/delivery/geometry.js";
import { nextBusinessMidnight, zonesAt, type PricedZone } from "../../lib/delivery/pricing.js";
import {
  loadZones,
  overlappingZones,
  placePharmacies,
  pricedZones,
  type ZoneWithFees,
} from "../../lib/delivery/zones.js";

/**
 * Delivery zones. Any HQ staff member can see them (onboarding a pharmacy
 * shows which zone it falls in); drawing zones and setting fees takes the
 * settlements permission, because fees are money.
 */
const router = safeRouter();

/** A save refused because the zone would cover another zone's ground. */
class ZoneConflict extends Error {}

/** Le 1,000,000 in minor units: well above any plausible delivery fee. */
const MAX_FEE_MINOR = 100_000_000;

const feeSchema = z.number().int().min(0).max(MAX_FEE_MINOR);
const nameSchema = z.string().trim().min(2).max(60);
const descriptionSchema = z.string().trim().max(300);

function zoneJson(zone: ZoneWithFees) {
  return {
    id: zone.id,
    name: zone.name,
    description: zone.description,
    boundary: zone.boundary,
    isActive: zone.isActive,
    areaSquareKm: boundaryAreaSquareKm(zone.boundary as Boundary),
    currentFeeMinor: zone.currentFee?.feeMinor ?? null,
    scheduledFee: zone.scheduledFee
      ? {
          feeMinor: zone.scheduledFee.feeMinor,
          effectiveFrom: zone.scheduledFee.effectiveFrom.toISOString(),
        }
      : null,
    updatedAt: zone.updatedAt.toISOString(),
  };
}

function actor(req: AuthRequest) {
  return {
    actorType: "hq" as const,
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
  };
}

function overlapMessage(clashes: ZoneWithFees[]): string {
  const names = clashes.map((zone) => `"${zone.name}"`).join(", ");
  return `This zone overlaps ${names}. Zones may share a border but not cover the same ground — move the corners so they meet along the edge.`;
}

async function findZone(id: string): Promise<ZoneWithFees | null> {
  const zones = await loadZones();
  return zones.find((zone) => zone.id === id) ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return (error as { code?: string })?.code === "23505" || cause?.code === "23505";
}

// ── GET /hq/delivery-zones — every zone, and where each pharmacy sits ────────
router.get("/", async (_req: AuthRequest, res) => {
  const zones = await loadZones();
  const pharmacies = await placePharmacies(pricedZones(zones));
  res.json({
    zones: zones.map(zoneJson),
    pharmacies,
    feeChangesTakeEffectAt: nextBusinessMidnight(new Date()).toISOString(),
  });
});

// ── GET /hq/delivery-zones/locate?latitude=&longitude= ──────────────────────
// The zone a spot falls in, for placing a pharmacy while onboarding it.
router.get("/locate", async (req: AuthRequest, res) => {
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  if (!isLatitude(latitude) || !isLongitude(longitude)) {
    res.status(400).json({ error: "latitude and longitude are required" });
    return;
  }
  const zone = zonesAt([longitude, latitude], pricedZones(await loadZones()))[0];
  res.json({
    zoneId: zone?.id ?? null,
    zoneName: zone?.name ?? null,
    feeMinor: zone?.feeMinor ?? null,
  });
});

// ── POST /hq/delivery-zones/preview — check an outline before saving it ─────
// Reports whether it is valid, what it overlaps, and which pharmacies would
// change zone or fall outside every zone as a result (rule R10).
const previewSchema = z.object({
  zoneId: z.string().uuid().optional(),
  // What to call the zone in the list of pharmacies it would move.
  name: z.string().trim().max(60).optional(),
  boundary: z.unknown(),
  isActive: z.boolean().optional(),
});

router.post("/preview", async (req: AuthRequest, res) => {
  const body = previewSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() });
    return;
  }
  const checked = validateBoundary(body.data.boundary);
  if (!checked.ok) {
    res.json({ valid: false, error: checked.error, overlaps: [], changes: [] });
    return;
  }

  const zones = await loadZones();
  const existing = body.data.zoneId
    ? zones.find((zone) => zone.id === body.data.zoneId)
    : undefined;
  if (body.data.zoneId && !existing) {
    res.status(404).json({ error: "Zone not found" });
    return;
  }
  const clashes = overlappingZones(checked.boundary, zones, existing?.id);

  // Before: zones as they are. After: this zone replaced by (or added as) the
  // proposed outline. A new zone has no fee yet, so it counts at fee 0 only for
  // deciding membership; a pharmacy on a border still goes to its cheaper zone.
  const before = pricedZones(zones);
  const willBeActive = body.data.isActive ?? existing?.isActive ?? true;
  const proposed: PricedZone = {
    id: existing?.id ?? "proposed",
    name: body.data.name || existing?.name || "This zone",
    boundary: checked.boundary,
    feeMinor: existing?.currentFee?.feeMinor ?? 0,
  };
  const after = [
    ...before.filter((zone) => zone.id !== proposed.id),
    ...(willBeActive ? [proposed] : []),
  ];

  const [placedBefore, placedAfter] = await Promise.all([
    placePharmacies(before),
    placePharmacies(after),
  ]);
  const changes = placedBefore
    .map((pharmacy, index) => ({ pharmacy, next: placedAfter[index]! }))
    .filter(({ pharmacy, next }) => pharmacy.zoneId !== next.zoneId)
    .map(({ pharmacy, next }) => ({
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      fromZone: pharmacy.zoneName,
      toZone: next.zoneName,
    }));

  res.json({
    valid: clashes.length === 0,
    error: clashes.length ? overlapMessage(clashes) : null,
    overlaps: clashes.map((zone) => zone.name),
    areaSquareKm: boundaryAreaSquareKm(checked.boundary),
    changes,
  });
});

// ── Everything below changes zones or fees ──────────────────────────────────
router.use(requireManageSettlements);

// ── POST /hq/delivery-zones — draw a new zone with its first fee ────────────
const createSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  boundary: z.unknown(),
  feeMinor: feeSchema,
});

router.post("/", async (req: AuthRequest, res) => {
  const body = createSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() });
    return;
  }
  const checked = validateBoundary(body.data.boundary);
  if (!checked.ok) {
    res.status(422).json({ error: checked.error });
    return;
  }

  let created: { id: string } | undefined;
  try {
    created = await db.transaction(async (tx) => {
      // One zone edit at a time, so two people cannot each draw a zone that is
      // clear of the zones they saw but overlaps the other's.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('delivery_zones'))`);
      const clashes = overlappingZones(checked.boundary, await loadZones(new Date(), tx));
      if (clashes.length) throw new ZoneConflict(overlapMessage(clashes));

      const [zone] = await tx
        .insert(deliveryZonesTable)
        .values({
          name: body.data.name,
          description: body.data.description ?? "",
          boundary: checked.boundary,
          updatedByHqStaffId: req.pharmacy!.sub,
        })
        .returning({ id: deliveryZonesTable.id });
      // A new zone's first fee applies straight away: there is no old price to
      // protect, and the zone is not usable without one.
      await tx.insert(deliveryZoneFeesTable).values({
        zoneId: zone!.id,
        feeMinor: body.data.feeMinor,
        effectiveFrom: new Date(),
        createdByHqStaffId: req.pharmacy!.sub,
      });
      return zone;
    });
  } catch (error) {
    if (error instanceof ZoneConflict) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: `A zone called "${body.data.name}" already exists.` });
      return;
    }
    throw error;
  }

  await writeAudit({
    ...actor(req),
    action: "delivery_zone.create",
    entityType: "delivery_zone",
    entityId: created!.id,
    details: { name: body.data.name, feeMinor: body.data.feeMinor },
  });
  res.status(201).json(zoneJson((await findZone(created!.id))!));
});

// ── PATCH /hq/delivery-zones/:id — rename, describe, or redraw ──────────────
const updateSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    boundary: z.unknown().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Nothing to change",
  });

router.patch("/:id", async (req: AuthRequest, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = updateSchema.safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({ error: body.success ? "Invalid zone id" : body.error.flatten() });
    return;
  }
  let boundary: Boundary | undefined;
  if (body.data.boundary !== undefined) {
    const checked = validateBoundary(body.data.boundary);
    if (!checked.ok) {
      res.status(422).json({ error: checked.error });
      return;
    }
    boundary = checked.boundary;
  }

  let found = true;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('delivery_zones'))`);
      const zones = await loadZones(new Date(), tx);
      const zone = zones.find((candidate) => candidate.id === id.data);
      if (!zone) {
        found = false;
        return;
      }
      if (boundary && zone.isActive) {
        const clashes = overlappingZones(boundary, zones, zone.id);
        if (clashes.length) throw new ZoneConflict(overlapMessage(clashes));
      }
      await tx
        .update(deliveryZonesTable)
        .set({
          ...(body.data.name !== undefined ? { name: body.data.name } : {}),
          ...(body.data.description !== undefined ? { description: body.data.description } : {}),
          ...(boundary ? { boundary } : {}),
          updatedByHqStaffId: req.pharmacy!.sub,
          updatedAt: new Date(),
        })
        .where(eq(deliveryZonesTable.id, zone.id));
    });
  } catch (error) {
    if (error instanceof ZoneConflict) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: `A zone called "${body.data.name}" already exists.` });
      return;
    }
    throw error;
  }
  if (!found) {
    res.status(404).json({ error: "Zone not found" });
    return;
  }

  await writeAudit({
    ...actor(req),
    action: "delivery_zone.update",
    entityType: "delivery_zone",
    entityId: id.data,
    details: {
      name: body.data.name,
      description: body.data.description,
      boundaryChanged: Boolean(boundary),
    },
  });
  res.json(zoneJson((await findZone(id.data))!));
});

// ── PUT /hq/delivery-zones/:id/fee — schedule a new fee for midnight ────────
// Orders already placed keep the fee they were quoted. Scheduling again before
// midnight replaces the pending change rather than stacking a second one.
router.put("/:id/fee", async (req: AuthRequest, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({ feeMinor: feeSchema }).safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({ error: body.success ? "Invalid zone id" : body.error.flatten() });
    return;
  }
  const zone = await findZone(id.data);
  if (!zone) {
    res.status(404).json({ error: "Zone not found" });
    return;
  }
  const now = new Date();
  const effectiveFrom = nextBusinessMidnight(now);
  await db.transaction(async (tx) => {
    await tx
      .delete(deliveryZoneFeesTable)
      .where(and(eq(deliveryZoneFeesTable.zoneId, zone.id), gt(deliveryZoneFeesTable.effectiveFrom, now)));
    await tx.insert(deliveryZoneFeesTable).values({
      zoneId: zone.id,
      feeMinor: body.data.feeMinor,
      effectiveFrom,
      createdByHqStaffId: req.pharmacy!.sub,
    });
  });

  await writeAudit({
    ...actor(req),
    action: "delivery_zone.fee_scheduled",
    entityType: "delivery_zone",
    entityId: zone.id,
    details: {
      name: zone.name,
      fromFeeMinor: zone.currentFee?.feeMinor ?? null,
      toFeeMinor: body.data.feeMinor,
      effectiveFrom: effectiveFrom.toISOString(),
      replacedScheduledFeeMinor: zone.scheduledFee?.feeMinor ?? null,
    },
  });
  res.json(zoneJson((await findZone(zone.id))!));
});

// ── DELETE /hq/delivery-zones/:id/fee/scheduled — cancel a pending change ───
router.delete("/:id/fee/scheduled", async (req: AuthRequest, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "Invalid zone id" });
    return;
  }
  const zone = await findZone(id.data);
  if (!zone) {
    res.status(404).json({ error: "Zone not found" });
    return;
  }
  if (!zone.scheduledFee) {
    res.status(404).json({ error: "This zone has no fee change waiting." });
    return;
  }
  await db
    .delete(deliveryZoneFeesTable)
    .where(and(eq(deliveryZoneFeesTable.zoneId, zone.id), gt(deliveryZoneFeesTable.effectiveFrom, new Date())));

  await writeAudit({
    ...actor(req),
    action: "delivery_zone.fee_change_cancelled",
    entityType: "delivery_zone",
    entityId: zone.id,
    details: { name: zone.name, cancelledFeeMinor: zone.scheduledFee.feeMinor },
  });
  res.json(zoneJson((await findZone(zone.id))!));
});

// ── POST /hq/delivery-zones/:id/status — switch a zone on or off ────────────
// Takes effect immediately. Zones are never deleted: past orders point at them.
router.post("/:id/status", async (req: AuthRequest, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({ isActive: z.boolean() }).safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({ error: body.success ? "Invalid zone id" : body.error.flatten() });
    return;
  }

  let found = true;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('delivery_zones'))`);
      const zones = await loadZones(new Date(), tx);
      const zone = zones.find((candidate) => candidate.id === id.data);
      if (!zone) {
        found = false;
        return;
      }
      if (body.data.isActive && !zone.isActive) {
        // While it was off, a neighbour may have been drawn over its ground.
        const clashes = overlappingZones(zone.boundary as Boundary, zones, zone.id);
        if (clashes.length) throw new ZoneConflict(overlapMessage(clashes));
      }
      await tx
        .update(deliveryZonesTable)
        .set({ isActive: body.data.isActive, updatedByHqStaffId: req.pharmacy!.sub, updatedAt: new Date() })
        .where(and(eq(deliveryZonesTable.id, zone.id), ne(deliveryZonesTable.isActive, body.data.isActive)));
    });
  } catch (error) {
    if (error instanceof ZoneConflict) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
  if (!found) {
    res.status(404).json({ error: "Zone not found" });
    return;
  }

  const zone = (await findZone(id.data))!;
  await writeAudit({
    ...actor(req),
    action: body.data.isActive ? "delivery_zone.activate" : "delivery_zone.deactivate",
    entityType: "delivery_zone",
    entityId: zone.id,
    details: { name: zone.name },
  });
  res.json(zoneJson(zone));
});

export default router;
