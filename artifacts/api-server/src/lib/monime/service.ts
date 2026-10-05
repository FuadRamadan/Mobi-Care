import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  auditLogTable,
  monimeCheckoutSessionsTable,
  monimeWebhookEventsTable,
  orderItemsTable,
  ordersTable,
  pharmaciesTable,
  prescriptionsTable,
  type MonimeCheckoutSession as SessionRow,
  type Order,
} from "@workspace/db/schema";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { logger } from "../logger.js";
import { writeAudit } from "../audit.js";
import { checkOrderFlags } from "../flags.js";
import { decimalLeonesToMinor } from "../financialSettings.js";
import { notifyHqOfPaymentIssue } from "../hqNotifications.js";
import { deductOrderStock, PaymentClaimError } from "../orderPayment.js";
import {
  notifyPharmacyOfExpiredOrder,
  notifyPharmacyOfPaidOrder,
} from "../pharmacyNotifications.js";
import { createPatientNotification } from "../patientNotifications.js";
import { buildCheckoutSessionBody, CheckoutTotalMismatch } from "./checkout.js";
import {
  MonimeError,
  type CreateCheckoutSessionBody,
  type MonimeCheckoutSession,
  type MonimePayment,
} from "./client.js";
import { MONIME_WEBHOOK_HEADER, type MonimeConfig } from "./config.js";
import { monime } from "./connection.js";
import { checkoutKey } from "./keys.js";
import { runPayoutChecks, syncMovementForEvent } from "./payouts.js";

/**
 * Monime payments, phase 1: patients pay through a Monime payment link, and
 * an order becomes paid only once MobiCare has checked the payment with
 * Monime itself.
 *
 * Signals that a payment may have completed (a webhook, the patient coming
 * back from Monime's page, the 10-minute safety check) all end in the same
 * place: syncSession() fetches the payment link from Monime and, if it is
 * completed, confirmPayment() verifies the amount and reference before
 * marking the order paid. That routine is safe to run any number of times.
 */

/** Decision 8: how long the patient has to pay, from payableSince. */
export const MONIME_PAYMENT_WINDOW_MS = 2 * 60 * 60 * 1000;
/** A prescription order nobody reviews is dropped after this long. */
export const PRESCRIPTION_REVIEW_WINDOW_MS = 72 * 60 * 60 * 1000;
/** A link this close to expiry is replaced instead of handed out. */
const LINK_REUSE_MARGIN_MS = 2 * 60 * 1000;

// ── Wiring ─────────────────────────────────────────────────────────────────

export { monime, setMonimeClientForTests } from "./connection.js";

// ── Health: is Monime reachable, with the right token? ──────────────────────

const health: { ok: boolean; checkedAt: Date | null; problem: string | null } = {
  ok: false,
  checkedAt: null,
  problem: "Not checked yet",
};

export function monimeHealth() {
  return { ...health };
}

/**
 * Startup self-check: asks Monime who we are. Payments stay off unless the
 * token works, is for the environment this server is set to (test or live),
 * and the API version isn't deprecated.
 */
export async function checkMonimeHealth(): Promise<boolean> {
  const m = monime();
  if (!m) return false;
  try {
    const { result } = await m.client.root();
    const environment = result?.status?.environment ?? null;
    let problem: string | null = null;
    if (!result?.status?.isAuthenticated) problem = "Monime does not accept the access token";
    else if (environment !== m.config.mode) {
      problem = `The token is for Monime ${environment ?? "unknown"} but this server is set to ${m.config.mode}`;
    } else if (result?.apiVersion?.deprecated) {
      problem = `Monime API version ${result.apiVersion.id ?? m.config.apiVersion} is deprecated`;
    }
    health.ok = problem === null;
    health.problem = problem;
  } catch (err) {
    health.ok = false;
    health.problem = err instanceof Error ? err.message : "Could not reach Monime";
  }
  health.checkedAt = new Date();
  if (health.ok) logger.info({ mode: m.config.mode }, "Monime payments ready");
  else logger.error({ problem: health.problem }, "Monime payments unavailable");
  return health.ok;
}

// ── Errors the patient routes turn into answers ─────────────────────────────

export class CheckoutRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CheckoutRefused";
  }
}

