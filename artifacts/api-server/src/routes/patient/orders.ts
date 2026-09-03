import { safeRouter } from "../../lib/safeRouter.js";
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
import { and, eq, desc, inArray, sql, gte, gt, isNull } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { expireStaleOrders, paymentCutoff } from "../../lib/orderExpiry.js";
import { checkOrderFlags } from "../../lib/flags.js";
import { notifyHqOfNewOrder } from "../../lib/hqNotifications.js";
import {
  notifyPharmacyOfNewOrder,
  notifyPharmacyOfPaidOrder,
  notifyPharmacyOfSubmittedPrescription,
  notifyPharmacyOfPatientCancellation,
} from "../../lib/pharmacyNotifications.js";
import {
  createPatientNotification,
  notificationForStatus,
} from "../../lib/patientNotifications.js";
import {
  decimalLeonesToMinor,
  getFinancialSettings,
  minorToLeones,
} from "../../lib/financialSettings.js";
import { allocatePatientPrices } from "../../lib/financialAllocation.js";

const router = safeRouter();
const SERVICE_FEE_BASIS_POINTS = 500;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function hydratePatientOrders(
  orders: (typeof ordersTable.$inferSelect)[],
) {
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

  const courierIds = [
    ...new Set(orders.map((o) => o.courierId).filter(Boolean)),
  ] as string[];
  const couriers = courierIds.length
    ? await db
        .select({
          id: couriersTable.id,
          name: couriersTable.name,
          phone: couriersTable.phone,
          photoPath: couriersTable.photoPath,
        })
        .from(couriersTable)
        .where(inArray(couriersTable.id, courierIds))
    : [];

  const prescriptionIds = [
    ...new Set(orders.map((o) => o.prescriptionId).filter(Boolean)),
  ] as string[];
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
    totalLeones: Number(o.totalLeones),
    items: items
      .filter((i) => i.orderId === o.id)
      .map((item) => ({
        ...item,
        unitPriceLeones: Number(item.unitPriceLeones),
      })),
    pharmacy: pharmacies.find((p) => p.id === o.pharmacyId) ?? null,
    courier: o.courierId
      ? (() => {
          const courier = couriers.find((c) => c.id === o.courierId);
          return courier
            ? { id: courier.id, name: courier.name, phone: courier.phone, photoUrl: courier.photoPath ? `/api/couriers/${courier.id}/photo` : null }
            : null;
        })()
      : null,
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
    .where(
      and(
        eq(ordersTable.patientId, patientId),
        isNull(ordersTable.patientHiddenAt),
      ),
    )
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
    .where(
      and(
        eq(ordersTable.id, id),
        eq(ordersTable.patientId, patientId),
        isNull(ordersTable.patientHiddenAt),
      ),
    )
    .limit(1);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json((await hydratePatientOrders([order]))[0]);
});

// ── DELETE /patient/orders/:id/history — hide a terminal order from history ─
router.delete("/:id/history", async (req: AuthRequest, res) => {
  const patientId = req.pharmacy!.sub;
  const id = req.params.id as string;
  const removableStatuses = ["delivered", "collected", "cancelled"] as const;
  const [updated] = await db
    .update(ordersTable)
    .set({ patientHiddenAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(ordersTable.id, id),
        eq(ordersTable.patientId, patientId),
        isNull(ordersTable.patientHiddenAt),
        inArray(ordersTable.status, removableStatuses),
      ),
    )
    .returning({ id: ordersTable.id });
  if (!updated) {
    res.status(409).json({
      error:
        "Only delivered, collected, or cancelled orders can be removed from history",
    });
    return;
  }
  await writeAudit({
    actorType: "patient",
    actorId: patientId,
    actorName: req.pharmacy!.name,
    action: "order.hidden_from_patient_history",
    entityType: "order",
    entityId: id,
  });
  res.json({ removed: true });
});

