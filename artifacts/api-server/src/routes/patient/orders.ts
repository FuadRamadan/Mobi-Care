import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  ordersTable,
  orderItemsTable,
  prescriptionsTable,
  pharmaciesTable,
  pharmacyInventoryTable,
  drugCatalogueTable,
  couriersTable,
  patientsTable,
  prescriptionUploadsTable,
} from "@workspace/db/schema";
import { and, eq, desc, inArray, sql, gte, isNull } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { expireStaleOrders, paymentCutoff } from "../../lib/orderExpiry.js";
import { checkOrderFlags } from "../../lib/flags.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function hydratePatientOrders(orders: (typeof ordersTable.$inferSelect)[]) {
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);

  const items = await db
    .select()
    .from(orderItemsTable)
    .where(inArray(orderItemsTable.orderId, ids));

  const pharmacyIds = [...new Set(orders.map((o) => o.pharmacyId))];
  const pharmacies = await db
    .select({
      id: pharmaciesTable.id,
      name: pharmaciesTable.name,
      address: pharmaciesTable.address,
      phone: pharmaciesTable.phone,
    })
    .from(pharmaciesTable)
    .where(inArray(pharmaciesTable.id, pharmacyIds));

  const courierIds = [...new Set(orders.map((o) => o.courierId).filter(Boolean))] as string[];
  const couriers = courierIds.length
    ? await db
        .select({ id: couriersTable.id, name: couriersTable.name, phone: couriersTable.phone })
        .from(couriersTable)
        .where(inArray(couriersTable.id, courierIds))
    : [];

  const prescriptionIds = [...new Set(orders.map((o) => o.prescriptionId).filter(Boolean))] as string[];
  const prescriptions = prescriptionIds.length
    ? await db
        .select({
          id: prescriptionsTable.id,
          status: prescriptionsTable.status,
          rejectReason: prescriptionsTable.rejectReason,
        })
        .from(prescriptionsTable)
        .where(inArray(prescriptionsTable.id, prescriptionIds))
    : [];

  return orders.map((o) => ({
    ...o,
    items: items.filter((i) => i.orderId === o.id),
    pharmacy: pharmacies.find((p) => p.id === o.pharmacyId) ?? null,
    courier: o.courierId ? (couriers.find((c) => c.id === o.courierId) ?? null) : null,
    prescription: o.prescriptionId
      ? (prescriptions.find((p) => p.id === o.prescriptionId) ?? null)
      : null,
  }));
}

// ── GET /patient/orders — own orders only ─────────────────────────────────────
router.get("/", async (req: AuthRequest, res) => {
  const patientId = req.pharmacy!.sub;
  const orders = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.patientId, patientId))
    .orderBy(desc(ordersTable.createdAt));
  res.json(await hydratePatientOrders(orders));
});

// ── GET /patient/orders/:id — own order only ──────────────────────────────────
router.get("/:id", async (req: AuthRequest, res) => {
  const patientId = req.pharmacy!.sub;
  const id = req.params.id as string;
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.id, id), eq(ordersTable.patientId, patientId)))
    .limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  res.json((await hydratePatientOrders([order]))[0]);
});

