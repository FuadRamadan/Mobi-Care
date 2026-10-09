import { safeRouter } from "../../lib/safeRouter.js";
import { mobileMoneyLines } from "../../lib/mobileMoney.js";
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
import { releaseAfterCompletion } from "../../lib/monime/payouts.js";
import { isLatitude, isLongitude } from "../../lib/geo.js";
import type { Position } from "../../lib/delivery/geometry.js";
import {
  roundCoordinate,
  UNAVAILABLE_MESSAGES,
  type DeliveryQuote,
} from "../../lib/delivery/pricing.js";
import { quoteForPharmacy } from "../../lib/delivery/zones.js";
import { deductOrderStock, PaymentClaimError } from "../../lib/orderPayment.js";
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
  minorToLeones,
} from "../../lib/financialSettings.js";
import { priceOrder } from "../../lib/financialAllocation.js";
import { monimeEnabled } from "../../lib/monime/config.js";
import {
  CheckoutRefused,
  closeLinksBeforeCancel,
  paymentStatus,
  startCheckout,
} from "../../lib/monime/service.js";
import { notifyHqOfPaymentIssue } from "../../lib/hqNotifications.js";

const router = safeRouter();

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
       orangeMoneyNumber: pharmaciesTable.orangeMoneyNumber,
       afriMoneyNumber: pharmaciesTable.afriMoneyNumber,
       mobileMoneyNumber: pharmaciesTable.mobileMoneyNumber,
       mobileMoneyProvider: pharmaciesTable.mobileMoneyProvider,
       mobileMoneyAccountName: pharmaciesTable.mobileMoneyAccountName,
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
    pharmacy: (() => {
      const pharmacy = pharmacies.find((p) => p.id === o.pharmacyId);
      if (!pharmacy) return null;
      const paymentLines = mobileMoneyLines(pharmacy);
      return {
        ...pharmacy,
        mobileMoneyLines: paymentLines,
        // Kept for clients that predate the two-line split (the Expo app).
        mobileMoneyNumber: paymentLines[0]?.number ?? null,
        mobileMoneyProvider: paymentLines[0]?.provider ?? null,
      };
    })(),
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
  releaseAfterCompletion(updated);
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

  // An unpaid Monime order: delete its payment links first. If payment has
  // already started, wait for it rather than cancel an order being paid.
  const [current] = await db
    .select({ status: ordersTable.status, paymentProvider: ordersTable.paymentProvider })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, id), eq(ordersTable.patientId, patientId)))
    .limit(1);
  if (current?.paymentProvider === "monime" && current.status === "awaiting_payment") {
    const links = await closeLinksBeforeCancel(id);
    if (links !== "ok") {
      res.status(409).json({
        error:
          links === "paid"
            ? "Your payment has just come through, so the order is going ahead. Refresh to see it."
            : "A payment for this order is in progress. Wait a minute, then try again.",
        code: links === "paid" ? "ORDER_PAID" : "PAYMENT_IN_PROGRESS",
      });
      return;
    }
  }

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
  // Paid through Monime and cancelled before the money was released: HQ
  // refunds it by hand until refunds are automated (phase 3).
  if (cancelled.paymentProvider === "monime" && previous.paidAt) {
    void notifyHqOfPaymentIssue(
      cancelled,
      "Refund needed",
      "The patient cancelled a paid order before it was delivered or collected. Refund the payer by hand.",
    );
  }
  res.json((await hydratePatientOrders([cancelled]))[0]);
});