// ── Prescription gate ──────────────────────────────────────────────────────

/**
 * A prescription order may be paid only once the pharmacist has approved
 * every prescription medicine in it. Returns why not, or null.
 */
async function prescriptionBlock(order: Order): Promise<CheckoutRefused | null> {
  if (!order.prescriptionId) return null;
  const [rx] = await db
    .select({ status: prescriptionsTable.status, approvedDrugIds: prescriptionsTable.approvedDrugIds })
    .from(prescriptionsTable)
    .where(eq(prescriptionsTable.id, order.prescriptionId))
    .limit(1);
  if (!rx || rx.status === "pending") {
    return new CheckoutRefused(
      409,
      "PRESCRIPTION_PENDING",
      "A pharmacist is still checking your prescription. You can pay as soon as it is approved; we'll let you know.",
    );
  }
  if (rx.status === "rejected") {
    return new CheckoutRefused(
      409,
      "PRESCRIPTION_REJECTED",
      "The pharmacist rejected your prescription, so this order can't be paid. Nothing has been charged.",
    );
  }
  const needed = await db
    .select({ drugId: orderItemsTable.drugId })
    .from(orderItemsTable)
    .where(and(eq(orderItemsTable.orderId, order.id), isNotNull(orderItemsTable.prescriptionId)));
  const approved = new Set(rx.approvedDrugIds ?? []);
  if (needed.some((item) => !approved.has(item.drugId))) {
    return new CheckoutRefused(
      409,
      "PRESCRIPTION_PARTIAL",
      "The pharmacist approved only some of the medicines. Place a new order with the approved ones; this order won't be charged.",
    );
  }
  return null;
}

// ── Creating the payment link ───────────────────────────────────────────────

export interface CheckoutLink {
  status: "pending" | "paid";
  redirectUrl: string | null;
  expireTime: string | null;
}

async function loadCheckoutOrder(order: Order) {
  const [pharmacy] = await db
    .select({ name: pharmaciesTable.name })
    .from(pharmaciesTable)
    .where(eq(pharmaciesTable.id, order.pharmacyId))
    .limit(1);
  const items = await db
    .select()
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, order.id))
    .orderBy(asc(orderItemsTable.createdAt), asc(orderItemsTable.id));
  return {
    id: order.id,
    pharmacyId: order.pharmacyId,
    pharmacyName: pharmacy?.name ?? "the pharmacy",
    totalMinor: decimalLeonesToMinor(order.totalLeones),
    patientServiceFeeMinor: order.patientServiceFeeMinor,
    serviceFeeBasisPoints: order.medicineMarkupBasisPoints,
    deliveryFeeMinor: order.deliveryFeeMinor,
    deliveryZoneName: order.deliveryZoneName,
    items: items.map((item) => ({
      id: item.id,
      drugName: item.drugName,
      brand: item.brand,
      unitPriceMinor: item.baseUnitPriceMinor,
      quantity: item.quantity,
    })),
  };
}

const sessionLink = (row: SessionRow): CheckoutLink => ({
  status: "pending",
  redirectUrl: row.redirectUrl,
  expireTime: row.expireTime?.toISOString() ?? null,
});

const usable = (row: SessionRow | undefined) =>
  row?.status === "pending" &&
  Boolean(row.redirectUrl) &&
  (!row.expireTime || row.expireTime.getTime() - Date.now() > LINK_REUSE_MARGIN_MS);

async function latestSession(orderId: string): Promise<SessionRow | undefined> {
  const [row] = await db
    .select()
    .from(monimeCheckoutSessionsTable)
    .where(eq(monimeCheckoutSessionsTable.orderId, orderId))
    .orderBy(desc(monimeCheckoutSessionsTable.attempt))
    .limit(1);
  return row;
}

/**
 * The patient's payment link for an order: an existing live one if there is
 * one, otherwise a new one. A double tap gets the same link: the new attempt
 * is saved under a row lock before Monime is called, and a second request
 * re-sends the identical request with the same idempotency key.
 */
