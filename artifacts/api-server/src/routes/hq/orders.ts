import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  ordersTable,
  orderItemsTable,
  pharmaciesTable,
  couriersTable,
} from "@workspace/db/schema";
import { eq, and, inArray, desc, isNull } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { checkOrderFlags } from "../../lib/flags.js";
import {
  createPatientNotification,
  notificationForStatus,
} from "../../lib/patientNotifications.js";

const router = safeRouter();

/** Attach items + pharmacy/courier names to a list of order rows. */
async function hydrateOrders(orders: (typeof ordersTable.$inferSelect)[]) {
  const orderIds = orders.map((o) => o.id);
  const pharmacyIds = [...new Set(orders.map((o) => o.pharmacyId))];
  const courierIds = [
    ...new Set(orders.map((o) => o.courierId).filter((c): c is string => !!c)),
  ];

  const [items, pharmacies, couriers] = await Promise.all([
    orderIds.length
      ? db
          .select()
          .from(orderItemsTable)
          .where(inArray(orderItemsTable.orderId, orderIds))
      : Promise.resolve([]),
    pharmacyIds.length
      ? db
          .select({ id: pharmaciesTable.id, name: pharmaciesTable.name })
          .from(pharmaciesTable)
          .where(inArray(pharmaciesTable.id, pharmacyIds))
      : Promise.resolve([]),
    courierIds.length
      ? db
          .select({
            id: couriersTable.id,
            name: couriersTable.name,
            phone: couriersTable.phone,
            photoPath: couriersTable.photoPath,
          })
          .from(couriersTable)
          .where(inArray(couriersTable.id, courierIds))
      : Promise.resolve([]),
  ]);

  const itemsByOrder: Record<string, (typeof items)[number][]> = {};
  for (const item of items) {
    (itemsByOrder[item.orderId] ??= []).push(item);
  }
  const pharmacyById: Record<string, string> = Object.fromEntries(
    pharmacies.map((p) => [p.id, p.name]),
  );
  const courierById: Record<string, (typeof couriers)[number]> =
    Object.fromEntries(couriers.map((c) => [c.id, c]));

  return orders.map((o) => ({
    ...o,
    items: itemsByOrder[o.id] ?? [],
    pharmacyName: pharmacyById[o.pharmacyId] ?? null,
    courier: o.courierId
      ? (() => {
          const courier = courierById[o.courierId];
          return courier ? { id: courier.id, name: courier.name, phone: courier.phone, photoUrl: courier.photoPath ? `/api/couriers/${courier.id}/photo` : null } : null;
        })()
      : null,
  }));
}

// ── GET /hq/orders?status=... — every order across every pharmacy ────────────
router.get("/", async (req, res) => {
  const statusFilter = req.query.status as string | undefined;

  const orders = statusFilter
    ? await db
        .select()
        .from(ordersTable)
        .where(eq(ordersTable.status, statusFilter as any))
        .orderBy(desc(ordersTable.createdAt))
    : await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt));

  res.json(await hydrateOrders(orders));
});

// ── GET /hq/orders/dispatch — deliveries ready for courier assignment ────────
// (Mounted before /:id routes so "dispatch" isn't captured as an id.)
// Also exported and mounted as GET /hq/dispatch in index.ts (contract alias).
export const dispatchHandler = async (
  _req: AuthRequest,
  res: Parameters<Parameters<typeof router.get>[1]>[1],
) => {
  const orders = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        inArray(ordersTable.status, [
          "ready",
          "assigned",
          "picked_up",
          "delivering",
        ]),
        eq(ordersTable.fulfillmentType, "delivery"),
      ),
    )
    .orderBy(desc(ordersTable.createdAt));

  res.json(await hydrateOrders(orders));
};
router.get("/dispatch", dispatchHandler);

