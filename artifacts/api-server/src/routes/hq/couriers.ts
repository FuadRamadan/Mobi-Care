import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import { couriersTable, ordersTable } from "@workspace/db/schema";
import { eq, desc, sql, inArray } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";

const router = safeRouter();

// ── GET /hq/couriers — fleet with live load ───────────────────────────────────
router.get("/", async (_req, res) => {
  const couriers = await db
    .select()
    .from(couriersTable)
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
    .where(eq(couriersTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Courier not found" });
    return;
  }

  const [updated] = await db
    .update(couriersTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(couriersTable.id, id))
    .returning();

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

export default router;
