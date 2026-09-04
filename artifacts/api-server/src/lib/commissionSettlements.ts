import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  commissionSettlementsTable,
  ordersTable,
} from "@workspace/db/schema";
import { logger } from "./logger.js";

export const BUSINESS_TIMEZONE = "Africa/Freetown";
export const COMPLETED_ORDER_STATUSES = ["delivered", "collected"] as const;

export function commissionStatus(
  commissionDueMinor: number,
  amountPaidMinor: number,
): "unpaid" | "partially_paid" | "paid" {
  if (amountPaidMinor >= commissionDueMinor) return "paid";
  if (amountPaidMinor > 0) return "partially_paid";
  return "unpaid";
}

export function reconcileCommission(input: {
  drugAmountTotalMinor: number;
  serviceFeeTotalMinor: number;
  grossCollectedMinor: number;
}) {
  return {
    commissionDueMinor: input.serviceFeeTotalMinor,
    reconciles:
      input.grossCollectedMinor >=
      input.drugAmountTotalMinor + input.serviceFeeTotalMinor,
  };
}

function validBusinessDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/**
 * Builds daily rows from immutable order snapshots. The local date is computed
 * in the explicit application timezone, never from the server clock. The
 * unique key makes repeat/concurrent calls idempotent.
 */
export async function generateDailyCommissionSettlements(
  settlementDate: string,
  businessTimezone = BUSINESS_TIMEZONE,
) {
  if (!validBusinessDate(settlementDate)) {
    throw new Error("settlementDate must be YYYY-MM-DD");
  }
  const rows = await db
    .select({
      pharmacyId: ordersTable.pharmacyId,
      ordersCount: sql<number>`count(*)::int`,
      grossCollectedMinor: sql<number>`coalesce(sum(${ordersTable.patientMedicineTotalMinor} + ${ordersTable.deliveryFeeMinor}), 0)::int`,
      drugAmountTotalMinor: sql<number>`coalesce(sum(${ordersTable.pharmacyMedicineTotalMinor}), 0)::int`,
      commissionDueMinor: sql<number>`coalesce(sum(${ordersTable.medicineCommissionMinor}), 0)::int`,
    })
    .from(ordersTable)
    .where(
      and(
        inArray(ordersTable.status, [...COMPLETED_ORDER_STATUSES]),
        sql`to_char(${ordersTable.completedAt} AT TIME ZONE ${businessTimezone}, 'YYYY-MM-DD') = ${settlementDate}`,
      ),
    )
    .groupBy(ordersTable.pharmacyId);

  let created = 0;
  for (const row of rows) {
    const inserted = await db
      .insert(commissionSettlementsTable)
      .values({
        pharmacyId: row.pharmacyId,
        settlementDate,
        businessTimezone,
        ordersCount: Number(row.ordersCount),
        grossCollectedMinor: Number(row.grossCollectedMinor),
        drugAmountTotalMinor: Number(row.drugAmountTotalMinor),
        commissionDueMinor: Number(row.commissionDueMinor),
        balanceMinor: Number(row.commissionDueMinor),
      })
      .onConflictDoNothing()
      .returning({ id: commissionSettlementsTable.id });
    created += inserted.length;
  }
  return { created, eligiblePharmacies: rows.length };
}

export function businessDateNow(timezone = BUSINESS_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date())
    .reduce((result, part) => {
      if (part.type === "year") result.year = part.value;
      if (part.type === "month") result.month = part.value;
      if (part.type === "day") result.day = part.value;
      return result;
    }, {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function previousBusinessDate(): string {
  const date = new Date(`${businessDateNow()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Closes yesterday shortly after midnight and retries safely each hour. */
let settlementSweepTimer: NodeJS.Timeout | undefined;

export function startCommissionSettlementSweep(): void {
  if (settlementSweepTimer) return;
  const run = async () => {
    try {
      const settlementDate = previousBusinessDate();
      const result = await generateDailyCommissionSettlements(settlementDate);
      logger.info({ settlementDate, ...result }, "Daily commission settlement sweep completed");
    } catch (err) {
      logger.error({ err }, "Daily commission settlement sweep failed");
    }
  };
  void run();
  settlementSweepTimer = setInterval(() => void run(), 60 * 60 * 1000);
  settlementSweepTimer.unref();
}

export function stopCommissionSettlementSweep(): void {
  if (!settlementSweepTimer) return;
  clearInterval(settlementSweepTimer);
  settlementSweepTimer = undefined;
}