// ── POST /hq/orders/:id/assign-courier ───────────────────────────────────────
router.post("/:id/assign-courier", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const body = z.object({ courierId: z.string().min(1) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "courierId is required" });
    return;
  }

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (order.fulfillmentType !== "delivery") {
    res
      .status(409)
      .json({ error: "Only delivery orders can be assigned a courier" });
    return;
  }
  if (order.status !== "ready") {
    res
      .status(409)
      .json({ error: "Order must be 'ready' before assigning a courier" });
    return;
  }

  const assignment = await db.transaction(async (tx) => {
    // Courier retirement locks the same row, preventing assign-vs-delete races.
    const [courier] = await tx
      .select()
      .from(couriersTable)
      .where(
        and(
          eq(couriersTable.id, body.data.courierId),
          eq(couriersTable.isActive, true),
          isNull(couriersTable.deletedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!courier) return { kind: "courier_unavailable" as const };

    // Conditional update — status re-checked in WHERE so two concurrent
    // assignments cannot both win.
    const [updated] = await tx
      .update(ordersTable)
      .set({ courierId: courier.id, status: "assigned", updatedAt: new Date() })
      .where(and(eq(ordersTable.id, id), eq(ordersTable.status, "ready")))
      .returning();

    return updated
      ? { kind: "assigned" as const, courier, updated }
      : { kind: "order_conflict" as const };
  });

  if (assignment.kind === "courier_unavailable") {
    res.status(404).json({ error: "Courier not found or inactive" });
    return;
  }
  if (assignment.kind === "order_conflict") {
    res
      .status(409)
      .json({ error: "Order status changed concurrently — refresh and retry" });
    return;
  }
  const { courier, updated } = assignment;

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "order.assign_courier",
    entityType: "order",
    entityId: id,
    details: { courierId: courier.id, courierName: courier.name },
  });
  await checkOrderFlags(updated);

  // Notify patient that a courier has been assigned
  if (order.patientId) {
    const notif = notificationForStatus("assigned", order.fulfillmentType);
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

  res.json((await hydrateOrders([updated!]))[0]);
});

// ── PATCH /hq/orders/:id/courier-status ──────────────────────────────────────
// The pharmacy must explicitly record the courier handoff as `picked_up`
// before HQ can move the delivery into `delivering`. The customer confirms
// receipt, which is the only intended path that moves a delivery to delivered.
const COURIER_TRANSITIONS: Record<string, string[]> = {
  picked_up: ["delivering"],
};

router.patch("/:id/courier-status", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const body = z
    .object({ status: z.enum(["delivering"]) })
    .safeParse(req.body);
  if (!body.success) {
    res
      .status(400)
      .json({ error: "status must be 'delivering'" });
    return;
  }

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (!order.courierId) {
    res.status(409).json({ error: "Order has no assigned courier" });
    return;
  }

  const allowed = COURIER_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(body.data.status)) {
    res
      .status(409)
      .json({
        error:
          order.status === "assigned"
            ? "Pharmacy must mark the order as collected before HQ can mark it as delivering"
            : `Cannot transition from '${order.status}' to '${body.data.status}'`,
      });
    return;
  }

  // Conditional update — only apply if the order is still in a state that
  // allows this transition (guards against concurrent updates).
  const validFrom = Object.entries(COURIER_TRANSITIONS)
    .filter(([, to]) => to.includes(body.data.status))
    .map(([from]) => from);
  const [updated] = await db
    .update(ordersTable)
    .set({ status: body.data.status as any, updatedAt: new Date() })
    .where(
      and(
        eq(ordersTable.id, id),
        inArray(ordersTable.status, validFrom as any),
      ),
    )
    .returning();
  if (!updated) {
    res
      .status(409)
      .json({ error: "Order status changed concurrently — refresh and retry" });
    return;
  }

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "order.courier_status",
    entityType: "order",
    entityId: id,
    details: { from: order.status, to: body.data.status },
  });

  // Notify patient of delivery status change
  if (order.patientId) {
    const notif = notificationForStatus(
      body.data.status,
      order.fulfillmentType,
    );
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

  res.json((await hydrateOrders([updated!]))[0]);
});

// ── POST /hq/orders/:id/confirm-delivery — retired HQ fallback ────────────────
router.post("/:id/confirm-delivery", async (_req: AuthRequest, res) => {
  res.status(403).json({
    error: "Only the patient can confirm receipt and mark a delivery as delivered",
  });
});

// ── POST /hq/orders/:id/cash-collected — COD reconciliation ─────────────────
router.post("/:id/cash-collected", async (req: AuthRequest, res) => {
  const id = req.params.id as string;

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (order.status !== "delivered") {
    res
      .status(409)
      .json({ error: "Cash can only be reconciled on delivered orders" });
    return;
  }
  if (order.cashCollected) {
    res.status(409).json({ error: "Cash already reconciled for this order" });
    return;
  }

  const [updated] = await db
    .update(ordersTable)
    .set({
      cashCollected: true,
      cashCollectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ordersTable.id, id),
        eq(ordersTable.status, "delivered"),
        eq(ordersTable.cashCollected, false),
      ),
    )
    .returning();
  if (!updated) {
    res
      .status(409)
      .json({ error: "Order changed concurrently — refresh and retry" });
    return;
  }

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "order.cash_collected",
    entityType: "order",
    entityId: id,
    details: { totalLeones: order.totalLeones },
  });

  res.json((await hydrateOrders([updated!]))[0]);
});

export default router;