// ── POST /patient/orders — place an order ─────────────────────────────────────
router.post("/", async (req: AuthRequest, res) => {
  const patientId = req.pharmacy!.sub;
  const body = z.object({
    pharmacyId: z.string().uuid(),
    fulfillmentType: z.enum(["delivery", "collection"]),
    deliveryAddress: z.string().min(5).optional(),
    prescriptionImageKey: z.string().min(1).optional(),
    items: z.array(z.object({
      drugId: z.string().uuid(),
      quantity: z.number().int().min(1).max(1000),
    })).min(1).max(30),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "Invalid order payload", details: body.error.issues });
    return;
  }
  const input = body.data;

  // Reject duplicate drugs in one order (cap enforcement would be bypassable).
  const drugIds = input.items.map((i) => i.drugId);
  if (new Set(drugIds).size !== drugIds.length) {
    res.status(400).json({ error: "Duplicate drugs in order — combine quantities per drug" });
    return;
  }

  if (input.fulfillmentType === "delivery" && !input.deliveryAddress) {
    res.status(400).json({ error: "deliveryAddress is required for delivery orders" });
    return;
  }

  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId))
    .limit(1);
  if (!patient || !patient.isActive) {
    res.status(403).json({ error: "Patient account inactive" });
    return;
  }

  const [pharmacy] = await db
    .select()
    .from(pharmaciesTable)
    .where(eq(pharmaciesTable.id, input.pharmacyId))
    .limit(1);
  if (!pharmacy || !pharmacy.isActive) {
    res.status(404).json({ error: "Pharmacy not found or inactive" });
    return;
  }

  // Load inventory + catalogue rows for every requested drug at this pharmacy.
  const listings = await db
    .select({
      inventoryId: pharmacyInventoryTable.id,
      drugId: pharmacyInventoryTable.drugId,
      priceLeones: pharmacyInventoryTable.priceLeones,
      stockQuantity: pharmacyInventoryTable.stockQuantity,
      isActive: pharmacyInventoryTable.isActive,
      availableForDelivery: pharmacyInventoryTable.availableForDelivery,
      availableForCollection: pharmacyInventoryTable.availableForCollection,
      drugName: drugCatalogueTable.name,
      tier: drugCatalogueTable.tier,
      isApproved: drugCatalogueTable.isApproved,
      maxUnitsPerOrder: drugCatalogueTable.maxUnitsPerOrder,
    })
    .from(pharmacyInventoryTable)
    .innerJoin(drugCatalogueTable, eq(drugCatalogueTable.id, pharmacyInventoryTable.drugId))
    .where(
      and(
        eq(pharmacyInventoryTable.pharmacyId, input.pharmacyId),
        inArray(pharmacyInventoryTable.drugId, drugIds)
      )
    );

  const byDrug = new Map(listings.map((l) => [l.drugId, l]));
  let prescriptionRequired = false;
  let total = 0;

  for (const item of input.items) {
    const l = byDrug.get(item.drugId);
    if (!l || !l.isActive || !l.isApproved) {
      res.status(409).json({ error: `Drug not available at this pharmacy` });
      return;
    }
    if (l.stockQuantity < item.quantity) {
      res.status(409).json({ error: `Not enough stock of ${l.drugName} (only ${l.stockQuantity} left)` });
      return;
    }
    if (input.fulfillmentType === "delivery" && !l.availableForDelivery) {
      res.status(409).json({ error: `${l.drugName} is not available for delivery from this pharmacy` });
      return;
    }
    if (input.fulfillmentType === "collection" && !l.availableForCollection) {
      res.status(409).json({ error: `${l.drugName} is not available for collection from this pharmacy` });
      return;
    }
    if (l.tier === "1") {
      // Controlled: collection only, authorised pharmacies only, hard unit cap.
      if (input.fulfillmentType !== "collection") {
        res.status(409).json({ error: `${l.drugName} is a controlled medicine — collection with ID check only` });
        return;
      }
      if (!pharmacy.controlledSubstanceAuthorized) {
        res.status(409).json({ error: `This pharmacy is not authorised to dispense ${l.drugName}` });
        return;
      }
      if (l.maxUnitsPerOrder != null && item.quantity > l.maxUnitsPerOrder) {
        res.status(409).json({ error: `${l.drugName} is capped at ${l.maxUnitsPerOrder} units per order` });
        return;
      }
    }
    if (l.tier === "1" || l.tier === "2") prescriptionRequired = true;
    total += l.priceLeones * item.quantity;
  }

  if (prescriptionRequired && !input.prescriptionImageKey) {
    res.status(400).json({
      error: "This order contains prescription medicines — a prescription upload is required",
      code: "PRESCRIPTION_REQUIRED",
    });
    return;
  }

  // Free up stock held by abandoned checkouts before reserving more —
  // unpaid orders only hold inventory for a bounded payment window.
  await expireStaleOrders();

  // Create everything atomically; stock decrements are conditional so two
  // concurrent orders can't oversell.
  let createdOrder: typeof ordersTable.$inferSelect;
  try {
    createdOrder = await db.transaction(async (tx) => {
      for (const item of input.items) {
        const updated = await tx
          .update(pharmacyInventoryTable)
          .set({
            stockQuantity: sql`${pharmacyInventoryTable.stockQuantity} - ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pharmacyInventoryTable.pharmacyId, input.pharmacyId),
              eq(pharmacyInventoryTable.drugId, item.drugId),
              gte(pharmacyInventoryTable.stockQuantity, item.quantity)
            )
          )
          .returning({ id: pharmacyInventoryTable.id });
        if (updated.length === 0) {
          throw Object.assign(new Error("OUT_OF_STOCK"), { code: "OUT_OF_STOCK", drugId: item.drugId });
        }
      }

      const [order] = await tx
        .insert(ordersTable)
        .values({
          pharmacyId: input.pharmacyId,
          patientId,
          patientName: patient.name,
          patientPhone: patient.phone,
          fulfillmentType: input.fulfillmentType,
          deliveryAddress: input.deliveryAddress ?? null,
          status: "awaiting_payment",
          paymentMethod: "orange_money",
          totalLeones: total,
        })
        .returning();

      let prescriptionId: string | null = null;
      if (prescriptionRequired && input.prescriptionImageKey) {
        // Consume the upload record exactly once, and only if it belongs to
        // this patient — a forged or foreign key aborts the whole order.
        const consumed = await tx
          .update(prescriptionUploadsTable)
          .set({ consumedAt: new Date() })
          .where(
            and(
              eq(prescriptionUploadsTable.imageKey, input.prescriptionImageKey),
              eq(prescriptionUploadsTable.patientId, patientId),
              isNull(prescriptionUploadsTable.consumedAt)
            )
          )
          .returning({ id: prescriptionUploadsTable.id });
        if (consumed.length === 0) {
          throw Object.assign(new Error("INVALID_PRESCRIPTION_KEY"), {
            code: "INVALID_PRESCRIPTION_KEY",
          });
        }
        const [rx] = await tx
          .insert(prescriptionsTable)
          .values({
            pharmacyId: input.pharmacyId,
            patientName: patient.name,
            patientPhone: patient.phone,
            imageKey: input.prescriptionImageKey,
            orderId: order!.id,
          })
          .returning({ id: prescriptionsTable.id });
        prescriptionId = rx!.id;
        await tx
          .update(ordersTable)
          .set({ prescriptionId })
          .where(eq(ordersTable.id, order!.id));
        order!.prescriptionId = prescriptionId;
      }

      await tx.insert(orderItemsTable).values(
        input.items.map((item) => {
          const l = byDrug.get(item.drugId)!;
          return {
            orderId: order!.id,
            drugId: item.drugId,
            drugName: l.drugName,
            quantity: item.quantity,
            unitPriceLeones: l.priceLeones,
            prescriptionId: l.tier === "1" || l.tier === "2" ? prescriptionId : null,
          };
        })
      );

      return order!;
    });
  } catch (err: any) {
    if (err?.code === "OUT_OF_STOCK") {
      res.status(409).json({ error: "Stock changed while ordering — please review your cart" });
      return;
    }
    if (err?.code === "INVALID_PRESCRIPTION_KEY") {
      res.status(400).json({
        error: "Prescription upload is invalid or already used — please upload it again",
        code: "INVALID_PRESCRIPTION_KEY",
      });
      return;
    }
    throw err;
  }

  await writeAudit({
    actorType: "patient",
    actorId: patientId,
    actorName: patient.name,
    action: "order.create",
    entityType: "order",
    entityId: createdOrder.id,
    details: { pharmacyId: input.pharmacyId, totalLeones: total, fulfillmentType: input.fulfillmentType },
  });
  await checkOrderFlags(createdOrder);

  res.status(201).json((await hydratePatientOrders([createdOrder]))[0]);
});

// ── POST /patient/orders/:id/pay — record mobile-money payment ────────────────
// No live gateway yet: this records the payment intent and moves the order to
// 'paid' so the pharmacy can start fulfilment.
router.post("/:id/pay", async (req: AuthRequest, res) => {
  const patientId = req.pharmacy!.sub;
  const id = req.params.id as string;

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.id, id), eq(ordersTable.patientId, patientId)))
    .limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.status !== "awaiting_payment") {
    res.status(409).json({ error: "Order is not awaiting payment" });
    return;
  }

  // Atomic + bounded: only an unexpired awaiting_payment order can be paid.
  // The createdAt guard means an order past the payment window can never be
  // paid — the expiry sweep will cancel and restock it instead.
  const [updated] = await db
    .update(ordersTable)
    .set({ status: "paid", updatedAt: new Date() })
    .where(
      and(
        eq(ordersTable.id, id),
        eq(ordersTable.status, "awaiting_payment"),
        gte(ordersTable.createdAt, paymentCutoff())
      )
    )
    .returning();
  if (!updated) {
    await expireStaleOrders();
    res.status(409).json({
      error: "This order's payment window has expired — please place it again",
      code: "PAYMENT_WINDOW_EXPIRED",
    });
    return;
  }

  await writeAudit({
    actorType: "patient",
    actorId: patientId,
    actorName: req.pharmacy!.name,
    action: "order.payment_recorded",
    entityType: "order",
    entityId: id,
    details: { method: order.paymentMethod, totalLeones: order.totalLeones },
  });
  await checkOrderFlags(updated);

  res.json((await hydratePatientOrders([updated]))[0]);
});

export default router;
