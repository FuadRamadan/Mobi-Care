import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  monimeCheckoutSessionsTable,
  monimeTransfersTable,
  ordersTable,
  pharmaciesTable,
  pharmacyCashoutsTable,
  pharmacyMonimeAccountsTable,
  type MonimeTransfer,
  type Order,
  type PharmacyCashout,
} from "@workspace/db/schema";
import { and, asc, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import { logger } from "../logger.js";
import { writeAudit } from "../audit.js";
import { notifyHqOfPayoutIssue } from "../hqNotifications.js";
import { createPharmacyNotification } from "../pharmacyNotifications.js";
import {
  MonimeError,
  type CreateFinancialAccountBody,
  type CreateInternalTransferBody,
  type CreatePayoutBody,
  type MonimeInternalTransfer,
  type MonimePayout,
} from "./client.js";
import { monime } from "./connection.js";
import { cashoutKey, pharmacyAccountKey, transferKey } from "./keys.js";
import {
  CASHOUT_APPROVAL_THRESHOLD_MINOR,
  MIN_CASHOUT_MINOR,
  PROVIDER_NAMES,
  cashoutDestination,
  cashoutFailureMessage,
  maskPhone,
  maxCashoutMinor,
  releaseAmounts,
  reservedFeeMinor,
  sumFeesMinor,
  type PayoutProvider,
} from "./payoutRules.js";

/**
 * Monime payments, phase 2: releasing order money and pharmacy cash-outs.
 *
 * - When an online-paid order is delivered or collected, two internal
 *   transfers leave Holding: the pharmacy's share (medicine total less the 5%
 *   commission) to the pharmacy's own Monime account, and MobiCare's share
 *   (service fee, commission and delivery, less Monime's collection fee) to
 *   Revenue. Nothing is released for a cancelled or refunded order.
 * - A pharmacy cashes out from its available balance, only to its registered
 *   Orange Money or AfriMoney number. Monime's payout fee comes on top, from
 *   the balance. Above Le 2,000 HQ approves first.
 *
 * Every movement is saved, with its exact request and a fixed idempotency
 * key, before Monime is called. A lost answer is recovered by re-sending the
 * identical request, which Monime answers with the original object, so money
 * can never move twice. Webhooks and a 5-minute check bring each one to its
 * final state.
 */

const OPEN_CASHOUT = ["awaiting_approval", "sending", "pending", "processing"] as const;
/** Cash-outs that hold money back from the balance (all but failed, rejected and cancelled). */
const COMMITTED_CASHOUT = [...OPEN_CASHOUT, "completed"] as const;

const shortId = (id: string) => id.slice(0, 8).toUpperCase();
const le = (minor: number) => `Le ${(minor / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function rows(query: SQL): Promise<Record<string, unknown>[]> {
  const result = (await db.execute(query)) as unknown as { rows?: Record<string, unknown>[] };
  return result.rows ?? (result as unknown as Record<string, unknown>[]);
}

/** Monime's answer status, kept to the states we store. */
function movementStatus(status: string | undefined): "pending" | "processing" | "completed" | "failed" {
  return status === "processing" || status === "completed" || status === "failed" ? status : "pending";
}

// ── Pharmacy accounts ──────────────────────────────────────────────────────

/**
 * The pharmacy's account in MobiCare's Monime space, created the first time
 * money is released to it. Its reference is the pharmacy ID, so an account
 * made by a request whose answer was lost is found again by reference.
 */
export async function ensurePharmacyAccount(pharmacyId: string): Promise<string> {
  const m = monime();
  if (!m) throw new Error("Monime payments are off");
  const [existing] = await db
    .select()
    .from(pharmacyMonimeAccountsTable)
    .where(eq(pharmacyMonimeAccountsTable.pharmacyId, pharmacyId))
    .limit(1);
  if (existing?.status === "active" && existing.monimeAccountId) return existing.monimeAccountId;

  let row = existing;
  if (!row) {
    const [pharmacy] = await db
      .select({ name: pharmaciesTable.name })
      .from(pharmaciesTable)
      .where(eq(pharmaciesTable.id, pharmacyId))
      .limit(1);
    if (!pharmacy) throw new Error("Pharmacy not found");
    const body: CreateFinancialAccountBody = {
      name: `Pharmacy: ${pharmacy.name}`.slice(0, 100),
      currency: "SLE",
      reference: pharmacyId,
      metadata: { mc_pharmacy_id: pharmacyId, mc_kind: "pharmacy_account", mc_env: m.config.mode },
    };
    await db
      .insert(pharmacyMonimeAccountsTable)
      .values({ pharmacyId, idempotencyKey: pharmacyAccountKey(pharmacyId), requestBody: body })
      .onConflictDoNothing();
    [row] = await db
      .select()
      .from(pharmacyMonimeAccountsTable)
      .where(eq(pharmacyMonimeAccountsTable.pharmacyId, pharmacyId))
      .limit(1);
  }
  if (!row) throw new Error("Could not record the pharmacy account");

  // An earlier attempt may have created it and lost the answer.
  const { result: found } = await m.client.findFinancialAccountsByReference(pharmacyId);
  let accountId = (found ?? []).find((account) => account.reference === pharmacyId)?.id ?? null;
  if (!accountId) {
    const { result } = await m.client.createFinancialAccount(
      row.requestBody as CreateFinancialAccountBody,
      row.idempotencyKey,
    );
    accountId = result.id;
  }
  await db
    .update(pharmacyMonimeAccountsTable)
    .set({ status: "active", monimeAccountId: accountId, updatedAt: new Date() })
    .where(eq(pharmacyMonimeAccountsTable.pharmacyId, pharmacyId));
  logger.info({ pharmacyId }, "Pharmacy Monime account ready");
  return accountId;
}

// ── Releasing order money ──────────────────────────────────────────────────

const RELEASE_KINDS = ["pharmacy_share", "mobicare_share"] as const;
type ReleaseKind = (typeof RELEASE_KINDS)[number];

/**
 * Releases a completed order's money out of Holding. Safe to call any number
 * of times: each share is created once, and only sent while not yet sent.
 * Called when an order is delivered or collected, and by the 5-minute check
 * for any completed order it missed.
 */
export async function releaseOrderFunds(orderId: string): Promise<void> {
  const m = monime();
  if (!m) return;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  if (!order || !isReleasable(order)) return;

  const [session] = await db
    .select()
    .from(monimeCheckoutSessionsTable)
    .where(and(eq(monimeCheckoutSessionsTable.orderId, orderId), eq(monimeCheckoutSessionsTable.status, "completed")))
    .orderBy(desc(monimeCheckoutSessionsTable.attempt))
    .limit(1);
  if (!session) {
    logger.error({ orderId }, "Completed online order has no completed payment link");
    return;
  }

  const existing = await db.select().from(monimeTransfersTable).where(eq(monimeTransfersTable.orderId, orderId));
  const missing = RELEASE_KINDS.filter((kind) => !existing.some((row) => row.kind === kind));
  if (missing.length > 0) {
    const amounts = releaseAmounts({
      paidMinor: session.amountMinor,
      pharmacyMedicineTotalMinor: order.pharmacyMedicineTotalMinor,
      pharmacyCommissionMinor: order.pharmacyCommissionMinor,
      collectionFeesMinor: sumFeesMinor(session.fees),
    });
    const pharmacyAccountId = missing.includes("pharmacy_share") ? await ensurePharmacyAccount(order.pharmacyId) : null;
    for (const kind of missing) {
      const amountMinor = kind === "pharmacy_share" ? amounts.pharmacyShareMinor : amounts.mobicareShareMinor;
      const destination = kind === "pharmacy_share" ? pharmacyAccountId! : m.config.revenueAccountId;
      await db
        .insert(monimeTransfersTable)
        .values({
          orderId,
          pharmacyId: order.pharmacyId,
          kind,
          attempt: 1,
          amountMinor,
          sourceAccountId: m.config.holdingAccountId,
          destinationAccountId: destination,
          idempotencyKey: transferKey(orderId, kind, 1),
          requestBody: amountMinor > 0 ? transferBody(orderId, kind, 1, amountMinor, m.config.holdingAccountId, destination, m.config.mode) : null,
          // A share of nothing (e.g. Monime's fee ate MobiCare's share) is recorded, not sent.
          status: amountMinor > 0 ? "creating" : "skipped",
        })
        .onConflictDoNothing();
    }
    if (amounts.mobicareShareMinor < 0) {
      await notifyHqOfPayoutIssue(
        orderId,
        "Order money doesn't add up",
        `Order #${shortId(orderId)}: Monime's fee was more than MobiCare's share (${le(amounts.mobicareShareMinor)}). The pharmacy was still paid in full. Check the order in Monime.`,
      );
    }
  }

  const toSend = await db
    .select()
    .from(monimeTransfersTable)
    .where(and(eq(monimeTransfersTable.orderId, orderId), eq(monimeTransfersTable.status, "creating")));
  for (const row of toSend) await sendTransfer(row);
}

