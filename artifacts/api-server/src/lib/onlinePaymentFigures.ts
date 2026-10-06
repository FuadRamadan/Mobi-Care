import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { BUSINESS_TIMEZONE } from "./businessTime.js";

/**
 * Figures for orders paid online through Monime (payment_provider 'monime'),
 * for the pharmacy and HQ dashboards (Monime design, section 8).
 *
 * - A sale counts on the day its payment was confirmed (paid_at, Freetown
 *   time), minus refunds: a paid order later cancelled, or a payment that
 *   couldn't go ahead ('refund_needed'), is shown as a refund, not a sale.
 * - Pharmacies see only their own prices, their 5% commission and what they
 *   receive. The patient service fee is for HQ only.
 * - Money still in MobiCare's hands is split into "waiting on the order"
 *   (paid, not yet delivered or collected) and "owed to pharmacies"
 *   (completed, not yet cashed out).
 *
 * These come from MobiCare's own records. Monime's actual balances are
 * compared in the daily reconciliation (phase 4).
 */

export const MAX_RANGE_DAYS = 92;

export function validRange(start: unknown, end: unknown): { start: string; end: string } | null {
  if (typeof start !== "string" || typeof end !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  if (start > end) return null;
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(days) || days > MAX_RANGE_DAYS) return null;
  return { start, end };
}

/** Every date from start to end inclusive, YYYY-MM-DD. */
export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/** Fills in missing days with zeros, keeping the given order of keys. */
export function fillDays<T extends { date: string }>(
  start: string,
  end: string,
  rows: T[],
  empty: (date: string) => T,
): T[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return eachDay(start, end).map((date) => byDate.get(date) ?? empty(date));
}

const n = (value: unknown) => Number(value ?? 0);
const paidDay = sql`to_char(o.paid_at AT TIME ZONE ${BUSINESS_TIMEZONE}, 'YYYY-MM-DD')`;
// IS NOT DISTINCT FROM: late_payment_status is usually NULL, and NULL must count as "no".
const refunded = sql`(o.status = 'cancelled' OR o.late_payment_status IS NOT DISTINCT FROM 'refund_needed')`;
const totalMinor = sql`round(o.total_leones * 100)::int`;

async function rows(query: SQL): Promise<Record<string, unknown>[]> {
  const result = (await db.execute(query)) as unknown as { rows?: Record<string, unknown>[] };
  return result.rows ?? (result as unknown as Record<string, unknown>[]);
}

// ── Pharmacy ─────────────────────────────────────────────────────────────

export interface PharmacyOnlineDay {
  date: string;
  ordersCount: number;
  salesMinor: number;
  commissionMinor: number;
  receiveMinor: number;
  refundedOrders: number;
}

export async function pharmacyOnlineFigures(pharmacyId: string, start: string, end: string) {
  const daily = await rows(sql`
    SELECT ${paidDay} AS date,
           count(*) FILTER (WHERE NOT ${refunded})::int AS orders_count,
           coalesce(sum(o.pharmacy_medicine_total_minor) FILTER (WHERE NOT ${refunded}), 0)::int AS sales_minor,
           coalesce(sum(o.pharmacy_commission_minor) FILTER (WHERE NOT ${refunded}), 0)::int AS commission_minor,
           count(*) FILTER (WHERE ${refunded})::int AS refunded_orders
      FROM orders o
     WHERE o.pharmacy_id = ${pharmacyId}
       AND o.payment_provider = 'monime'
       AND o.paid_at IS NOT NULL
       AND ${paidDay} BETWEEN ${start} AND ${end}
     GROUP BY 1`);
  const [totals] = await rows(sql`
    SELECT coalesce(sum(o.pharmacy_medicine_total_minor - o.pharmacy_commission_minor)
             FILTER (WHERE o.status NOT IN ('delivered', 'collected')), 0)::int AS waiting_minor,
           coalesce(sum(o.pharmacy_medicine_total_minor - o.pharmacy_commission_minor)
             FILTER (WHERE o.status IN ('delivered', 'collected')), 0)::int AS completed_minor,
           count(*)::int AS online_orders
      FROM orders o
     WHERE o.pharmacy_id = ${pharmacyId}
       AND o.payment_provider = 'monime'
       AND o.paid_at IS NOT NULL
       AND NOT ${refunded}`);

  const days = fillDays<PharmacyOnlineDay>(
    start,
    end,
    daily.map((r) => {
      const sales = n(r.sales_minor);
      const commission = n(r.commission_minor);
      return {
        date: String(r.date),
        ordersCount: n(r.orders_count),
        salesMinor: sales,
        commissionMinor: commission,
        receiveMinor: sales - commission,
        refundedOrders: n(r.refunded_orders),
      };
    }),
    (date) => ({ date, ordersCount: 0, salesMinor: 0, commissionMinor: 0, receiveMinor: 0, refundedOrders: 0 }),
  );
  return {
    daily: days,
    waitingMinor: n(totals?.waiting_minor),
    completedMinor: n(totals?.completed_minor),
    hasOnlineOrders: n(totals?.online_orders) > 0,
  };
}

