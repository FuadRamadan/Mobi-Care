import { BUSINESS_TIMEZONE } from "../businessTime.js";
import { zoneContains, type Boundary, type Position } from "./geometry.js";

/**
 * Delivery pricing, kept free of the database so every rule can be tested on
 * its own. Callers load the zones and fees; this decides the price.
 */

export interface PricedZone {
  id: string;
  name: string;
  boundary: Boundary;
  /** The fee in force now, in minor units. */
  feeMinor: number;
}

export type DeliveryQuote =
  | {
      available: true;
      feeMinor: number;
      /**
       * The zone the patient is in: where the rider goes. The fee may be the
       * pharmacy's zone's (cross_zone, when that one is higher), but the order
       * is always described by its destination.
       */
      zoneId: string;
      zoneName: string;
      /** The zone the pharmacy is in; the same as zoneName for same_zone. */
      pharmacyZoneName: string;
      /** same_zone: pharmacy and patient share a zone. cross_zone: they do not. */
      pricing: "same_zone" | "cross_zone";
    }
  | {
      available: false;
      reason: "pharmacy_not_located" | "pharmacy_outside_zones" | "patient_outside_zones";
    };

export const UNAVAILABLE_MESSAGES: Record<
  Extract<DeliveryQuote, { available: false }>["reason"],
  string
> = {
  pharmacy_not_located:
    "This pharmacy does not offer delivery yet. You can collect your order instead.",
  pharmacy_outside_zones:
    "This pharmacy does not offer delivery yet. You can collect your order instead.",
  patient_outside_zones: "Delivery is currently unavailable in your area.",
};

/** Zones containing a point, cheapest first (a border point takes the cheaper zone). */
export function zonesAt(point: Position, zones: PricedZone[]): PricedZone[] {
  return zones
    .filter((zone) => zoneContains(zone.boundary, point))
    .sort((a, b) => a.feeMinor - b.feeMinor || a.name.localeCompare(b.name));
}

/**
 * Prices a delivery from a pharmacy to a patient.
 *
 * - Same zone: that zone's fee. If they share more than one (both on a
 *   border), the cheapest shared zone.
 * - Different zones: the higher of the two zones' fees, so a trip into a
 *   costlier area is never cheaper than a trip within it.
 * - Pharmacy outside every zone: no delivery (collection only).
 * - Patient outside every zone: no delivery to that spot.
 *
 * Only active zones with a fee in force should be passed in.
 */
export function quoteDelivery(input: {
  pharmacy: Position | null;
  patient: Position;
  zones: PricedZone[];
}): DeliveryQuote {
  if (!input.pharmacy) return { available: false, reason: "pharmacy_not_located" };
  const pharmacyZones = zonesAt(input.pharmacy, input.zones);
  if (pharmacyZones.length === 0) {
    return { available: false, reason: "pharmacy_outside_zones" };
  }
  const patientZones = zonesAt(input.patient, input.zones);
  if (patientZones.length === 0) {
    return { available: false, reason: "patient_outside_zones" };
  }

  const shared = patientZones.find((zone) =>
    pharmacyZones.some((candidate) => candidate.id === zone.id),
  );
  if (shared) {
    return {
      available: true,
      feeMinor: shared.feeMinor,
      zoneId: shared.id,
      zoneName: shared.name,
      pharmacyZoneName: shared.name,
      pricing: "same_zone",
    };
  }

  const patientZone = patientZones[0]!;
  const pharmacyZone = pharmacyZones[0]!;
  return {
    available: true,
    feeMinor: Math.max(pharmacyZone.feeMinor, patientZone.feeMinor),
    zoneId: patientZone.id,
    zoneName: patientZone.name,
    pharmacyZoneName: pharmacyZone.name,
    pricing: "cross_zone",
  };
}

// ── Fees over time ───────────────────────────────────────────────────────────

export interface FeeRow {
  feeMinor: number;
  effectiveFrom: Date;
}

/** The fee in force at `now`: the latest one that has started. */
export function feeInForce<T extends FeeRow>(rows: T[], now: Date): T | null {
  let current: T | null = null;
  for (const row of rows) {
    if (row.effectiveFrom.getTime() > now.getTime()) continue;
    if (!current || row.effectiveFrom.getTime() > current.effectiveFrom.getTime()) {
      current = row;
    }
  }
  return current;
}

/** A change that has been scheduled but has not started yet, if any. */
export function scheduledFee<T extends FeeRow>(rows: T[], now: Date): T | null {
  let pending: T | null = null;
  for (const row of rows) {
    if (row.effectiveFrom.getTime() <= now.getTime()) continue;
    if (!pending || row.effectiveFrom.getTime() > pending.effectiveFrom.getTime()) {
      pending = row;
    }
  }
  return pending;
}

/** Minutes the zone's clock is ahead of UTC at `at`. */
function offsetMinutes(at: Date, timeZone: string): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

/**
 * The next midnight in the business timezone, as an instant. Fee changes take
 * effect then, when the service is quiet.
 */
export function nextBusinessMidnight(now: Date, timeZone = BUSINESS_TIMEZONE): Date {
  const local = new Date(now.getTime() + offsetMinutes(now, timeZone) * 60_000);
  const midnightLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + 1,
  );
  // Convert back using the offset in force at that midnight.
  const guess = new Date(midnightLocal);
  return new Date(midnightLocal - offsetMinutes(guess, timeZone) * 60_000);
}

/**
 * Coordinates as the order stores them (six decimals), so the point that was
 * priced is exactly the point on record.
 */
export function roundCoordinate(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