/** Exported for the order routes, which already hold the updated order. */
export function isReleasable(order: Order): boolean {
  return (
    order.paymentProvider === "monime" &&
    order.paidAt !== null &&
    (order.status === "delivered" || order.status === "collected") &&
    order.latePaymentStatus !== "refund_needed"
  );
}

function transferBody(
  orderId: string,
  kind: ReleaseKind,
  attempt: number,
  amountMinor: number,
  source: string,
  destination: string,
  mode: string,
): CreateInternalTransferBody {
  return {
    amount: { currency: "SLE", value: amountMinor },
    sourceFinancialAccount: { id: source },
    destinationFinancialAccount: { id: destination },
    metadata: { mc_order_id: orderId, mc_kind: kind, mc_attempt: String(attempt), mc_env: mode },
  };
}

async function sendTransfer(row: MonimeTransfer): Promise<MonimeTransfer> {
  const m = monime();
  if (!m || !row.requestBody) return row;
  try {
    const { result } = await m.client.createInternalTransfer(row.requestBody as CreateInternalTransferBody, row.idempotencyKey);
    return await applyTransfer(row, result);
  } catch (err) {
    if (err instanceof MonimeError && err.isFinal) {
      return await applyTransfer(row, {
        id: row.monimeTransferId ?? "",
        status: "failed",
        amount: { currency: "SLE", value: row.amountMinor },
        failureDetail: { code: err.reason ?? "refused", message: err.message },
      });
    }
    // Monime unreachable: stays 'creating' and the 5-minute check re-sends it.
    logger.warn({ transferId: row.id, err }, "Could not send a Monime transfer; will retry");
    return row;
  }
}