// ── POST /patient/orders/:id/confirm-receipt ─────────────────────────────────
// Only the authenticated customer can confirm delivery. The conditional
// update makes this one-time and safe when the customer taps twice or multiple
// devices submit at the same time.
router.post("/:id/confirm-receipt", async (req: AuthRequest, res) => {
  const patientId = req.pharmacy!.sub;
  const id = req.params.id as string;

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.id, id), eq(ordersTable.patientId, patientId)))
    .limit(1);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (order.fulfillmentType !== "delivery") {
    res
      .status(409)
      .json({ error: "Only delivery orders require receipt confirmation" });
    return;
  }
  if (order.status !== "delivering") {
    res.status(409).json({
      error: `Receipt can only be confirmed while the order is 'delivering'`,
    });
    return;
  }

  const [updated] = await db
    .update(ordersTable)
    .set({
      status: "delivered",
      completedAt: new Date(),
      deliveryConfirmedAt: new Date(),
      deliveryConfirmationMethod: "patient",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ordersTable.id, id),
        eq(ordersTable.patientId, patientId),
        eq(ordersTable.fulfillmentType, "delivery"),
        eq(ordersTable.status, "delivering"),
      ),
    )
    .returning();
  if (!updated) {
    res.status(409).json({
      error: "Order status changed before receipt could be confirmed",
    });
    return;
  }

  await writeAudit({
    actorType: "patient",
    actorId: patientId,
    actorName: req.pharmacy!.name,
    action: "order.receipt_confirmed",
    entityType: "order",
    entityId: id,
    details: { from: order.status, to: updated.status },
  });
  await checkOrderFlags(updated);

  const notif = notificationForStatus(
    "delivered",
    updated.fulfillmentType,
  );
  if (notif) {
    void createPatientNotification({
      patientId,
      patientPhone: updated.patientPhone,
      title: notif.title,
      body: notif.body,
      type: notif.type,
      referenceId: updated.id,
    });
  }

  res.json((await hydratePatientOrders([updated]))[0]);
});

