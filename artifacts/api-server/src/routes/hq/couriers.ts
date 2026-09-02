import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import { couriersTable, ordersTable } from "@workspace/db/schema";
import { and, eq, desc, sql, inArray, isNull } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";

const router = safeRouter();

// ── GET /hq/couriers — fleet with live load ───────────────────────────────────
router.get("/", async (_req, res) => {
  const couriers = await db
    .select()
    .from(couriersTable)
    .where(isNull(couriersTable.deletedAt))
    .orderBy(desc(couriersTable.createdAt));

  const loads = couriers.length
    ? await db
        .select({
          courierId: ordersTable.courierId,
          count: sql<number>`count(*)::int`,
        })
        .from(ordersTable)
        .where(
          inArray(ordersTable.status, ["assigned", "picked_up", "delivering"]),
        )
        .groupBy(ordersTable.courierId)
    : [];
  const loadByCourier = Object.fromEntries(
    loads.map((l) => [l.courierId, l.count]),
  );

  res.json(
    couriers.map((c) => ({ ...c, activeDeliveries: loadByCourier[c.id] ?? 0 })),
  );
});

// ── POST /hq/couriers — add courier ───────────────────────────────────────────
router.post("/", async (req: AuthRequest, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      phone: z.string().min(5),
      vehicleType: z
        .enum(["motorbike", "bicycle", "car", "van"])
        .default("motorbike"),
    })
    .safeParse(req.body);

  if (!body.success) {
    res
      .status(400)
      .json({ error: body.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const [existing] = await db
    .select({ id: couriersTable.id })
    .from(couriersTable)
    .where(eq(couriersTable.phone, body.data.phone))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "A courier with this phone already exists" });
    return;
  }

  const [created] = await db
    .insert(couriersTable)
    .values(body.data)
    .returning();

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "courier.create",
    entityType: "courier",
    entityId: created!.id,
    details: { name: created!.name, phone: created!.phone },
  });

  res.status(201).json({ ...created, activeDeliveries: 0 });
});

// ── PATCH /hq/couriers/:id — activate/deactivate or edit ─────────────────────
router.patch("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const body = z
    .object({
      name: z.string().min(1).optional(),
      phone: z.string().min(5).optional(),
      vehicleType: z.enum(["motorbike", "bicycle", "car", "van"]).optional(),
      isActive: z.boolean().optional(),
    })
    .safeParse(req.body);

  if (!body.success || Object.keys(body.data).length === 0) {
    res.status(400).json({ error: "No valid fields provided" });
    return;
  }

  const [existing] = await db
    .select()
    .from(couriersTable)
    .where(and(eq(couriersTable.id, id), isNull(couriersTable.deletedAt)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Courier not found" });
    return;
  }

  if (body.data.phone && body.data.phone !== existing.phone) {
    const [phoneOwner] = await db
      .select({ id: couriersTable.id })
      .from(couriersTable)
      .where(eq(couriersTable.phone, body.data.phone))
      .limit(1);
    if (phoneOwner && phoneOwner.id !== id) {
      res.status(409).json({ error: "A courier with this phone already exists" });
      return;
    }
  }

  const [updated] = await db
    .update(couriersTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(couriersTable.id, id), isNull(couriersTable.deletedAt)))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "Courier changed concurrently — refresh and retry" });
    return;
  }

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "courier.update",
    entityType: "courier",
    entityId: id,
    details: { changes: body.data },
  });

  res.json(updated);
});

// ── DELETE /hq/couriers/:id — retire a courier from the fleet ─────────────────
router.delete("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;

  const result = await db.transaction(async (tx) => {
    // Assignment also locks this row. That makes retire-vs-assign deterministic:
    // once retired, no new assignment can commit against this courier.
    const [existing] = await tx
      .select({ id: couriersTable.id, name: couriersTable.name })
      .from(couriersTable)
      .where(and(eq(couriersTable.id, id), isNull(couriersTable.deletedAt)))
      .for("update")
      .limit(1);
    if (!existing) return { kind: "not_found" as const };

    const [load] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.courierId, id),
          inArray(ordersTable.status, ["assigned", "picked_up", "delivering"]),
        ),
      );
    if ((load?.count ?? 0) > 0) return { kind: "active" as const };

    const now = new Date();
    const [retired] = await tx
      .update(couriersTable)
      .set({ isActive: false, deletedAt: now, updatedAt: now })
      .where(and(eq(couriersTable.id, id), isNull(couriersTable.deletedAt)))
      .returning({ id: couriersTable.id });

    return retired
      ? { kind: "retired" as const, courier: existing }
      : { kind: "conflict" as const };
  });

  if (result.kind === "not_found") {
    res.status(404).json({ error: "Courier not found" });
    return;
  }
  if (result.kind === "active") {
    res.status(409).json({
      error: "Cannot delete a courier with active deliveries. Reassign those orders first.",
    });
    return;
  }
  if (result.kind === "conflict") {
    res.status(409).json({ error: "Courier changed concurrently — refresh and retry" });
    return;
  }

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "courier.delete",
    entityType: "courier",
    entityId: id,
    details: { name: result.courier.name },
  });

  res.json({ message: "Courier deleted" });
});

export default router;