// ── HQ ───────────────────────────────────────────────────────────────────

export interface HqOnlineDay {
  date: string;
  ordersPaid: number;
  /** Medicines at the pharmacies' own prices, refunded orders left out. */
  salesMinor: number;
  collectedMinor: number;
  refundsCount: number;
  refundsMinor: number;
  serviceFeesMinor: number;
  commissionMinor: number;
  deliveryFeesMinor: number;
  monimeFeesMinor: number;
  netMinor: number;
}

/** MobiCare's take for a day: its fees and delivery, less what Monime kept. */
export function netRevenueMinor(day: Pick<HqOnlineDay, "serviceFeesMinor" | "commissionMinor" | "deliveryFeesMinor" | "monimeFeesMinor">): number {
  return day.serviceFeesMinor + day.commissionMinor + day.deliveryFeesMinor - day.monimeFeesMinor;
}

export async function hqOnlineFigures(start: string, end: string) {
  const daily = await rows(sql`
    WITH paid AS (
      SELECT o.*, ${paidDay} AS day,
             (SELECT coalesce(sum((f->'amount'->>'value')::int), 0)
                FROM monime_checkout_sessions s,
                     jsonb_array_elements(coalesce(s.fees, '[]'::jsonb)) f
               WHERE s.order_id = o.id AND s.status = 'completed') AS monime_fees
        FROM orders o
       WHERE o.payment_provider = 'monime' AND o.paid_at IS NOT NULL
    )
    SELECT day AS date,
           count(*)::int AS orders_paid,
           coalesce(sum(pharmacy_medicine_total_minor) FILTER (WHERE NOT (status = 'cancelled' OR late_payment_status IS NOT DISTINCT FROM 'refund_needed')), 0)::int AS sales_minor,
           coalesce(sum(${sql.raw("round(total_leones * 100)::int")}), 0)::int AS collected_minor,
           count(*) FILTER (WHERE status = 'cancelled' OR late_payment_status IS NOT DISTINCT FROM 'refund_needed')::int AS refunds_count,
           coalesce(sum(${sql.raw("round(total_leones * 100)::int")}) FILTER (WHERE status = 'cancelled' OR late_payment_status IS NOT DISTINCT FROM 'refund_needed'), 0)::int AS refunds_minor,
           coalesce(sum(patient_service_fee_minor) FILTER (WHERE NOT (status = 'cancelled' OR late_payment_status IS NOT DISTINCT FROM 'refund_needed')), 0)::int AS service_fees_minor,
           coalesce(sum(pharmacy_commission_minor) FILTER (WHERE NOT (status = 'cancelled' OR late_payment_status IS NOT DISTINCT FROM 'refund_needed')), 0)::int AS commission_minor,
           coalesce(sum(delivery_fee_minor) FILTER (WHERE NOT (status = 'cancelled' OR late_payment_status IS NOT DISTINCT FROM 'refund_needed')), 0)::int AS delivery_fees_minor,
           coalesce(sum(monime_fees), 0)::int AS monime_fees_minor
      FROM paid
     WHERE day BETWEEN ${start} AND ${end}
     GROUP BY 1`);

  // Owed to pharmacies: their share of completed orders, less what they have
  // cashed out or are cashing out (amount plus Monime's fee, which they pay).
  const [totals] = await rows(sql`
    SELECT coalesce(sum(${totalMinor}) FILTER (WHERE o.status NOT IN ('delivered', 'collected')), 0)::int AS waiting_minor,
           (coalesce(sum(o.pharmacy_medicine_total_minor - o.pharmacy_commission_minor)
              FILTER (WHERE o.status IN ('delivered', 'collected')), 0)
            - (SELECT coalesce(sum(c.amount_minor + coalesce(c.fee_minor, c.fee_reserved_minor)), 0)
                 FROM pharmacy_cashouts c
                WHERE c.status IN ('completed', 'awaiting_approval', 'sending', 'pending', 'processing')))::int AS owed_to_pharmacies_minor
      FROM orders o
     WHERE o.payment_provider = 'monime' AND o.paid_at IS NOT NULL AND NOT ${refunded}`);

  const refunds = await rows(sql`
    SELECT o.id, o.patient_name, p.name AS pharmacy_name, ${totalMinor} AS amount_minor,
           o.paid_at, o.status, o.late_payment_status,
           (SELECT s.payer_channel FROM monime_checkout_sessions s
             WHERE s.order_id = o.id AND s.status = 'completed' LIMIT 1) AS payer_channel,
           (SELECT s.payer_provider FROM monime_checkout_sessions s
             WHERE s.order_id = o.id AND s.status = 'completed' LIMIT 1) AS payer_provider
      FROM orders o
      LEFT JOIN pharmacies p ON p.id = o.pharmacy_id
     WHERE o.payment_provider = 'monime' AND o.paid_at IS NOT NULL AND ${refunded}
     ORDER BY o.paid_at DESC
     LIMIT 50`);

  const days = fillDays<HqOnlineDay>(
    start,
    end,
    daily.map((r) => {
      const day = {
        date: String(r.date),
        ordersPaid: n(r.orders_paid),
        salesMinor: n(r.sales_minor),
        collectedMinor: n(r.collected_minor),
        refundsCount: n(r.refunds_count),
        refundsMinor: n(r.refunds_minor),
        serviceFeesMinor: n(r.service_fees_minor),
        commissionMinor: n(r.commission_minor),
        deliveryFeesMinor: n(r.delivery_fees_minor),
        monimeFeesMinor: n(r.monime_fees_minor),
        netMinor: 0,
      };
      day.netMinor = netRevenueMinor(day);
      return day;
    }),
    (date) => ({ date, ordersPaid: 0, salesMinor: 0, collectedMinor: 0, refundsCount: 0, refundsMinor: 0, serviceFeesMinor: 0, commissionMinor: 0, deliveryFeesMinor: 0, monimeFeesMinor: 0, netMinor: 0 }),
  );

  return {
    daily: days,
    waitingOnOrdersMinor: n(totals?.waiting_minor),
    owedToPharmaciesMinor: n(totals?.owed_to_pharmacies_minor),
    refunds: refunds.map((r) => ({
      orderId: String(r.id),
      patientName: String(r.patient_name ?? ""),
      pharmacyName: r.pharmacy_name ? String(r.pharmacy_name) : null,
      amountMinor: n(r.amount_minor),
      paidAt: r.paid_at ? new Date(r.paid_at as string).toISOString() : null,
      reason: r.late_payment_status === "refund_needed"
        ? "Payment arrived but the order couldn't go ahead"
        : "Cancelled after payment",
      payerChannel: r.payer_channel ? String(r.payer_channel) : null,
      payerProvider: r.payer_provider ? String(r.payer_provider) : null,
    })),
  };
}