async function syncTransfer(row: MonimeTransfer): Promise<MonimeTransfer> {
  const m = monime();
  if (!m) return row;
  if (!row.monimeTransferId) return row.status === "creating" ? sendTransfer(row) : row;
  const { result } = await m.client.getInternalTransfer(row.monimeTransferId);
  return applyTransfer(row, result);
}

async function applyTransfer(row: MonimeTransfer, transfer: MonimeInternalTransfer): Promise<MonimeTransfer> {
  const status = movementStatus(transfer.status);
  if (transfer.amount?.value !== undefined && transfer.amount.value !== row.amountMinor) {
    logger.error({ transferId: row.id, monime: transfer.amount.value, ours: row.amountMinor }, "Monime transfer amount differs");
  }
  const [updated] = await db
    .update(monimeTransfersTable)
    .set({
      status,
      monimeTransferId: transfer.id || row.monimeTransferId,
      failureCode: status === "failed" ? (transfer.failureDetail?.code ?? "unknown") : null,
      failureMessage: status === "failed" ? (transfer.failureDetail?.message ?? null) : null,
      completedAt: status === "completed" ? (row.completedAt ?? new Date()) : null,
      updatedAt: new Date(),
    })
    // Only forward: a late "pending" can't undo a completed or failed transfer.
    .where(and(eq(monimeTransfersTable.id, row.id), inArray(monimeTransfersTable.status, ["creating", "pending", "processing"])))
    .returning();
  if (!updated) return row;
  if (status === "failed") {
    await notifyHqOfPayoutIssue(
      row.orderId,
      "Order money not released",
      `Order #${shortId(row.orderId)}: moving ${le(row.amountMinor)} (${row.kind === "pharmacy_share" ? "the pharmacy's share" : "MobiCare's share"}) out of Holding failed (${updated.failureCode}). Retry it from Online Payments.`,
    );
  }
  if (status === "completed" && row.kind === "pharmacy_share") {
    await createPharmacyNotification({
      pharmacyId: row.pharmacyId,
      title: "Money added to your balance",
      body: `${le(row.amountMinor)} for order #${shortId(row.orderId)} is now in your MobiCare balance, ready to cash out.`,
      type: "payout",
      referenceId: row.orderId,
    });
  }
  return updated;
}