export async function startCheckout(orderId: string, patientId: string): Promise<CheckoutLink> {
  const m = monime();
  if (!m) throw new CheckoutRefused(409, "MONIME_DISABLED", "Online payment is not switched on.");

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.patientId, patientId)))
    .limit(1);
  if (!order) throw new CheckoutRefused(404, "ORDER_NOT_FOUND", "Order not found");
  if (order.paymentProvider !== "monime") {
    throw new CheckoutRefused(409, "PAY_DIRECT", "This order is paid directly to the pharmacy.");
  }
  if (order.paidAt || order.status !== "awaiting_payment") {
    if (order.paidAt) return { status: "paid", redirectUrl: null, expireTime: null };
    throw new CheckoutRefused(409, "ORDER_NOT_AWAITING_PAYMENT", "This order can no longer be paid.");
  }
  const blocked = await prescriptionBlock(order);
  if (blocked) throw blocked;
  if (order.payableSince && Date.now() - order.payableSince.getTime() > MONIME_PAYMENT_WINDOW_MS) {
    throw new CheckoutRefused(
      409,
      "PAYMENT_WINDOW_EXPIRED",
      "The time to pay for this order has run out. Please place it again.",
    );
  }

  // An existing link: check it with Monime before handing it out again.
  const previous = await latestSession(order.id);
  if (previous?.status === "pending") {
    const synced = await syncSession(previous);
    if (synced.status === "completed") {
      return { status: "paid", redirectUrl: null, expireTime: null };
    }
    if (usable(synced)) return sessionLink(synced);
    if (synced.status === "pending" && synced.monimeSessionId) {
      // About to expire: retire it so only one link is ever live.
      await retireSession(synced);
      const after = await latestSession(order.id);
      if (after?.status === "completed") return { status: "paid", redirectUrl: null, expireTime: null };
      if (after?.status === "pending") return sessionLink(after);
    }
  }

  if (!monimeHealth().ok && !(await checkMonimeHealth())) {
    throw new CheckoutRefused(
      503,
      "PAYMENTS_UNAVAILABLE",
      "Online payment is temporarily unavailable. Please try again in a few minutes.",
    );
  }

  const checkoutOrder = await loadCheckoutOrder(order);
  const row = await db.transaction(async (tx) => {
    await tx.select({ id: ordersTable.id }).from(ordersTable).where(eq(ordersTable.id, order.id)).for("update");
    const [latest] = await tx
      .select()
      .from(monimeCheckoutSessionsTable)
      .where(eq(monimeCheckoutSessionsTable.orderId, order.id))
      .orderBy(desc(monimeCheckoutSessionsTable.attempt))
      .limit(1);
    if (latest && (latest.status === "creating" || usable(latest))) return latest;
    const attempt = (latest?.attempt ?? 0) + 1;
    let body: CreateCheckoutSessionBody;
    try {
      body = buildCheckoutSessionBody(checkoutOrder, attempt, m.config);
    } catch (err) {
      if (err instanceof CheckoutTotalMismatch) {
        logger.error({ orderId: order.id, err }, "Payment link total does not match the order");
        throw new CheckoutRefused(
          409,
          "TOTAL_MISMATCH",
          "This order's total could not be confirmed. Please contact MobiCare; nothing has been charged.",
        );
      }
      throw err;
    }
    const [created] = await tx
      .insert(monimeCheckoutSessionsTable)
      .values({
        orderId: order.id,
        attempt,
        idempotencyKey: checkoutKey(order.id, attempt),
        requestBody: body,
        amountMinor: checkoutOrder.totalMinor,
        status: "creating",
      })
      .returning();
    return created!;
  });

  if (row.status !== "creating") return sessionLink(row);
  const sent = await sendCreate(row);
  if (sent.status !== "pending" || !sent.redirectUrl) {
    throw new CheckoutRefused(
      502,
      "LINK_NOT_CREATED",
      "The payment link could not be created. Please try again.",
    );
  }
  return sessionLink(sent);
}