// ── HQ: sales history, one row per paid order ─────────────────────────────

export interface SalesHistoryFilter {
  start: string;
  end: string;
  pharmacyId?: string;
  /** Order number (first characters of the ID) or patient name. */
  search?: string;
  limit: number;
  offset: number;
}

/**
 * Every order paid through Monime in the date range (by payment date), with
 * what it brought MobiCare: the 5% commission, the delivery fee and any
 * service fee, less Monime's fee. A refunded order brings nothing but still
 * cost Monime's fee, so its revenue is minus that fee; the totals therefore
 * agree with the daily figures.
 */
export async function hqSalesHistory(filter: SalesHistoryFilter) {
  const conditions: SQL[] = [
    sql`o.payment_provider = 'monime'`,
    sql`o.paid_at IS NOT NULL`,
    sql`${paidDay} BETWEEN ${filter.start} AND ${filter.end}`,
  ];
  if (filter.pharmacyId) conditions.push(sql`o.pharmacy_id = ${filter.pharmacyId}`);
  const search = filter.search?.trim();
  if (search) {
    const like = `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    // An order number is the start of the order ID (hex), e.g. "7B68C06E".
    const idPrefix = search.toLowerCase().replace(/^#/, "");
    const byId = /^[0-9a-f-]{3,36}$/.test(idPrefix) ? sql`o.id::text LIKE ${`${idPrefix}%`} OR ` : sql``;
    conditions.push(sql`(${byId}o.patient_name ILIKE ${like} OR p.name ILIKE ${like})`);
  }
  const where = sql.join(conditions, sql` AND `);
  const base = sql`
    SELECT o.id, o.paid_at, o.status, o.late_payment_status, o.fulfillment_type, o.patient_name,
           o.pharmacy_id, p.name AS pharmacy_name,
           o.pharmacy_medicine_total_minor AS sales_minor,
           o.pharmacy_commission_minor AS commission_minor,
           o.delivery_fee_minor, o.patient_service_fee_minor AS service_fee_minor,
           ${totalMinor} AS paid_minor,
           coalesce((SELECT sum((f->'amount'->>'value')::int) FROM monime_checkout_sessions s,
                       jsonb_array_elements(coalesce(s.fees, '[]'::jsonb)) f
                      WHERE s.order_id = o.id AND s.status = 'completed'), 0)::int AS monime_fee_minor,
           ${refunded} AS refunded,
           (SELECT t.status FROM monime_transfers t WHERE t.order_id = o.id AND t.kind = 'pharmacy_share'
             ORDER BY t.attempt DESC LIMIT 1) AS release_status
      FROM orders o JOIN pharmacies p ON p.id = o.pharmacy_id
     WHERE ${where}`;

  const list = await rows(sql`${base} ORDER BY o.paid_at DESC LIMIT ${filter.limit} OFFSET ${filter.offset}`);
  const [totals] = await rows(sql`
    SELECT count(*)::int AS orders,
           coalesce(sum(sales_minor) FILTER (WHERE NOT refunded), 0)::bigint AS sales_minor,
           coalesce(sum(commission_minor) FILTER (WHERE NOT refunded), 0)::bigint AS commission_minor,
           coalesce(sum(delivery_fee_minor) FILTER (WHERE NOT refunded), 0)::bigint AS delivery_minor,
           coalesce(sum(service_fee_minor) FILTER (WHERE NOT refunded), 0)::bigint AS service_fee_minor,
           coalesce(sum(monime_fee_minor), 0)::bigint AS monime_fee_minor,
           count(*) FILTER (WHERE refunded)::int AS refunded_orders
      FROM (${base}) x`);

  const view = (r: Record<string, unknown>) => {
    const isRefunded = Boolean(r.refunded);
    const commission = isRefunded ? 0 : n(r.commission_minor);
    const delivery = isRefunded ? 0 : n(r.delivery_fee_minor);
    const serviceFee = isRefunded ? 0 : n(r.service_fee_minor);
    const monimeFee = n(r.monime_fee_minor);
    const completed = r.status === "delivered" || r.status === "collected";
    return {
      orderId: String(r.id),
      paidAt: new Date(r.paid_at as string).toISOString(),
      pharmacyId: String(r.pharmacy_id),
      pharmacyName: String(r.pharmacy_name),
      patientName: String(r.patient_name ?? ""),
      fulfillmentType: String(r.fulfillment_type),
      paidMinor: n(r.paid_minor),
      salesMinor: n(r.sales_minor),
      commissionMinor: commission,
      deliveryFeeMinor: delivery,
      serviceFeeMinor: serviceFee,
      monimeFeeMinor: monimeFee,
      revenueMinor: commission + delivery + serviceFee - monimeFee,
      pharmacyReceivesMinor: isRefunded ? 0 : n(r.sales_minor) - n(r.commission_minor),
      // refunded | waiting (paid, not yet delivered/collected) | completed | paid_to_pharmacy
      state: isRefunded ? "refunded" : !completed ? "waiting" : r.release_status === "completed" ? "paid_to_pharmacy" : "completed",
    };
  };

  const t = totals ?? {};
  const commission = n(t.commission_minor), delivery = n(t.delivery_minor), serviceFee = n(t.service_fee_minor), monime = n(t.monime_fee_minor);
  return {
    orders: list.map(view),
    total: n(t.orders),
    totals: {
      orders: n(t.orders),
      refundedOrders: n(t.refunded_orders),
      salesMinor: n(t.sales_minor),
      commissionMinor: commission,
      deliveryFeesMinor: delivery,
      serviceFeesMinor: serviceFee,
      monimeFeesMinor: monime,
      revenueMinor: commission + delivery + serviceFee - monime,
    },
  };
}