/** HQ: try a failed release again, as a new attempt with a new key. */
export async function retryTransfer(transferId: string, actor: { id: string; name: string }): Promise<MonimeTransfer> {
  const m = monime();
  if (!m) throw new PayoutRefused("MONIME_OFF", "Online payments are switched off.");
  const [failed] = await db.select().from(monimeTransfersTable).where(eq(monimeTransfersTable.id, transferId)).limit(1);
  if (!failed) throw new PayoutRefused("NOT_FOUND", "Transfer not found.", 404);
  if (failed.status !== "failed") throw new PayoutRefused("NOT_FAILED", "Only a failed transfer can be retried.");
  const [newer] = await db
    .select({ id: monimeTransfersTable.id })
    .from(monimeTransfersTable)
    .where(and(eq(monimeTransfersTable.orderId, failed.orderId), eq(monimeTransfersTable.kind, failed.kind), sql`${monimeTransfersTable.attempt} > ${failed.attempt}`))
    .limit(1);
  if (newer) throw new PayoutRefused("ALREADY_RETRIED", "This transfer was already retried.");

  const attempt = failed.attempt + 1;
  const kind = failed.kind as ReleaseKind;
  const destination = kind === "pharmacy_share" ? await ensurePharmacyAccount(failed.pharmacyId) : m.config.revenueAccountId;
  const [row] = await db
    .insert(monimeTransfersTable)
    .values({
      orderId: failed.orderId,
      pharmacyId: failed.pharmacyId,
      kind,
      attempt,
      amountMinor: failed.amountMinor,
      sourceAccountId: m.config.holdingAccountId,
      destinationAccountId: destination,
      idempotencyKey: transferKey(failed.orderId, kind, attempt),
      requestBody: transferBody(failed.orderId, kind, attempt, failed.amountMinor, m.config.holdingAccountId, destination, m.config.mode),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new PayoutRefused("ALREADY_RETRIED", "This transfer was already retried.");
  await writeAudit({
    actorType: "hq",
    actorId: actor.id,
    actorName: actor.name,
    action: "monime.transfer_retry",
    entityType: "order",
    entityId: failed.orderId,
    details: { kind, attempt, amountMinor: failed.amountMinor, previousFailure: failed.failureCode },
  });
  return sendTransfer(row);
}

// ── Balances ───────────────────────────────────────────────────────────────

export interface PharmacyBalance {
  /** Released to the pharmacy and not yet cashed out. */
  availableMinor: number;
  /** Completed orders whose money is still on its way to the balance. */
  releasingMinor: number;
  /** Paid orders not yet delivered or collected. */
  waitingMinor: number;
  /** Cash-outs requested and not finished (amount plus fee). */
  cashingOutMinor: number;
  /** Everything that has reached the pharmacy's wallet. */
  paidOutMinor: number;
  maxCashoutMinor: number;
}

/**
 * A pharmacy's balance from MobiCare's own records. Works inside a
 * transaction too (cash-out requests lock the pharmacy row first).
 */
export async function pharmacyBalance(pharmacyId: string, executor: Pick<typeof db, "execute"> = db): Promise<PharmacyBalance> {
  const run = async (query: SQL) => {
    const result = (await executor.execute(query)) as unknown as { rows?: Record<string, unknown>[] };
    return (result.rows ?? (result as unknown as Record<string, unknown>[]))[0] ?? {};
  };
  const released = await run(sql`
    SELECT coalesce(sum(amount_minor) FILTER (WHERE status = 'completed'), 0)::bigint AS released,
           coalesce(sum(amount_minor) FILTER (WHERE status <> 'completed' AND status <> 'skipped' AND NOT EXISTS (
             SELECT 1 FROM monime_transfers later
              WHERE later.order_id = t.order_id AND later.kind = t.kind AND later.attempt > t.attempt)), 0)::bigint AS releasing
      FROM monime_transfers t
     WHERE t.pharmacy_id = ${pharmacyId} AND t.kind = 'pharmacy_share'`);
  const cashouts = await run(sql`
    SELECT coalesce(sum(amount_minor + coalesce(fee_minor, fee_reserved_minor))
             FILTER (WHERE status IN ('completed', 'awaiting_approval', 'sending', 'pending', 'processing')), 0)::bigint AS committed,
           coalesce(sum(amount_minor + coalesce(fee_minor, fee_reserved_minor))
             FILTER (WHERE status IN ('awaiting_approval', 'sending', 'pending', 'processing')), 0)::bigint AS open,
           coalesce(sum(amount_minor) FILTER (WHERE status = 'completed'), 0)::bigint AS paid_out
      FROM pharmacy_cashouts WHERE pharmacy_id = ${pharmacyId}`);
  const waiting = await run(sql`
    SELECT coalesce(sum(o.pharmacy_medicine_total_minor - o.pharmacy_commission_minor), 0)::bigint AS waiting
      FROM orders o
     WHERE o.pharmacy_id = ${pharmacyId} AND o.payment_provider = 'monime' AND o.paid_at IS NOT NULL
       AND o.status NOT IN ('delivered', 'collected', 'cancelled')
       AND o.late_payment_status IS DISTINCT FROM 'refund_needed'`);
  // Completed orders with no release row yet count as releasing too.
  const unstarted = await run(sql`
    SELECT coalesce(sum(o.pharmacy_medicine_total_minor - o.pharmacy_commission_minor), 0)::bigint AS unstarted
      FROM orders o
     WHERE o.pharmacy_id = ${pharmacyId} AND o.payment_provider = 'monime' AND o.paid_at IS NOT NULL
       AND o.status IN ('delivered', 'collected')
       AND o.late_payment_status IS DISTINCT FROM 'refund_needed'
       AND NOT EXISTS (SELECT 1 FROM monime_transfers t WHERE t.order_id = o.id AND t.kind = 'pharmacy_share')`);
  const n = (value: unknown) => Number(value ?? 0);
  const availableMinor = n(released.released) - n(cashouts.committed);
  return {
    availableMinor,
    releasingMinor: n(released.releasing) + n(unstarted.unstarted),
    waitingMinor: n(waiting.waiting),
    cashingOutMinor: n(cashouts.open),
    paidOutMinor: n(cashouts.paid_out),
    maxCashoutMinor: maxCashoutMinor(availableMinor),
  };
}

// ── Cash-outs ──────────────────────────────────────────────────────────────

export class PayoutRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 409,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PayoutRefused";
  }
}

export interface PayoutDestinationView {
  provider: PayoutProvider;
  network: string;
  maskedNumber: string | null;
  usable: boolean;
  problem: "no_number" | "invalid_number" | "on_hold" | null;
  availableAt: string | null;
}

/** The networks a pharmacy can cash out to, and why one can't be used yet. */
export function payoutDestinations(pharmacy: typeof pharmaciesTable.$inferSelect, now = new Date()): PayoutDestinationView[] {
  return (["m17", "m18"] as const).map((provider) => {
    const check = cashoutDestination(pharmacy, provider, now);
    const raw = provider === "m17" ? pharmacy.orangeMoneyNumber : pharmacy.afriMoneyNumber;
    return {
      provider,
      network: PROVIDER_NAMES[provider],
      maskedNumber: check.ok ? maskPhone(check.phoneNumber) : raw ? maskPhone(raw) : null,
      usable: check.ok,
      problem: check.ok ? null : check.reason,
      availableAt: !check.ok && check.availableAt ? check.availableAt.toISOString() : null,
    };
  });
}

/**
 * A pharmacy asks to cash out. The pharmacy row is locked while the balance
 * is checked and the request saved, and only one cash-out can be open at a
 * time, so two requests can never spend the same money.
 */