/** Sends a saved create request (again). Same body, same key: never a second link. */
async function sendCreate(row: SessionRow): Promise<SessionRow> {
  const m = monime();
  if (!m) return row;
  try {
    const { result, requestId } = await m.client.createCheckoutSession(
      row.requestBody as CreateCheckoutSessionBody,
      row.idempotencyKey,
    );
    const [updated] = await db
      .update(monimeCheckoutSessionsTable)
      .set({
        status: result.status === "pending" ? "pending" : normaliseStatus(result.status),
        monimeSessionId: result.id,
        monimeOrderNumber: result.orderNumber ?? null,
        redirectUrl: result.redirectUrl ?? null,
        expireTime: result.expireTime ? new Date(result.expireTime) : null,
        monimeRequestId: requestId,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(monimeCheckoutSessionsTable.id, row.id), eq(monimeCheckoutSessionsTable.status, "creating")))
      .returning();
    return updated ?? (await reload(row));
  } catch (err) {
    if (err instanceof MonimeError && err.isFinal) {
      // Refused for good (e.g. a 409 key reuse is a bug, not a retry case).
      logger.error({ orderId: row.orderId, status: err.status, reason: err.reason, requestId: err.requestId }, "Monime refused the payment link");
      await db
        .update(monimeCheckoutSessionsTable)
        .set({ status: "failed", updatedAt: new Date() })
        .where(and(eq(monimeCheckoutSessionsTable.id, row.id), eq(monimeCheckoutSessionsTable.status, "creating")));
      if (err.reason === "idempotency_key_in_use") {
        const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, row.orderId)).limit(1);
        if (order) {
          void notifyHqOfPaymentIssue(order, "Payment link refused", "Monime reported a reused idempotency key. The link was not created; please investigate.");
        }
      }
    } else {
      // Unknown outcome: the row stays 'creating' and the same request is
      // re-sent later (by the patient or the safety check).
      logger.warn({ orderId: row.orderId, err }, "Payment link request did not complete; will retry");
    }
    return reload(row);
  }
}

async function reload(row: SessionRow): Promise<SessionRow> {
  const [fresh] = await db
    .select()
    .from(monimeCheckoutSessionsTable)
    .where(eq(monimeCheckoutSessionsTable.id, row.id))
    .limit(1);
  return fresh ?? row;
}

function normaliseStatus(status: string): string {
  return ["pending", "completed", "expired", "cancelled"].includes(status) ? status : "pending";
}

/** Deletes a link the patient hasn't started paying. Monime refuses once payment has begun. */
async function retireSession(row: SessionRow): Promise<boolean> {
  const m = monime();
  if (!m || !row.monimeSessionId) return false;
  try {
    await m.client.deleteCheckoutSession(row.monimeSessionId);
    await db
      .update(monimeCheckoutSessionsTable)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(and(eq(monimeCheckoutSessionsTable.id, row.id), eq(monimeCheckoutSessionsTable.status, "pending")));
    return true;
  } catch (err) {
    // Payment may have started: look again rather than assume.
    logger.info({ orderId: row.orderId, err }, "Payment link could not be deleted; checking it");
    await syncSession(row);
    return false;
  }
}

// ── Checking a link with Monime ─────────────────────────────────────────────

/**
 * Fetches a payment link from Monime and records its status. If it is
 * completed, the payment is verified and the order marked paid.
 */
