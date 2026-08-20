import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { ordersTable, orderItemsTable, drugCatalogueTable, prescriptionsTable } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { checkOrderFlags } from "../../lib/flags.js";
import { createPatientNotification, notificationForStatus } from "../../lib/patientNotifications.js";
import { notifyHqOfOrderReady } from "../../lib/hqNotifications.js";

const router = Router();

// Status transitions the pharmacy is permitted to write
const PHARMACY_WRITABLE_STATUSES = ["confirmed", "packaging", "ready"] as const;
type PharmacyStatus = (typeof PHARMACY_WRITABLE_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<string, PharmacyStatus[]> = {
  paid: ["confirmed"],
  confirmed: ["packaging"],
  packaging: ["ready"],
};

/**
 * Returns a 409 payload when the linked prescription blocks fulfilment,
 * or null when it is approved.
 */
async function prescriptionGateError(
  prescriptionId: string
): Promise<{ error: string; code: string } | null> {
  const [rx] = await db
    .select({ status: prescriptionsTable.status })
    .from(prescriptionsTable)
    .where(eq(prescriptionsTable.id, prescriptionId))
    .limit(1);
  if (!rx || rx.status === "approved") return rx ? null : { error: "Linked prescription not found", code: "PRESCRIPTION_NOT_FOUND" };
  if (rx.status === "rejected") {
    return {
      error: "The prescription for this order was rejected — the order cannot be fulfilled",
      code: "PRESCRIPTION_REJECTED",
    };
  }
  return {
    error: "The prescription for this order is still awaiting pharmacist review",
    code: "PRESCRIPTION_PENDING",
  };
}

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

  // Prescription gate: an order carrying prescription-bound items may not
  // advance into fulfilment until a licensed pharmacist approves the linked
  // prescription. Enforced server-side on every pharmacy transition.
  if (order.prescriptionId) {
    const rxError = await prescriptionGateError(order.prescriptionId);
    if (rxError) {
      res.status(409).json(rxError);
      return;
    }
  }

  const [updated] = await db
    .update(ordersTable)
    .set({ status: body.data.status, updatedAt: new Date() })
    .where(eq(ordersTable.id, id))
    .returning();

  if (body.data.status === "ready") {
    void notifyHqOfOrderReady(updated!, req.pharmacy!.name);
  }

  await writeAudit({
    actorType: "pharmacy",
    actorId: pharmacyId,
    actorName: req.pharmacy!.name,
    action: "order.status_update",
    entityType: "order",
    entityId: id,
    details: { from: order.status, to: body.data.status },
  });
  await checkOrderFlags(updated!);

  // Notify patient of status change (fire-and-forget; never blocks response)
  if (order.patientId) {
    const notif = notificationForStatus(body.data.status, order.fulfillmentType);
    if (notif) {
      void createPatientNotification({
        patientId: order.patientId,
        patientPhone: order.patientPhone,
        title: notif.title,
        body: notif.body,
        type: notif.type,
        referenceId: order.id,
      });
    }
  }

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

  // Defense-in-depth: never hand over prescription-bound medicines unless the
  // linked prescription is approved (the 'confirmed' gate should already have
  // enforced this, but dispensing is the last, most safety-critical step).
  if (order.prescriptionId) {
    const rxError = await prescriptionGateError(order.prescriptionId);
    if (rxError) {
      res.status(409).json(rxError);
      return;
    }
  }

  const [updated] = await db
    .update(ordersTable)
    .set({ status: "collected", idChecked: true, updatedAt: new Date() })
    .where(eq(ordersTable.id, id))
    .returning();

  await writeAudit({
    actorType: "pharmacy",
    actorId: pharmacyId,
    actorName: req.pharmacy!.name,
    action: "order.collected",
    entityType: "order",
    entityId: id,
    details: { idChecked: true },
  });

  // Notify patient that order was collected
  if (order.patientId) {
    const notif = notificationForStatus("collected", order.fulfillmentType);
    if (notif) {
      void createPatientNotification({
        patientId: order.patientId,
        patientPhone: order.patientPhone,
        title: notif.title,
        body: notif.body,
        type: notif.type,
        referenceId: order.id,
      });
    }
  }

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
  if (order.status !== "assigned") {
    res.status(409).json({ error: "A courier must be assigned before marking pick-up (order must be 'assigned')" });
    return;
  }
  if (order.fulfillmentType !== "delivery") {
    res.status(409).json({ error: "Only delivery orders can be marked as picked up" });
    return;
  }

  // Conditional update — the WHERE re-checks status so concurrent
  // transitions can't clobber each other.
  const [updated] = await db
    .update(ordersTable)
    .set({ status: "picked_up", updatedAt: new Date() })
    .where(and(eq(ordersTable.id, id), eq(ordersTable.status, "assigned")))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "Order status changed concurrently — refresh and retry" });
    return;
  }

  await writeAudit({
    actorType: "pharmacy",
    actorId: pharmacyId,
    actorName: req.pharmacy!.name,
    action: "order.picked_up",
    entityType: "order",
    entityId: id,
  });

  // Notify patient that the rider has picked up their order
  if (order.patientId) {
    const notif = notificationForStatus("picked_up", order.fulfillmentType);
    if (notif) {
      void createPatientNotification({
        patientId: order.patientId,
        patientPhone: order.patientPhone,
        title: notif.title,
        body: notif.body,
        type: notif.type,
        referenceId: order.id,
      });
    }
  }

  res.json(updated);
});

export default router;