export async function requestCashout(
  pharmacyId: string,
  input: { amountMinor: number; provider: PayoutProvider },
): Promise<PharmacyCashout> {
  const m = monime();
  if (!m) throw new PayoutRefused("MONIME_OFF", "Online payments are switched off.");
  const { amountMinor, provider } = input;
  if (!Number.isInteger(amountMinor) || amountMinor < MIN_CASHOUT_MINOR) {
    throw new PayoutRefused("AMOUNT_TOO_SMALL", `The smallest cash-out is ${le(MIN_CASHOUT_MINOR)}.`, 400);
  }
  const fee = reservedFeeMinor(amountMinor);
  const id = crypto.randomUUID();

  const created = await db.transaction(async (tx) => {
    const [pharmacy] = await tx
      .select()
      .from(pharmaciesTable)
      .where(eq(pharmaciesTable.id, pharmacyId))
      .for("update")
      .limit(1);
    if (!pharmacy) throw new PayoutRefused("NOT_FOUND", "Pharmacy not found.", 404);
    const destination = cashoutDestination(pharmacy, provider, new Date());
    if (!destination.ok) {
      const network = PROVIDER_NAMES[provider];
      if (destination.reason === "on_hold") {
        throw new PayoutRefused(
          "NUMBER_ON_HOLD",
          `Your ${network} number was changed recently. For your safety, cash-outs to it start ${destination.availableAt!.toUTCString()}.`,
          409,
          { availableAt: destination.availableAt!.toISOString() },
        );
      }
      throw new PayoutRefused(
        destination.reason === "no_number" ? "NO_NUMBER" : "INVALID_NUMBER",
        `There is no valid ${network} number on your account. Ask HQ to add it.`,
      );
    }
    const balance = await pharmacyBalance(pharmacyId, tx);
    if (amountMinor + fee > balance.availableMinor) {
      throw new PayoutRefused(
        "BALANCE_TOO_LOW",
        `That is more than you can cash out. The most you can cash out now is ${le(balance.maxCashoutMinor)} (Monime's fee comes on top).`,
        409,
        { maxCashoutMinor: balance.maxCashoutMinor },
      );
    }
    const needsApproval = amountMinor > CASHOUT_APPROVAL_THRESHOLD_MINOR;
    try {
      const [row] = await tx
        .insert(pharmacyCashoutsTable)
        .values({
          id,
          pharmacyId,
          amountMinor,
          feeReservedMinor: fee,
          provider,
          phoneNumber: destination.phoneNumber,
          status: needsApproval ? "awaiting_approval" : "sending",
          needsApproval,
          idempotencyKey: cashoutKey(id),
        })
        .returning();
      return row!;
    } catch (err) {
      // Drizzle wraps the database error; the code is on it or its cause.
      const pgCode = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
      if (pgCode === "23505") {
        throw new PayoutRefused("CASHOUT_IN_PROGRESS", "You already have a cash-out in progress. Wait for it to finish first.");
      }
      throw err;
    }
  });

  await writeAudit({
    actorType: "pharmacy",
    actorId: pharmacyId,
    action: "monime.cashout_request",
    entityType: "pharmacy_cashout",
    entityId: created.id,
    details: { amountMinor, feeReservedMinor: fee, provider, to: maskPhone(created.phoneNumber), needsApproval: created.needsApproval },
  });
  if (created.needsApproval) {
    await notifyHqOfPayoutIssue(
      created.id,
      "Cash-out waiting for approval",
      `A pharmacy asked to cash out ${le(amountMinor)} to ${PROVIDER_NAMES[provider]} ${maskPhone(created.phoneNumber)}. Approve or reject it in Online Payments.`,
    );
    return created;
  }
  return sendCashout(created);
}

function payoutBody(row: PharmacyCashout, source: string, mode: string): CreatePayoutBody {
  return {
    amount: { currency: "SLE", value: row.amountMinor },
    source: { financialAccountId: source },
    destination: { type: "momo", providerId: row.provider as PayoutProvider, phoneNumber: row.phoneNumber },
    metadata: { mc_cashout_id: row.id, mc_pharmacy_id: row.pharmacyId, mc_kind: "cashout", mc_env: mode },
  };
}

async function sendCashout(row: PharmacyCashout): Promise<PharmacyCashout> {
  const m = monime();
  if (!m || row.status !== "sending") return row;
  let current = row;
  try {
    if (!current.requestBody) {
      const source = await ensurePharmacyAccount(row.pharmacyId);
      const [saved] = await db
        .update(pharmacyCashoutsTable)
        .set({ requestBody: payoutBody(row, source, m.config.mode), updatedAt: new Date() })
        .where(and(eq(pharmacyCashoutsTable.id, row.id), sql`${pharmacyCashoutsTable.requestBody} IS NULL`))
        .returning();
      [current] = saved ? [saved] : await db.select().from(pharmacyCashoutsTable).where(eq(pharmacyCashoutsTable.id, row.id)).limit(1);
    }
    const { result } = await m.client.createPayout(current!.requestBody as CreatePayoutBody, current!.idempotencyKey);
    return await applyPayout(current!, result);
  } catch (err) {
    if (err instanceof MonimeError && err.isFinal) {
      return await applyPayout(current, {
        id: current.monimePayoutId ?? "",
        status: "failed",
        amount: { currency: "SLE", value: current.amountMinor },
        failureDetail: { code: err.reason ?? "unknown", message: err.message },
      });
    }
    logger.warn({ cashoutId: row.id, err }, "Could not send a Monime payout; will retry");
    return current;
  }
}