export async function syncSession(row: SessionRow): Promise<SessionRow> {
  const m = monime();
  if (!m) return row;
  if (row.status === "creating") return sendCreate(row);
  if (!row.monimeSessionId || row.status === "completed" || row.status === "failed") return row;

  let session: MonimeCheckoutSession;
  try {
    ({ result: session } = await m.client.getCheckoutSession(row.monimeSessionId));
  } catch (err) {
    logger.warn({ orderId: row.orderId, err }, "Could not check the payment link with Monime");
    return row;
  }
  const status = normaliseStatus(session.status);
  if (status === "completed") {
    await confirmPayment(row, session);
    return reload(row);
  }
  const [updated] = await db
    .update(monimeCheckoutSessionsTable)
    .set({
      // A link we deleted stays 'deleted' even if Monime calls it expired.
      status: row.status === "deleted" ? "deleted" : status,
      monimeOrderNumber: session.orderNumber ?? row.monimeOrderNumber,
      expireTime: session.expireTime ? new Date(session.expireTime) : row.expireTime,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(monimeCheckoutSessionsTable.id, row.id))
    .returning();
  return updated ?? row;
}

/**
 * Checks a completed payment link against our records before anything
 * changes: it must name this order, have been paid into the right account,
 * and the payment must be completed for exactly the amount the order was
 * created for. Then the order is marked paid (once).
 */
async function confirmPayment(row: SessionRow, session: MonimeCheckoutSession): Promise<void> {
  const m = monime();
  if (!m) return;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, row.orderId)).limit(1);
  if (!order) return;

  const problems: string[] = [];
  if (session.reference !== order.id) problems.push("the link names a different order");
  if (session.metadata?.mc_order_id && session.metadata.mc_order_id !== order.id) {
    problems.push("the link's order label is different");
  }
  if (session.financialAccountId !== m.config.holdingAccountId) {
    problems.push("the money went to a different Monime account");
  }

  let payment: MonimePayment | undefined;
  const orderNumber = session.orderNumber ?? row.monimeOrderNumber;
  if (orderNumber) {
    try {
      const { result } = await m.client.listPaymentsByOrderNumber(orderNumber);
      payment = (result ?? []).find((p) => p.status === "completed");
    } catch (err) {
      logger.warn({ orderId: order.id, err }, "Could not fetch the payment from Monime");
      return; // try again on the next signal
    }
  }
  if (!payment) {
    // Completed link but no completed payment yet: check again later.
    logger.info({ orderId: order.id }, "Payment link completed; payment not confirmed yet");
    return;
  }
  const expectedMinor = decimalLeonesToMinor(order.totalLeones);
  if (payment.amount?.currency !== "SLE") problems.push(`paid in ${payment.amount?.currency ?? "an unknown currency"}`);
  if (payment.amount?.value !== row.amountMinor || row.amountMinor !== expectedMinor) {
    problems.push(`paid ${payment.amount?.value ?? "?"} cents but the order is ${expectedMinor}`);
  }

  await db
    .update(monimeCheckoutSessionsTable)
    .set({
      status: "completed",
      monimeOrderNumber: orderNumber,
      monimePaymentId: payment.id,
      fees: payment.fees ?? null,
      payerChannel: payment.channel?.type ?? null,
      payerProvider: payment.channel?.provider ?? null,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(monimeCheckoutSessionsTable.id, row.id));

  if (problems.length > 0) {
    logger.error({ orderId: order.id, problems }, "Monime payment does not match its order");
    await notifyHqOfPaymentIssue(order, "Payment does not match its order", `${problems.join("; ")}. The order was NOT marked paid. Check it in Monime.`);
    return;
  }
  await markOrderPaid(order.id, payment);
}

/**
 * Marks a verified payment's order paid and takes its stock, exactly once.
 * A payment for an order that has meanwhile expired is accepted if the stock
 * is still there ('revived'); otherwise, or if the patient cancelled it
 * themselves, it is flagged for a refund.
 */