// ── POST /patient/orders — place an order ─────────────────────────────────────
router.post("/", async (req: AuthRequest, res) => {
  const patientId = req.pharmacy!.sub;
  // Every order is paid through MobiCare (Monime); there is no other way to
  // pay. Until Monime is switched on, orders can't be placed.
  if (!monimeEnabled()) {
    res.status(503).json({
      error: "Ordering opens once online payments are switched on. Please try again later.",
      code: "PAYMENTS_UNAVAILABLE",
    });
    return;
  }
  const body = z
    .object({
      pharmacyId: z.string().uuid(),
      fulfillmentType: z.enum(["delivery", "collection"]),
      // For delivery: the landmark or directions a courier needs, alongside
      // the pinned location, which is what the fee is worked out from.
      deliveryAddress: z.string().min(5).optional(),
      deliveryLocation: z
        .object({
          latitude: z.number().refine(isLatitude),
          longitude: z.number().refine(isLongitude),
        })
        .optional(),
      // The fee the patient was shown. Only used to notice that it changed
      // before they placed the order; the charge is always worked out here.
      quotedDeliveryFeeMinor: z.number().int().min(0).optional(),
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
  if (input.fulfillmentType === "delivery" && !input.deliveryLocation) {
    // Older app versions send only a typed address, which cannot be priced.
    res.status(400).json({
      error: "Pin your delivery location on the map to see the delivery fee.",
      code: "DELIVERY_LOCATION_REQUIRED",
    });
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

  let deliveryQuote: Extract<DeliveryQuote, { available: true }> | null = null;
  let deliveryPoint: Position | null = null;
  if (input.fulfillmentType === "delivery" && input.deliveryLocation) {
    deliveryPoint = [
      roundCoordinate(input.deliveryLocation.longitude),
      roundCoordinate(input.deliveryLocation.latitude),
    ];
    const quote = await quoteForPharmacy(pharmacy, deliveryPoint);
    if (!quote.available) {
      res.status(422).json({
        error: UNAVAILABLE_MESSAGES[quote.reason],
        code: "DELIVERY_UNAVAILABLE",
        reason: quote.reason,
      });
      return;
    }
    if (
      input.quotedDeliveryFeeMinor !== undefined &&
      input.quotedDeliveryFeeMinor !== quote.feeMinor
    ) {
      res.status(409).json({
        error: "The delivery fee has changed since you saw it. Check the new total before paying.",
        code: "DELIVERY_FEE_CHANGED",
        deliveryFeeMinor: quote.feeMinor,
      });
      return;
    }
    deliveryQuote = quote;
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
      brand: pharmacyInventoryTable.brand,
      manufacturer: pharmacyInventoryTable.manufacturer,
      countryOfOrigin: pharmacyInventoryTable.countryOfOrigin,
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

  // A controlled medicine's cap is per medicine, not per listing: two brands
  // of the same medicine in one order count together.
  const controlledTotals = new Map<string, { name: string; cap: number; quantity: number }>();
  for (const item of input.items) {
    const l = byInventory.get(item.inventoryId)!;
    if (l.tier !== "1" || l.maxUnitsPerOrder == null) continue;
    const total = controlledTotals.get(l.drugId) ?? { name: l.drugName, cap: l.maxUnitsPerOrder, quantity: 0 };
    total.quantity += item.quantity;
    controlledTotals.set(l.drugId, total);
  }
  for (const total of controlledTotals.values()) {
    if (total.quantity > total.cap) {
      res.status(409).json({
        error: `${total.name} is capped at ${total.cap} units per order, across all its brands`,
      });
      return;
    }
  }

  // Pilot pricing (decided 6 Oct 2026): no service fee for the patient, a 5%
  // commission from the pharmacy. The patient pays through Monime; the money
  // waits in MobiCare's Holding account until the order is complete, when the
  // pharmacy's share (its prices less 5%) is released to it.
  const pricing = priceOrder(pharmacyMedicineTotalMinor, "split_v1");
  const { medicineCommissionMinor, patientMedicineTotalMinor } = pricing;
  // Delivery is priced by zone and fixed on the order now, so a later fee
  // change never alters what this patient was quoted. The whole fee is
  // MobiCare's: its own riders deliver, so there is no separate courier payout.
  const deliveryFeeMinor = deliveryQuote?.feeMinor ?? 0;
  const courierPayoutMinor = 0;
  const deliveryCommissionMinor = deliveryFeeMinor;
  const totalMinor = patientMedicineTotalMinor + deliveryFeeMinor;
  const total = minorToLeones(totalMinor);

  if (prescriptionRequired && !input.prescriptionImageKey) {
    res.status(400).json({
      error:
        "This order contains prescription medicines — a prescription upload is required",
      code: "PRESCRIPTION_REQUIRED",
    });
    return;
  }


  // Create the checkout atomically without changing inventory. Stock is
  // verified again and deducted only after confirmed payment.
  let createdOrder: typeof ordersTable.$inferSelect;
  try {
    createdOrder = await db.transaction(async (tx) => {
      const [order] = await tx
        .insert(ordersTable)
        .values({
          pharmacyId: input.pharmacyId,
          patientId,
          patientName: patient.name,
          patientPhone: patient.phone,
          fulfillmentType: input.fulfillmentType,
          deliveryAddress: input.deliveryAddress ?? null,
          deliveryLatitude: deliveryPoint ? String(deliveryPoint[1]) : null,
          deliveryLongitude: deliveryPoint ? String(deliveryPoint[0]) : null,
          deliveryZoneId: deliveryQuote?.zoneId ?? null,
          deliveryZoneName: deliveryQuote?.zoneName ?? null,
          deliveryPricing: deliveryQuote?.pricing ?? null,
          status: "awaiting_payment",
          paymentMethod: "monime",
          paymentProvider: "monime",
          // A prescription order can be paid only once the pharmacist has
          // approved it; its payment window starts then.
          payableSince: prescriptionRequired ? null : new Date(),
          pricingModel: pricing.pricingModel,
          patientServiceFeeMinor: pricing.patientServiceFeeMinor,
          pharmacyCommissionMinor: pricing.pharmacyCommissionMinor,
          totalLeones: total,
          medicineMarkupBasisPoints: pricing.serviceFeeBasisPoints,
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
          const baseUnitPriceMinor = decimalLeonesToMinor(l.priceLeones);
          const baseLineTotalMinor = baseUnitPriceMinor * item.quantity;
          return {
            orderId: order!.id,
            inventoryId: item.inventoryId,
            drugId: l.drugId,
            drugName: l.drugName,
            brand: l.brand,
            manufacturer: l.manufacturer,
            countryOfOrigin: l.countryOfOrigin,
            quantity: item.quantity,
            unitPriceLeones: minorToLeones(baseUnitPriceMinor),
            baseUnitPriceMinor,
            patientUnitPriceMinor: baseUnitPriceMinor,
            patientLineTotalMinor: baseLineTotalMinor,
            prescriptionId:
              l.tier === "1" || l.tier === "2" ? prescriptionId : null,
          };
        }),
      );

      return order!;
    });
  } catch (err: any) {
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

// ── POST /patient/orders/:id/checkout: the Monime payment link ──────────────
// Returns the link to send the patient to (an existing live one, or a new
// one). Built on the server from the saved order; the browser sends nothing
// but the order ID.
const isOrderId = (id: unknown) => z.string().uuid().safeParse(id).success;

async function sendCheckout(req: AuthRequest, res: Parameters<Parameters<typeof router.post>[1]>[1], shared: boolean) {
  const patientId = req.pharmacy!.sub;
  if (!isOrderId(req.params.id)) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  try {
    const link = await startCheckout(req.params.id as string, patientId, { shared });
    res.json(link);
  } catch (err) {
    if (err instanceof CheckoutRefused) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
}

router.post("/:id/checkout", (req: AuthRequest, res) => sendCheckout(req, res, false));
// "Ask someone else to pay": a link the patient sends on, listing no medicines.
router.post("/:id/checkout/shared", (req: AuthRequest, res) => sendCheckout(req, res, true));

// ── Payment state for the patient's screen ──────────────────────────────────
// GET reads our records; POST …/check also asks Monime about the latest link
// (throttled), used while the patient waits on "Confirming your payment…".
async function sendPaymentStatus(req: AuthRequest, res: Parameters<Parameters<typeof router.get>[1]>[1], sync: boolean) {
  const patientId = req.pharmacy!.sub;
  if (!isOrderId(req.params.id)) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.id, req.params.id as string), eq(ordersTable.patientId, patientId)))
    .limit(1);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(await paymentStatus(order, sync));
}
router.get("/:id/payment", (req: AuthRequest, res) => sendPaymentStatus(req, res, false));
router.post("/:id/payment/check", (req: AuthRequest, res) => sendPaymentStatus(req, res, true));

export default router;