async function syncCashout(row: PharmacyCashout): Promise<PharmacyCashout> {
  const m = monime();
  if (!m) return row;
  if (!row.monimePayoutId) return row.status === "sending" ? sendCashout(row) : row;
  const { result } = await m.client.getPayout(row.monimePayoutId);
  return applyPayout(row, result);
}

async function applyPayout(row: PharmacyCashout, payout: MonimePayout): Promise<PharmacyCashout> {
  const status = movementStatus(payout.status);
  const fees = sumFeesMinor(payout.fees);
  const [updated] = await db
    .update(pharmacyCashoutsTable)
    .set({
      status,
      monimePayoutId: payout.id || row.monimePayoutId,
      feeMinor: payout.fees && payout.fees.length > 0 ? fees : row.feeMinor,
      failureCode: status === "failed" ? (payout.failureDetail?.code ?? "unknown") : null,
      failureMessage: status === "failed" ? (payout.failureDetail?.message ?? null) : null,
      completedAt: status === "completed" ? (row.completedAt ?? new Date()) : null,
      updatedAt: new Date(),
    })
    .where(and(eq(pharmacyCashoutsTable.id, row.id), inArray(pharmacyCashoutsTable.status, ["sending", "pending", "processing"])))
    .returning();
  if (!updated) return row;
  const network = PROVIDER_NAMES[row.provider as PayoutProvider] ?? "mobile money";
  if (status === "completed") {
    await createPharmacyNotification({
      pharmacyId: row.pharmacyId,
      title: "Cash-out sent",
      body: `${le(row.amountMinor)} was sent to your ${network} number ${maskPhone(row.phoneNumber)}.`,
      type: "payout",
      referenceId: row.id,
    });
  }
  if (status === "failed") {
    const reason = cashoutFailureMessage(updated.failureCode);
    await createPharmacyNotification({
      pharmacyId: row.pharmacyId,
      title: "Cash-out did not go through",
      body: `${le(row.amountMinor)} to ${network} ${maskPhone(row.phoneNumber)}: ${reason}`,
      type: "payout",
      referenceId: row.id,
    });
    await notifyHqOfPayoutIssue(
      row.id,
      "Cash-out failed",
      `${le(row.amountMinor)} to ${network} ${maskPhone(row.phoneNumber)} failed (${updated.failureCode}). The money is back in the pharmacy's balance.`,
    );
  }
  return updated;
}

/** HQ approves a cash-out above the limit. The number must still be the registered one. */
export async function approveCashout(cashoutId: string, actor: { id: string; name: string }): Promise<PharmacyCashout> {
  const [row] = await db.select().from(pharmacyCashoutsTable).where(eq(pharmacyCashoutsTable.id, cashoutId)).limit(1);
  if (!row) throw new PayoutRefused("NOT_FOUND", "Cash-out not found.", 404);
  if (row.status !== "awaiting_approval") throw new PayoutRefused("NOT_WAITING", "This cash-out is not waiting for approval.");
  const [pharmacy] = await db.select().from(pharmaciesTable).where(eq(pharmaciesTable.id, row.pharmacyId)).limit(1);
  const check = pharmacy ? cashoutDestination(pharmacy, row.provider as PayoutProvider, new Date()) : null;
  if (!check?.ok || check.phoneNumber !== row.phoneNumber) {
    throw new PayoutRefused(
      "NUMBER_CHANGED",
      "The pharmacy's payout number has changed or is on hold since this was requested. Reject it and ask the pharmacy to request again.",
    );
  }
  const [approved] = await db
    .update(pharmacyCashoutsTable)
    .set({ status: "sending", approvedByHqUserId: actor.id, approvedByName: actor.name, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(pharmacyCashoutsTable.id, cashoutId), eq(pharmacyCashoutsTable.status, "awaiting_approval")))
    .returning();
  if (!approved) throw new PayoutRefused("NOT_WAITING", "This cash-out is not waiting for approval.");
  await writeAudit({
    actorType: "hq",
    actorId: actor.id,
    actorName: actor.name,
    action: "monime.cashout_approve",
    entityType: "pharmacy_cashout",
    entityId: cashoutId,
    details: { pharmacyId: row.pharmacyId, amountMinor: row.amountMinor, provider: row.provider },
  });
  return sendCashout(approved);
}

