/**
 * Delivery by distance, the database side: the pricing in force, changes
 * scheduled for midnight, and the quote checkout and order placement share.
 * The arithmetic is lib/delivery/kmPricing.ts; the distance roadDistance.ts.
 */
import { db, deliveryPricingTable, type DeliveryPricingRow } from "@workspace/db";
import { gt } from "drizzle-orm";
import { feeInForce, nextBusinessMidnight, scheduledFee } from "./pricing.js";
import { DEFAULT_KM_PRICING, priceByKm, type KmPricing } from "./kmPricing.js";
import { roadDistance } from "./roadDistance.js";
import { pharmacyPosition } from "./zones.js";
import type { Position } from "./geometry.js";
import { locate } from "./area.js";

type Reader = Pick<typeof db, "select">;

export function toKmPricing(row: DeliveryPricingRow): KmPricing {
  return {
    fuelPricePerLitre: Number(row.fuelPricePerLitre),
    kmPerLitre: Number(row.kmPerLitre),
    pickupLeones: Number(row.pickupLeones),
    serviceRatePerKm: Number(row.serviceRatePerKm),
    riderSharePercent: Number(row.riderSharePercent),
    roundToLeones: Number(row.roundToLeones),
    minimumFeeLeones: Number(row.minimumFeeLeones),
    maxKm: row.maxKm == null ? null : Number(row.maxKm),
  };
}

export interface PricingState {
  current: KmPricing & { effectiveFrom: string | null };
  scheduled: (KmPricing & { effectiveFrom: string }) | null;
  /** When a change saved now would start. */
  changesTakeEffectAt: string;
}

export async function loadPricing(now = new Date(), reader: Reader = db): Promise<PricingState> {
  const rows = await reader.select().from(deliveryPricingTable);
  const current = feeInForce(rows.map((r) => ({ ...r, feeMinor: 0 })), now);
  const pending = scheduledFee(rows.map((r) => ({ ...r, feeMinor: 0 })), now);
  return {
    // The migration seeds a row, so the defaults are only a safety net.
    current: current ? { ...toKmPricing(current), effectiveFrom: current.effectiveFrom.toISOString() } : { ...DEFAULT_KM_PRICING, effectiveFrom: null },
    scheduled: pending ? { ...toKmPricing(pending), effectiveFrom: pending.effectiveFrom.toISOString() } : null,
    changesTakeEffectAt: nextBusinessMidnight(now).toISOString(),
  };
}

/** Schedule new numbers for the next midnight, replacing any change already waiting. */
export async function schedulePricing(p: KmPricing, hqStaffId: string | null, now = new Date()): Promise<PricingState> {
  const effectiveFrom = nextBusinessMidnight(now);
  await db.transaction(async (tx) => {
    await tx.delete(deliveryPricingTable).where(gt(deliveryPricingTable.effectiveFrom, now));
    await tx.insert(deliveryPricingTable).values({
      fuelPricePerLitre: String(p.fuelPricePerLitre),
      kmPerLitre: String(p.kmPerLitre),
      pickupLeones: String(p.pickupLeones),
      serviceRatePerKm: String(p.serviceRatePerKm),
      riderSharePercent: String(p.riderSharePercent),
      roundToLeones: String(p.roundToLeones),
      minimumFeeLeones: String(p.minimumFeeLeones),
      maxKm: p.maxKm == null ? null : String(p.maxKm),
      effectiveFrom,
      createdByHqStaffId: hqStaffId,
    });
  });
  return loadPricing(now);
}

export async function cancelScheduledPricing(now = new Date()): Promise<boolean> {
  const removed = await db.delete(deliveryPricingTable).where(gt(deliveryPricingTable.effectiveFrom, now)).returning({ id: deliveryPricingTable.id });
  return removed.length > 0;
}

export type DistanceQuote =
  | {
      available: true;
      feeMinor: number;
      /** The rider's share: all the fuel and their percentage of the rest. */
      riderMinor: number;
      km: number;
      method: "road" | "estimate";
      maxKm: number | null;
      /** The patient's area, for dispatch and reports (a zone, else a district). */
      zoneId: string | null;
      areaName: string | null;
    }
  | { available: false; reason: "pharmacy_not_located" }
  | { available: false; reason: "too_far"; km: number; maxKm: number };

export const DISTANCE_UNAVAILABLE = {
  pharmacy_not_located: "This pharmacy does not offer delivery yet. You can collect your order instead.",
  too_far: (km: number, maxKm: number) =>
    `This pharmacy delivers up to ${maxKm} km away and you are about ${km} km away. You can collect your order instead, or choose a pharmacy nearer to you.`,
};

/** What a delivery from this pharmacy to this spot costs now. */
export async function quoteByDistance(
  pharmacy: Parameters<typeof pharmacyPosition>[0],
  patient: Position,
  now = new Date(),
): Promise<DistanceQuote> {
  const from = pharmacyPosition(pharmacy);
  if (!from) return { available: false, reason: "pharmacy_not_located" };
  const [{ current }, distance, area] = await Promise.all([loadPricing(now), roadDistance(from, patient), locate(patient)]);
  const quote = priceByKm(distance.km, current);
  if (!quote.available) return { available: false, reason: "too_far", km: quote.km, maxKm: current.maxKm! };
  return {
    available: true,
    feeMinor: Math.round(quote.feeLeones * 100),
    riderMinor: Math.round(quote.riderLeones * 100),
    km: quote.km,
    method: distance.method,
    maxKm: current.maxKm,
    zoneId: area.zoneId,
    areaName: area.areaName,
  };
}