async function markOrderPaid(orderId: string, payment: MonimePayment): Promise<void> {
  type Outcome = { kind: "paid" | "revived"; order: Order } | { kind: "refund"; order: Order; why: string } | { kind: "noop" };

  const cancelledByPatient = async () => {
    const [entry] = await db
      .select({ id: auditLogTable.id })
      .from(auditLogTable)
      .where(and(eq(auditLogTable.entityId, orderId), eq(auditLogTable.action, "order.cancelled_by_patient")))
      .limit(1);
    return Boolean(entry);
  };
  const patientCancelled = await cancelledByPatient();

  const outcome: Outcome = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(ordersTable).where(eq(ordersTable.id, orderId)).for("update");
    if (!locked || locked.paidAt) return { kind: "noop" } as const;
    const now = new Date();
    const late = locked.status === "cancelled";
    if (locked.status !== "awaiting_payment" && !late) return { kind: "noop" } as const;
    if (late && patientCancelled) {
      const [flagged] = await tx
        .update(ordersTable)
        .set({ paidAt: now, latePaymentStatus: "refund_needed", updatedAt: now })
        .where(eq(ordersTable.id, orderId))
        .returning();
      return { kind: "refund", order: flagged!, why: "The patient cancelled the order before the payment arrived." } as const;
    }
    try {
      return await tx.transaction(async (inner) => {
        const [claimed] = await inner
          .update(ordersTable)
          .set({ status: "paid", paidAt: now, latePaymentStatus: late ? "revived" : null, updatedAt: now })
          .where(eq(ordersTable.id, orderId))
          .returning();
        await deductOrderStock(inner, claimed!);
        return { kind: late ? "revived" : "paid", order: claimed! } as const;
      });
    } catch (err) {
      if (!(err instanceof PaymentClaimError)) throw err;
      // Paid, but the medicine is no longer in stock: money must go back.
      const [flagged] = await tx
        .update(ordersTable)
        .set({ status: "cancelled", paidAt: now, latePaymentStatus: "refund_needed", updatedAt: now })
        .where(eq(ordersTable.id, orderId))
        .returning();
      return {
        kind: "refund",
        order: flagged!,
        why: late
          ? "The payment arrived after the order expired and the stock is no longer available."
          : "The payment arrived but the medicine is no longer in stock.",
      } as const;
    }
  });

  if (outcome.kind === "noop") return;
  const order = outcome.order;
  await writeAudit({
    actorType: "system",
    actorId: null,
    actorName: "Monime",
    action: outcome.kind === "refund" ? "order.payment_needs_refund" : "order.payment_confirmed",
    entityType: "order",
    entityId: order.id,
    details: {
      provider: "monime",
      monimePaymentId: payment.id,
      channel: payment.channel?.type ?? null,
      network: payment.channel?.provider ?? null,
      amountMinor: payment.amount?.value ?? null,
      fees: payment.fees ?? [],
      outcome: outcome.kind,
    },
  });

  if (outcome.kind === "refund") {
    await notifyHqOfPaymentIssue(order, "Refund needed", `${outcome.why} Refund it by hand.`);
    if (order.patientId) {
      void createPatientNotification({
        patientId: order.patientId,
        patientPhone: order.patientPhone,
        title: "Payment received, order can't go ahead",
        body: "We received your payment but the order can't be completed. MobiCare will refund you; no need to do anything.",
        type: "payment",
        referenceId: order.id,
      });
    }
    return;
  }

  await checkOrderFlags(order);
  void notifyPharmacyOfPaidOrder(order);
  if (order.patientId) {
    void createPatientNotification({
      patientId: order.patientId,
      patientPhone: order.patientPhone,
      title: "Payment received ✓",
      body: "Thank you. The pharmacy has your order and will confirm it shortly.",
      type: "payment",
      referenceId: order.id,
    });
  }
}

// ── Patient return / status ─────────────────────────────────────────────────

const lastPatientSync = new Map<string, number>();

/**
 * The order's payment state for the patient's screen. With `sync`, the
 * latest link is checked with Monime (at most every 5 seconds per order, to
 * stay well within Monime's rate limits).
 */
export async function paymentStatus(order: Order, sync: boolean) {
  let row = order.paymentProvider === "monime" ? await latestSession(order.id) : undefined;
  if (sync && row && (row.status === "pending" || row.status === "creating")) {
    const last = lastPatientSync.get(order.id) ?? 0;
    if (Date.now() - last > 5_000) {
      lastPatientSync.set(order.id, Date.now());
      row = await syncSession(row);
    }
  }
  const [fresh] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id)).limit(1);
  const current = fresh ?? order;
  return {
    orderStatus: current.status,
    paymentProvider: current.paymentProvider,
    paid: Boolean(current.paidAt) || (current.paymentProvider === "direct" && current.status !== "awaiting_payment" && current.status !== "cancelled"),
    latePaymentStatus: current.latePaymentStatus,
    payableSince: current.payableSince?.toISOString() ?? null,
    payBy: current.payableSince
      ? new Date(current.payableSince.getTime() + MONIME_PAYMENT_WINDOW_MS).toISOString()
      : null,
    link: row
      ? {
          status: row.status,
          redirectUrl: row.status === "pending" ? row.redirectUrl : null,
          expireTime: row.expireTime?.toISOString() ?? null,
        }
      : null,
  };
}

// ── Cancelling an unpaid Monime order ───────────────────────────────────────

/**
 * Before a patient cancels an unpaid Monime order, its live links are
 * deleted. If one can't be deleted because payment has started, the cancel
 * waits: otherwise the money could arrive for a cancelled order.
 */