/** HQ rejects a cash-out waiting for approval; the money stays in the balance. */
export async function rejectCashout(cashoutId: string, reason: string, actor: { id: string; name: string }): Promise<PharmacyCashout> {
  const [rejected] = await db
    .update(pharmacyCashoutsTable)
    .set({ status: "rejected", rejectedByHqUserId: actor.id, rejectedByName: actor.name, rejectedAt: new Date(), rejectionReason: reason, updatedAt: new Date() })
    .where(and(eq(pharmacyCashoutsTable.id, cashoutId), eq(pharmacyCashoutsTable.status, "awaiting_approval")))
    .returning();
  if (!rejected) throw new PayoutRefused("NOT_WAITING", "This cash-out is not waiting for approval.");
  await writeAudit({
    actorType: "hq",
    actorId: actor.id,
    actorName: actor.name,
    action: "monime.cashout_reject",
    entityType: "pharmacy_cashout",
    entityId: cashoutId,
    details: { pharmacyId: rejected.pharmacyId, amountMinor: rejected.amountMinor, reason },
  });
  await createPharmacyNotification({
    pharmacyId: rejected.pharmacyId,
    title: "Cash-out not approved",
    body: `Your cash-out of ${le(rejected.amountMinor)} was not approved: ${reason}. The money is still in your balance.`,
    type: "payout",
    referenceId: rejected.id,
  });
  return rejected;
}

/** The pharmacy withdraws its own request while it waits for approval. */
export async function cancelCashout(cashoutId: string, pharmacyId: string): Promise<PharmacyCashout> {
  const [cancelled] = await db
    .update(pharmacyCashoutsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(pharmacyCashoutsTable.id, cashoutId),
        eq(pharmacyCashoutsTable.pharmacyId, pharmacyId),
        eq(pharmacyCashoutsTable.status, "awaiting_approval"),
      ),
    )
    .returning();
  if (!cancelled) throw new PayoutRefused("NOT_WAITING", "Only a cash-out waiting for approval can be cancelled.");
  await writeAudit({
    actorType: "pharmacy",
    actorId: pharmacyId,
    action: "monime.cashout_cancel",
    entityType: "pharmacy_cashout",
    entityId: cashoutId,
    details: { amountMinor: cancelled.amountMinor },
  });
  return cancelled;
}

// ── Webhooks and the 5-minute check ────────────────────────────────────────