// ── POST /patient/orders/:id/cancel ──────────────────────────────────────────
// The row lock and courierId predicate make cancellation safe against an HQ
// assignment that happens at the same time as the patient's tap.
router.post("/:id/cancel", async (req: AuthRequest, res) => {
  const patientId = req.pharmacy!.sub;
  const id = req.params.id as string;
  const cancellableStatuses = [
    "awaiting_payment",
    "paid",
    "confirmed",
    "packaging",
    "ready",
  ] as const;

  let cancelled: typeof ordersTable.$inferSelect;
  let previous: typeof ordersTable.$inferSelect;
  try {
    ({ cancelled, previous } = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(ordersTable)
        .where(and(eq(ordersTable.id, id), eq(ordersTable.patientId, patientId)))
        .for("update")
        .limit(1);
      if (!locked) {
        throw Object.assign(new Error("ORDER_NOT_FOUND"), { code: "ORDER_NOT_FOUND" });
      }
      if (locked.courierId) {
        throw Object.assign(new Error("COURIER_ASSIGNED"), { code: "COURIER_ASSIGNED" });
      }
      if (!cancellableStatuses.includes(locked.status as (typeof cancellableStatuses)[number])) {
        throw Object.assign(new Error("ORDER_NOT_CANCELLABLE"), { code: "ORDER_NOT_CANCELLABLE" });
      }

      const [updated] = await tx
        .update(ordersTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(ordersTable.id, id),
            eq(ordersTable.patientId, patientId),
            isNull(ordersTable.courierId),
            eq(ordersTable.status, locked.status),
          ),
        )
        .returning();
      if (!updated) {
        throw Object.assign(new Error("ORDER_CHANGED"), { code: "ORDER_CHANGED" });
      }

      // Payment deducts inventory, so return paid-order quantities when a
      // patient cancels before dispatch.
      if (locked.status !== "awaiting_payment") {
        const items = await tx
          .select({
            inventoryId: orderItemsTable.inventoryId,
            quantity: orderItemsTable.quantity,
          })
          .from(orderItemsTable)
          .where(eq(orderItemsTable.orderId, id));
        for (const item of items) {
          if (!item.inventoryId) continue;
          await tx
            .update(pharmacyInventoryTable)
            .set({
              stockQuantity: sql`${pharmacyInventoryTable.stockQuantity} + ${item.quantity}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(pharmacyInventoryTable.id, item.inventoryId),
                eq(pharmacyInventoryTable.pharmacyId, locked.pharmacyId),
              ),
            );
        }
      }
      return { cancelled: updated, previous: locked };
    }));
  } catch (error: any) {
    if (error?.code === "ORDER_NOT_FOUND") {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (error?.code === "COURIER_ASSIGNED") {
      res.status(409).json({ error: "This order cannot be cancelled after a courier has been assigned" });
      return;
    }
    if (error?.code === "ORDER_NOT_CANCELLABLE" || error?.code === "ORDER_CHANGED") {
      res.status(409).json({ error: "This order can no longer be cancelled" });
      return;
    }
    throw error;
  }

  await writeAudit({
    actorType: "patient",
    actorId: patientId,
    actorName: req.pharmacy!.name,
    action: "order.cancelled_by_patient",
    entityType: "order",
    entityId: id,
    details: { from: previous.status, to: cancelled.status },
  });
  void notifyPharmacyOfPatientCancellation(cancelled);
  res.json((await hydratePatientOrders([cancelled]))[0]);
});

// ── POST /patient/orders — place an order ─────────────────────────────────────
router.post("/", async (req: AuthRequest, res) => {
  const patientId = req.pharmacy!.sub;
  const body = z
    .object({
      pharmacyId: z.string().uuid(),
      fulfillmentType: z.enum(["delivery", "collection"]),
      expectedTotalMinor: z.number().int().nonnegative(),
      deliveryAddress: z.string().min(5).optional(),
      prescriptionImageKey: z.string().min(1).optional(),
      items: z
        .array(
          z.object({
            inventoryId: z.string().uuid(),
            quantity: z.number().int().min(1).max(1000),
          }),
        )
        .min(1)
        .max(30),
    })
    .safeParse(req.body);

  if (!body.success) {
    res
      .status(400)
      .json({ error: "Invalid order payload", details: body.error.issues });
    return;
  }
  const input = body.data;

  // Reject duplicate listings in one order (cap enforcement would be bypassable).
  const inventoryIds = input.items.map((i) => i.inventoryId);
  if (new Set(inventoryIds).size !== inventoryIds.length) {
    res
      .status(400)
      .json({
        error:
          "Duplicate medicine listings in order — combine their quantities",
      });
    return;
  }

  if (input.fulfillmentType === "delivery" && !input.deliveryAddress) {
    res
      .status(400)
      .json({ error: "deliveryAddress is required for delivery orders" });
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
  if (!pharmacy || !pharmacy.isActive || !pharmacy.isOnline) {
    res.status(409).json({ error: "Pharmacy is not currently available" });
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
      completionStatus: pharmacyInventoryTable.completionStatus,
      expiryDate: pharmacyInventoryTable.expiryDate,
      availableForDelivery: pharmacyInventoryTable.availableForDelivery,
      availableForCollection: pharmacyInventoryTable.availableForCollection,
      drugName: drugCatalogueTable.name,
      tier: drugCatalogueTable.tier,
      isApproved: drugCatalogueTable.isApproved,
      maxUnitsPerOrder: drugCatalogueTable.maxUnitsPerOrder,
    })
    .from(pharmacyInventoryTable)
    .innerJoin(
      drugCatalogueTable,
      eq(drugCatalogueTable.id, pharmacyInventoryTable.drugId),
    )
    .where(
      and(
        eq(pharmacyInventoryTable.pharmacyId, input.pharmacyId),
        inArray(pharmacyInventoryTable.id, inventoryIds),
      ),
    );

  const byInventory = new Map(
    listings.map((listing) => [listing.inventoryId, listing]),
  );
  let prescriptionRequired = false;
  let pharmacyMedicineTotalMinor = 0;

  for (const item of input.items) {
    const l = byInventory.get(item.inventoryId);
    if (
      !l ||
      !l.isActive ||
      !l.isApproved ||
      l.completionStatus !== "complete" ||
      !l.expiryDate ||
      l.expiryDate <= new Date().toISOString().slice(0, 10)
    ) {
      res.status(409).json({ error: `Drug not available at this pharmacy` });
      return;
    }
    if (l.stockQuantity < item.quantity) {
      res
        .status(409)
        .json({
          error: `Not enough stock of ${l.drugName} (only ${l.stockQuantity} left)`,
        });
      return;
    }
    if (input.fulfillmentType === "delivery" && !l.availableForDelivery) {
      res
        .status(409)
        .json({
          error: `${l.drugName} is not available for delivery from this pharmacy`,
        });
      return;
    }
    if (input.fulfillmentType === "collection" && !l.availableForCollection) {
      res
        .status(409)
        .json({
          error: `${l.drugName} is not available for collection from this pharmacy`,
        });
      return;
    }
    if (l.tier === "1") {
      // Controlled: collection only, authorised pharmacies only, hard unit cap.
      if (input.fulfillmentType !== "collection") {
        res
          .status(409)
          .json({
            error: `${l.drugName} is a controlled medicine — collection with ID check only`,
          });
        return;
      }
      if (!pharmacy.controlledSubstanceAuthorized) {
        res
          .status(409)
          .json({
            error: `This pharmacy is not authorised to dispense ${l.drugName}`,
          });
        return;
      }
      if (l.maxUnitsPerOrder != null && item.quantity > l.maxUnitsPerOrder) {
        res
          .status(409)
          .json({
            error: `${l.drugName} is capped at ${l.maxUnitsPerOrder} units per order`,
          });
        return;
      }
    }
    if (l.tier === "1" || l.tier === "2") prescriptionRequired = true;
    pharmacyMedicineTotalMinor +=
      decimalLeonesToMinor(l.priceLeones) * item.quantity;
  }
  const allocatedPrices = allocatePatientPrices(
    input.items.map((item) => {
      const listing = byInventory.get(item.inventoryId)!;
      return {
        key: item.inventoryId,
        baseUnitPriceMinor: decimalLeonesToMinor(listing.priceLeones),
        quantity: item.quantity,
      };
    }),
    SERVICE_FEE_BASIS_POINTS,
  );
  const allocatedByInventory = new Map(
    allocatedPrices.map((line) => [line.key, line]),
  );
  const medicineCommissionMinor = allocatedPrices.reduce(
    (total, line) => total + line.medicineCommissionMinor,
    0,
  );
  const patientMedicineTotalMinor =
    pharmacyMedicineTotalMinor + medicineCommissionMinor;
  // The customer-facing price is deliberately only the pharmacy's drug price
  // plus the fixed 5% MobiCare service fee. Courier pay remains a separate
  // platform obligation and is never added as a hidden checkout charge.
  const financialSettings = await getFinancialSettings();
  const deliveryFeeMinor = 0;
  const courierPayoutMinor =
    input.fulfillmentType === "delivery"
      ? financialSettings.courierPayoutMinor
      : 0;
  const deliveryCommissionMinor = 0;
  const totalMinor = patientMedicineTotalMinor;
  const total = minorToLeones(totalMinor);
  if (input.expectedTotalMinor !== totalMinor) {
    res.status(409).json({
      error: "The order price changed. Review the updated total before paying.",
      code: "PRICE_CHANGED",
      expectedTotalMinor: input.expectedTotalMinor,
      currentTotalMinor: totalMinor,
    });
    return;
  }

  if (prescriptionRequired && !input.prescriptionImageKey) {
    res.status(400).json({
      error:
        "This order contains prescription medicines — a prescription upload is required",
      code: "PRESCRIPTION_REQUIRED",
    });
    return;
  }

  // Cancel abandoned checkouts. Unpaid orders do not reserve inventory.
  await expireStaleOrders();

  // Create the checkout atomically without changing inventory. Stock is
  // verified again and deducted only after confirmed payment.
  let createdOrder: typeof ordersTable.$inferSelect;
  try {
    createdOrder = await db.transaction(async (tx) => {
      const lockedListings = await tx
        .select({
          id: pharmacyInventoryTable.id,
          priceLeones: pharmacyInventoryTable.priceLeones,
        })
        .from(pharmacyInventoryTable)
        .where(
          and(
            eq(pharmacyInventoryTable.pharmacyId, input.pharmacyId),
            inArray(pharmacyInventoryTable.id, inventoryIds),
          ),
        )
        .for("update");
      const lockedById = new Map(lockedListings.map((listing) => [listing.id, listing]));
      const priceChanged =
        lockedListings.length !== input.items.length ||
        input.items.some((item) => {
          const locked = lockedById.get(item.inventoryId);
          const originallyQuoted = byInventory.get(item.inventoryId);
          return (
            !locked ||
            !originallyQuoted ||
            decimalLeonesToMinor(locked.priceLeones) !==
              decimalLeonesToMinor(originallyQuoted.priceLeones)
          );
        });
      if (priceChanged) {
        throw Object.assign(new Error("PRICE_CHANGED"), { code: "PRICE_CHANGED" });
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
          medicineMarkupBasisPoints: SERVICE_FEE_BASIS_POINTS,
          pharmacyMedicineTotalMinor,
          medicineCommissionMinor,
          patientMedicineTotalMinor,
          deliveryFeeMinor,
          courierPayoutMinor,
          deliveryCommissionMinor,
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
              isNull(prescriptionUploadsTable.consumedAt),
            ),
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
          const l = byInventory.get(item.inventoryId)!;
          const allocated = allocatedByInventory.get(item.inventoryId)!;
          return {
            orderId: order!.id,
            inventoryId: item.inventoryId,
            drugId: l.drugId,
            drugName: l.drugName,
            quantity: item.quantity,
            unitPriceLeones: minorToLeones(allocated.patientUnitPriceMinor),
            baseUnitPriceMinor: allocated.baseUnitPriceMinor,
            patientUnitPriceMinor: allocated.patientUnitPriceMinor,
            patientLineTotalMinor: allocated.patientLineTotalMinor,
            prescriptionId:
              l.tier === "1" || l.tier === "2" ? prescriptionId : null,
          };
        }),
      );

      return order!;
    });
  } catch (err: any) {
    if (err?.code === "PRICE_CHANGED") {
      res.status(409).json({
        error: "The order price changed. Review the updated total before paying.",
        code: "PRICE_CHANGED",
      });
      return;
    }
    if (err?.code === "INVALID_PRESCRIPTION_KEY") {
      res.status(400).json({
        error:
          "Prescription upload is invalid or already used — please upload it again",
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
    details: {
      pharmacyId: input.pharmacyId,
      totalLeones: Number(total),
      fulfillmentType: input.fulfillmentType,
    },
  });
  await checkOrderFlags(createdOrder);
  await notifyHqOfNewOrder(createdOrder, pharmacy.name);
  void notifyPharmacyOfNewOrder(createdOrder);
  if (createdOrder.prescriptionId) {
    void notifyPharmacyOfSubmittedPrescription({
      pharmacyId: createdOrder.pharmacyId,
      prescriptionId: createdOrder.prescriptionId,
      patientName: createdOrder.patientName,
    });
  }

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
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (order.status !== "awaiting_payment") {
    res.status(409).json({ error: "Order is not awaiting payment" });
    return;
  }

  // Atomically claim payment and deduct the exact selected listing. Any stock
  // conflict rolls the status update back, so payment can be retried after the
  // patient reviews their cart and no duplicate request can deduct twice.
  let updated: typeof ordersTable.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(ordersTable)
        .set({ status: "paid", updatedAt: new Date() })
        .where(
          and(
            eq(ordersTable.id, id),
            eq(ordersTable.patientId, patientId),
            eq(ordersTable.status, "awaiting_payment"),
            gte(ordersTable.createdAt, paymentCutoff()),
          ),
        )
        .returning();
      if (!claimed) {
        throw Object.assign(new Error("PAYMENT_CONFLICT"), {
          code: "PAYMENT_CONFLICT",
        });
      }

      const items = await tx
        .select({
          inventoryId: orderItemsTable.inventoryId,
          quantity: orderItemsTable.quantity,
        })
        .from(orderItemsTable)
        .where(eq(orderItemsTable.orderId, id));
      if (items.length === 0 || items.some((item) => !item.inventoryId)) {
        throw Object.assign(new Error("INCOMPLETE_ORDER_ITEMS"), {
          code: "INCOMPLETE_ORDER_ITEMS",
        });
      }

      for (const item of items) {
        const deducted = await tx
          .update(pharmacyInventoryTable)
          .set({
            stockQuantity: sql`${pharmacyInventoryTable.stockQuantity} - ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pharmacyInventoryTable.id, item.inventoryId!),
              eq(pharmacyInventoryTable.pharmacyId, claimed.pharmacyId),
              eq(pharmacyInventoryTable.isActive, true),
              eq(pharmacyInventoryTable.completionStatus, "complete"),
              gt(
                pharmacyInventoryTable.expiryDate,
                new Date().toISOString().slice(0, 10),
              ),
              gte(pharmacyInventoryTable.stockQuantity, item.quantity),
            ),
          )
          .returning({ id: pharmacyInventoryTable.id });
        if (deducted.length === 0) {
          throw Object.assign(new Error("OUT_OF_STOCK"), {
            code: "OUT_OF_STOCK",
          });
        }
      }
      return claimed;
    });
  } catch (err: any) {
    if (
      err?.code === "OUT_OF_STOCK" ||
      err?.code === "INCOMPLETE_ORDER_ITEMS"
    ) {
      res.status(409).json({
        error:
          "Stock changed before payment — please review your cart and place the order again",
        code: "STOCK_CHANGED",
      });
      return;
    }
    if (err?.code !== "PAYMENT_CONFLICT") throw err;
    await expireStaleOrders();
    res.status(409).json({
      error:
        order.createdAt < paymentCutoff()
          ? "This order's payment window has expired — please place it again"
          : "Order is not awaiting payment",
      code:
        order.createdAt < paymentCutoff()
          ? "PAYMENT_WINDOW_EXPIRED"
          : "PAYMENT_CONFLICT",
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
  void notifyPharmacyOfPaidOrder(updated);

  res.json((await hydratePatientOrders([updated]))[0]);
});

export default router;