export async function closeLinksBeforeCancel(orderId: string): Promise<"ok" | "payment_in_progress" | "paid"> {
  const rows = await db
    .select()
    .from(monimeCheckoutSessionsTable)
    .where(and(eq(monimeCheckoutSessionsTable.orderId, orderId), inArray(monimeCheckoutSessionsTable.status, ["pending", "creating"])));
  for (const row of rows) {
    const synced = await syncSession(row);
    if (synced.status === "completed") return "paid";
    if (synced.status === "pending" && !(await retireSession(synced))) {
      const again = await reload(synced);
      return again.status === "completed" ? "paid" : "payment_in_progress";
    }
  }
  return "ok";
}

// ── Webhooks ───────────────────────────────────────────────────────────────

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

function headerTokenOk(config: MonimeConfig, headerValue: string | undefined): boolean {
  if (!config.webhookHeaderToken) return true;
  if (!headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(config.webhookHeaderToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * A Monime webhook. Only the envelope is used (event id and name, object
 * type and id); the object itself is always fetched from Monime's API, so a
 * forged or outdated body can't mark anything paid. The signature header is
 * checked once Monime documents its ES256 format; until then the custom
 * header token keeps out strangers and the API re-check keeps out forgeries.
 */
export async function handleWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<WebhookResult> {
  const m = monime();
  if (!m) return { status: 404, body: { error: "Not found" } };
  const token = headers[MONIME_WEBHOOK_HEADER];
  if (!headerTokenOk(m.config, Array.isArray(token) ? token[0] : token)) {
    logger.warn("Monime webhook refused: wrong or missing header token");
    return { status: 401, body: { error: "Unauthorized" } };
  }

  let envelope: any;
  try {
    envelope = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }
  const eventId = envelope?.event?.id;
  const name = envelope?.event?.name;
  if (typeof eventId !== "string" || !eventId || typeof name !== "string" || !name) {
    return { status: 400, body: { error: "Not a Monime event" } };
  }
  const objectType: string | null = typeof envelope?.object?.type === "string" ? envelope.object.type : null;
  const objectId: string | null = typeof envelope?.object?.id === "string" ? envelope.object.id : null;
  const seconds = Number(envelope?.event?.timestamp);

  const inserted = await db
    .insert(monimeWebhookEventsTable)
    .values({
      eventId,
      name,
      objectType,
      objectId,
      eventTimestamp: Number.isFinite(seconds) ? new Date(seconds * 1000) : null,
      payload: envelope,
    })
    .onConflictDoNothing()
    .returning({ eventId: monimeWebhookEventsTable.eventId });
  if (inserted.length === 0) {
    const [existing] = await db
      .select({ outcome: monimeWebhookEventsTable.outcome })
      .from(monimeWebhookEventsTable)
      .where(eq(monimeWebhookEventsTable.eventId, eventId))
      .limit(1);
    if (existing && (existing.outcome === "processed" || existing.outcome === "ignored")) {
      return { status: 200, body: { received: true, duplicate: true } };
    }
  }

  let outcome: "processed" | "ignored" | "failed" = "ignored";
  let detail: string | null = null;
  try {
    const movement = await syncMovementForEvent(objectType, objectId);
    const row = movement ? undefined : await sessionForEvent(objectType, objectId);
    if (movement) {
      outcome = "processed";
      detail = movement;
    } else if (row) {
      const synced = await syncSession(row);
      outcome = "processed";
      detail = `link ${synced.status}`;
    } else {
      detail = objectType ? `nothing to do for ${objectType}` : "no object";
    }
  } catch (err) {
    outcome = "failed";
    detail = err instanceof Error ? err.message.slice(0, 200) : "error";
    logger.error({ eventId, name, err }, "Monime webhook processing failed");
  }
  await db
    .update(monimeWebhookEventsTable)
    .set({ outcome, detail, processedAt: new Date() })
    .where(eq(monimeWebhookEventsTable.eventId, eventId));
  // A failure answers 500 so Monime sends it again.
  return outcome === "failed"
    ? { status: 500, body: { error: "Processing failed" } }
    : { status: 200, body: { received: true } };
}

async function sessionForEvent(objectType: string | null, objectId: string | null): Promise<SessionRow | undefined> {
  if (!objectId) return undefined;
  if (objectType === "checkout_session") {
    const [row] = await db
      .select()
      .from(monimeCheckoutSessionsTable)
      .where(eq(monimeCheckoutSessionsTable.monimeSessionId, objectId))
      .limit(1);
    return row;
  }
  if (objectType === "payment") {
    const m = monime();
    if (!m) return undefined;
    const { result: payment } = await m.client.getPayment(objectId);
    if (!payment?.orderNumber) return undefined;
    const [row] = await db
      .select()
      .from(monimeCheckoutSessionsTable)
      .where(eq(monimeCheckoutSessionsTable.monimeOrderNumber, payment.orderNumber))
      .limit(1);
    return row;
  }
  // Transfers and payouts are handled by syncMovementForEvent (phase 2).
  return undefined;
}

// ── Background jobs ────────────────────────────────────────────────────────

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The safety check (every 10 minutes): re-sends link requests whose answer
 * was lost, and checks links still pending after 15 minutes, in case a
 * webhook never came. One request at a time, to respect Monime's limits.
 */
export async function runSafetyCheck(): Promise<void> {
  const stuck = await db
    .select()
    .from(monimeCheckoutSessionsTable)
    .where(
      or(
        and(eq(monimeCheckoutSessionsTable.status, "creating"), lt(monimeCheckoutSessionsTable.updatedAt, new Date(Date.now() - 2 * 60_000))),
        and(eq(monimeCheckoutSessionsTable.status, "pending"), lt(monimeCheckoutSessionsTable.createdAt, new Date(Date.now() - 15 * 60_000))),
      ),
    )
    .orderBy(asc(monimeCheckoutSessionsTable.updatedAt))
    .limit(100);
  for (const row of stuck) {
    await syncSession(row);
    await pause(200);
  }
}

/**
 * Cancels unpaid Monime orders whose time to pay has run out (2 hours from
 * payableSince, or 72 hours for a prescription nobody reviewed). Each order's
 * links are checked and deleted first; an order whose payment has started
 * waits for the next round.
 */
export async function expireUnpaidMonimeOrders(): Promise<number> {
  const now = Date.now();
  const stale = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.status, "awaiting_payment"),
        eq(ordersTable.paymentProvider, "monime"),
        or(
          lt(ordersTable.payableSince, new Date(now - MONIME_PAYMENT_WINDOW_MS)),
          and(isNull(ordersTable.payableSince), lt(ordersTable.createdAt, new Date(now - PRESCRIPTION_REVIEW_WINDOW_MS))),
        ),
      ),
    )
    .limit(50);
  let expired = 0;
  for (const order of stale) {
    const links = await closeLinksBeforeCancel(order.id);
    if (links !== "ok") continue;
    const [claimed] = await db
      .update(ordersTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(ordersTable.id, order.id), eq(ordersTable.status, "awaiting_payment"), isNull(ordersTable.paidAt)))
      .returning({ id: ordersTable.id, pharmacyId: ordersTable.pharmacyId });
    if (claimed) {
      expired += 1;
      void notifyPharmacyOfExpiredOrder({ pharmacyId: claimed.pharmacyId, orderId: claimed.id });
    }
    await pause(200);
  }
  if (expired > 0) logger.info({ count: expired }, "Expired unpaid Monime orders");
  return expired;
}

let timers: NodeJS.Timeout[] = [];

export function startMonimeJobs(): void {
  if (!monime() || timers.length > 0) return;
  void checkMonimeHealth();
  const guard = (name: string, job: () => Promise<unknown>) => () => {
    job().catch((err) => logger.error({ err }, `${name} failed`));
  };
  // Until Monime answers correctly, look again every 5 minutes.
  timers.push(
    setInterval(guard("Monime health check", async () => {
      if (!health.ok) await checkMonimeHealth();
    }), 5 * 60_000).unref(),
    setInterval(guard("Monime safety check", runSafetyCheck), 10 * 60_000).unref(),
    setInterval(guard("Monime order expiry", expireUnpaidMonimeOrders), 60_000).unref(),
    setInterval(guard("Monime payouts check", runPayoutChecks), 5 * 60_000).unref(),
  );
}

export function stopMonimeJobs(): void {
  for (const timer of timers) clearInterval(timer);
  timers = [];
}