/** A transfer or payout webhook: re-read the object from Monime and apply it. */
export async function syncMovementForEvent(objectType: string | null, objectId: string | null): Promise<string | null> {
  if (!objectId || !objectType) return null;
  if (/^internal[_-]?transfer$/.test(objectType)) {
    const [row] = await db.select().from(monimeTransfersTable).where(eq(monimeTransfersTable.monimeTransferId, objectId)).limit(1);
    if (!row) return null;
    const synced = await syncTransfer(row);
    return `transfer ${synced.status}`;
  }
  if (objectType === "payout") {
    const [row] = await db.select().from(pharmacyCashoutsTable).where(eq(pharmacyCashoutsTable.monimePayoutId, objectId)).limit(1);
    if (!row) return null;
    const synced = await syncCashout(row);
    return `cash-out ${synced.status}`;
  }
  return null;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Every 5 minutes: releases completed orders that were missed, re-sends
 * movements whose answer was lost, and checks ones still in progress. One
 * request at a time, to respect Monime's rate limits.
 */
export async function runPayoutChecks(): Promise<void> {
  if (!monime()) return;
  const missed = await rows(sql`
    SELECT o.id FROM orders o
     WHERE o.payment_provider = 'monime' AND o.paid_at IS NOT NULL
       AND o.status IN ('delivered', 'collected')
       AND o.late_payment_status IS DISTINCT FROM 'refund_needed'
       AND o.completed_at < now() - interval '1 minute'
       AND NOT EXISTS (SELECT 1 FROM monime_transfers t WHERE t.order_id = o.id)
     ORDER BY o.completed_at
     LIMIT 50`);
  for (const order of missed) {
    await releaseOrderFunds(String(order.id)).catch((err) => logger.error({ err, orderId: order.id }, "Release failed"));
    await pause(200);
  }

  const oneMinuteAgo = new Date(Date.now() - 60_000);
  const transfers = await db
    .select()
    .from(monimeTransfersTable)
    .where(and(inArray(monimeTransfersTable.status, ["creating", "pending", "processing"]), lt(monimeTransfersTable.updatedAt, oneMinuteAgo)))
    .orderBy(asc(monimeTransfersTable.updatedAt))
    .limit(100);
  for (const row of transfers) {
    await syncTransfer(row).catch((err) => logger.warn({ err, transferId: row.id }, "Transfer check failed"));
    await pause(200);
  }

  const cashouts = await db
    .select()
    .from(pharmacyCashoutsTable)
    .where(and(inArray(pharmacyCashoutsTable.status, ["sending", "pending", "processing"]), lt(pharmacyCashoutsTable.updatedAt, oneMinuteAgo)))
    .orderBy(asc(pharmacyCashoutsTable.updatedAt))
    .limit(100);
  for (const row of cashouts) {
    await syncCashout(row).catch((err) => logger.warn({ err, cashoutId: row.id }, "Cash-out check failed"));
    await pause(200);
  }
}

// ── Views for the portal and HQ ────────────────────────────────────────────

export function cashoutView(row: PharmacyCashout) {
  return {
    id: row.id,
    amountMinor: row.amountMinor,
    feeMinor: row.feeMinor ?? row.feeReservedMinor,
    feeIsEstimate: row.feeMinor === null,
    network: PROVIDER_NAMES[row.provider as PayoutProvider] ?? row.provider,
    maskedNumber: maskPhone(row.phoneNumber),
    status: row.status,
    needsApproval: row.needsApproval,
    failureReason: row.status === "failed" ? cashoutFailureMessage(row.failureCode) : null,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export { COMMITTED_CASHOUT, OPEN_CASHOUT };

/**
 * For the routes that complete an order (patient confirms receipt, HQ
 * confirms delivery, pharmacy hands over a collection): start releasing the
 * money without holding up the response. The 5-minute check catches anything
 * this misses.
 */
export function releaseAfterCompletion(order: Order): void {
  if (!monime() || !isReleasable(order)) return;
  void releaseOrderFunds(order.id).catch((err) =>
    logger.error({ err, orderId: order.id }, "Releasing order money failed; the 5-minute check will retry"),
  );
}

// ── Overviews ──────────────────────────────────────────────────────────────

/** Recent releases to one pharmacy (latest attempt per order). */
export async function recentReleases(pharmacyId: string, limit = 20) {
  const found = await rows(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (t.order_id) t.order_id, t.amount_minor, t.status, t.completed_at, t.created_at
        FROM monime_transfers t
       WHERE t.pharmacy_id = ${pharmacyId} AND t.kind = 'pharmacy_share'
       ORDER BY t.order_id, t.attempt DESC
    ) latest
    ORDER BY created_at DESC
    LIMIT ${limit}`);
  return found.map((r) => ({
      orderId: String(r.order_id),
      amountMinor: Number(r.amount_minor),
      // A failed release is still on its way as far as the pharmacy is concerned: HQ retries it.
      status: r.status === "completed" ? "released" : r.status === "skipped" ? "nothing_to_release" : "releasing",
      releasedAt: r.completed_at ? new Date(r.completed_at as string).toISOString() : null,
      createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

/** Everything HQ needs to run payouts. */
export async function hqPayoutsOverview() {
  const m = monime();
  const pharmacyIds = await rows(sql`
    SELECT DISTINCT o.pharmacy_id AS id, p.name
      FROM orders o JOIN pharmacies p ON p.id = o.pharmacy_id
     WHERE o.payment_provider = 'monime' AND o.paid_at IS NOT NULL
     ORDER BY p.name LIMIT 200`);
  const pharmacies = [];
  for (const row of pharmacyIds) {
    const balance = await pharmacyBalance(String(row.id));
    pharmacies.push({ pharmacyId: String(row.id), pharmacyName: String(row.name), ...balance });
  }

  const cashouts = await db
    .select({ cashout: pharmacyCashoutsTable, pharmacyName: pharmaciesTable.name })
    .from(pharmacyCashoutsTable)
    .innerJoin(pharmaciesTable, eq(pharmaciesTable.id, pharmacyCashoutsTable.pharmacyId))
    .orderBy(desc(pharmacyCashoutsTable.createdAt))
    .limit(100);
  const withName = (entry: (typeof cashouts)[number]) => ({
    ...cashoutView(entry.cashout),
    pharmacyId: entry.cashout.pharmacyId,
    pharmacyName: entry.pharmacyName,
    failureCode: entry.cashout.failureCode,
    approvedByName: entry.cashout.approvedByName,
  });

  const problems = await rows(sql`
    SELECT t.id, t.order_id, t.kind, t.amount_minor, t.failure_code, t.failure_message, t.updated_at, p.name AS pharmacy_name
      FROM monime_transfers t JOIN pharmacies p ON p.id = t.pharmacy_id
     WHERE t.status = 'failed'
       AND NOT EXISTS (SELECT 1 FROM monime_transfers later
                        WHERE later.order_id = t.order_id AND later.kind = t.kind AND later.attempt > t.attempt)
     ORDER BY t.updated_at DESC LIMIT 50`);

  // Monime's own balances, for a quick look. The full check is phase 4's reconciliation.
  let accounts: { holdingMinor: number | null; revenueMinor: number | null } = { holdingMinor: null, revenueMinor: null };
  if (m) {
    const balanceOf = async (id: string) => {
      try {
        const { result } = await m.client.getFinancialAccount(id, true);
        return result.balance?.available?.value ?? null;
      } catch {
        return null;
      }
    };
    accounts = { holdingMinor: await balanceOf(m.config.holdingAccountId), revenueMinor: await balanceOf(m.config.revenueAccountId) };
  }

  return {
    pharmacies,
    awaitingApproval: cashouts.filter((c) => c.cashout.status === "awaiting_approval").map(withName),
    recentCashouts: cashouts.filter((c) => c.cashout.status !== "awaiting_approval").slice(0, 50).map(withName),
    releaseProblems: problems.map((r) => ({
      transferId: String(r.id),
      orderId: String(r.order_id),
      kind: String(r.kind),
      amountMinor: Number(r.amount_minor),
      pharmacyName: String(r.pharmacy_name),
      failureCode: r.failure_code ? String(r.failure_code) : null,
      failureMessage: r.failure_message ? String(r.failure_message) : null,
      failedAt: new Date(r.updated_at as string).toISOString(),
    })),
    monimeBalances: accounts,
    approvalThresholdMinor: CASHOUT_APPROVAL_THRESHOLD_MINOR,
  };
}
