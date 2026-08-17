import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { ordersTable, orderItemsTable, drugCatalogueTable } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";

const router = Router();

// Status transitions the pharmacy is permitted to write
const PHARMACY_WRITABLE_STATUSES = ["confirmed", "packaging", "ready"] as const;
type PharmacyStatus = (typeof PHARMACY_WRITABLE_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<string, PharmacyStatus[]> = {
  paid: ["confirmed"],
  confirmed: ["packaging"],
  packaging: ["ready"],
};

// ── List orders ───────────────────────────────────────────────────────────────
router.get("/", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const statusFilter = req.query.status as string | undefined;

  let query = db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.pharmacyId, pharmacyId))
    .$dynamic();

  if (statusFilter) {
    query = query.where(
      and(
        eq(ordersTable.pharmacyId, pharmacyId),
        eq(ordersTable.status, statusFilter as any)
      )
    );
  }

  const orders = await query.orderBy(ordersTable.createdAt);

  // Attach items with drug context to each order
  const orderIds = orders.map((o) => o.id);
  const items =
    orderIds.length > 0
      ? await db
          .select({
            id: orderItemsTable.id,
            orderId: orderItemsTable.orderId,
            drugId: orderItemsTable.drugId,
            drugName: orderItemsTable.drugName,
            quantity: orderItemsTable.quantity,
            unitPriceLeones: orderItemsTable.unitPriceLeones,
            prescriptionId: orderItemsTable.prescriptionId,
          })
          .from(orderItemsTable)
          .where(inArray(orderItemsTable.orderId, orderIds))
      : [];

  const itemsByOrder = items.reduce<Record<string, typeof items>>((acc, item) => {
    (acc[item.orderId] ??= []).push(item);
    return acc;
  }, {});

  res.json(
    orders.map((o) => ({
      ...o,
      items: itemsByOrder[o.id] ?? [],
    }))
  );
});

// ── Update order status ───────────────────────────────────────────────────────
router.patch("/:id/status", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const id = req.params.id as string;

  const body = z.object({ status: z.enum(PHARMACY_WRITABLE_STATUSES) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({
      error: `status must be one of: ${PHARMACY_WRITABLE_STATUSES.join(", ")}`,
    });
    return;
  }

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.id, id), eq(ordersTable.pharmacyId, pharmacyId)))
    .limit(1);

  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(body.data.status)) {
    res.status(409).json({
      error: `Cannot transition from '${order.status}' to '${body.data.status}'`,
    });
    return;
  }

  const [updated] = await db
    .update(ordersTable)
    .set({ status: body.data.status, updatedAt: new Date() })
    .where(eq(ordersTable.id, id))
    .returning();

  res.json(updated);
});

// ── Mark collected (collection path — Tier-1 ID check) ───────────────────────
router.post("/:id/collected", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const id = req.params.id as string;

  const body = z.object({ idChecked: z.literal(true) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "idChecked must be true to confirm in-person ID check" });
    return;
  }

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.id, id), eq(ordersTable.pharmacyId, pharmacyId)))
    .limit(1);

  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.status !== "ready") {
    res.status(409).json({ error: "Order must be in 'ready' status to mark as collected" });
    return;
  }
  if (order.fulfillmentType !== "collection") {
    res.status(409).json({ error: "Only collection orders can be marked as collected" });
    return;
  }

  const [updated] = await db
    .update(ordersTable)
    .set({ status: "collected", idChecked: true, updatedAt: new Date() })
    .where(eq(ordersTable.id, id))
    .returning();

  res.json(updated);
});

// ── Mark picked up (delivery path — courier handoff) ─────────────────────────
router.post("/:id/picked-up", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const id = req.params.id as string;

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.id, id), eq(ordersTable.pharmacyId, pharmacyId)))
    .limit(1);

  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.status !== "ready") {
    res.status(409).json({ error: "Order must be in 'ready' status to mark as picked up" });
    return;
  }
  if (order.fulfillmentType !== "delivery") {
    res.status(409).json({ error: "Only delivery orders can be marked as picked up" });
    return;
  }

  const [updated] = await db
    .update(ordersTable)
    .set({ status: "picked_up", updatedAt: new Date() })
    .where(eq(ordersTable.id, id))
    .returning();

  res.json(updated);
});

export default router;
