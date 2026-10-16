/**
 * Delivery priced by distance ("fuel first, then the split").
 *
 *   fuel     = there and back × km × (fuel price per litre ÷ km per litre)
 *   service  = pickup charge + service rate × km
 *   fee      = fuel + service, rounded up to the next roundTo leones,
 *              and never below the minimum
 *   rider    = all the fuel + riderShare of the service
 *   MobiCare = the rest (including what the rounding adds)
 *
 * The rider is paid the fuel first, so a long trip never costs them money
 * and a change in fuel price changes one number. Kept free of the database
 * so every rule can be tested on its own. Every amount is whole leones: the
 * fuel, the distance charge and the rider's share are each rounded to the
 * nearest leone, so riders and patients never see cents.
 */

export interface KmPricing {
  /** Le per litre of petrol. */
  fuelPricePerLitre: number;
  /** How far a delivery bike goes on a litre. */
  kmPerLitre: number;
  /** Charged on every delivery, for going to the pharmacy and handing over. */
  pickupLeones: number;
  /** Charged per km on top of the fuel. */
  serviceRatePerKm: number;
  /** The rider's share of the service part, in percent. */
  riderSharePercent: number;
  /** Fees are rounded up to a multiple of this (Le 5 = no small change). */
  roundToLeones: number;
  /** No delivery costs less than this. 0 = no minimum. */
  minimumFeeLeones: number;
  /** Beyond this many km there is no delivery (collection only). null = no limit. */
  maxKm: number | null;
}

/**
 * The starting numbers (migration 0043 saves the same). Also used when no
 * pricing has been saved, as on an install made from the baseline.
 */
export const DEFAULT_KM_PRICING: KmPricing = {
  fuelPricePerLitre: 40,
  kmPerLitre: 40,
  pickupLeones: 20,
  serviceRatePerKm: 4,
  riderSharePercent: 40,
  roundToLeones: 5,
  minimumFeeLeones: 0,
  maxKm: 15,
};

export type KmQuote =
  | {
      available: true;
      km: number;
      /** Fuel for the rider's trip there and back. */
      fuelLeones: number;
      /** Fuel cost per km of road, one way. */
      fuelPerKmLeones: number;
      pickupLeones: number;
      distanceChargeLeones: number;
      serviceLeones: number;
      /** What rounding up (or the minimum) adds; it goes to MobiCare. */
      roundingLeones: number;
      feeLeones: number;
      riderLeones: number;
      /** What the rider has left after paying for the fuel. */
      riderKeepsLeones: number;
      mobicareLeones: number;
    }
  | { available: false; km: number; reason: "too_far" };

// Worked out in minor units (cents) so nothing drifts, in whole leones.
const WHOLE = 100;
const minor = (leones: number) => Math.round(leones) * WHOLE;
const leones = (minorUnits: number) => minorUnits / WHOLE;

export function priceByKm(km: number, p: KmPricing): KmQuote {
  const distance = Math.max(0, Math.round(km * 10) / 10);
  if (p.maxKm != null && distance > p.maxKm) return { available: false, km: distance, reason: "too_far" };

  const fuelPerKm = p.kmPerLitre > 0 ? p.fuelPricePerLitre / p.kmPerLitre : 0;
  const fuel = minor(2 * distance * fuelPerKm);
  const pickup = minor(p.pickupLeones);
  const distanceCharge = minor(p.serviceRatePerKm * distance);
  const service = pickup + distanceCharge;
  const exact = fuel + service;
  const step = minor(Math.max(p.roundToLeones, 1));
  const rounded = Math.max(Math.ceil(exact / step) * step, minor(p.minimumFeeLeones));
  const rider = fuel + Math.round((service * p.riderSharePercent) / 100 / WHOLE) * WHOLE;

  return {
    available: true,
    km: distance,
    fuelLeones: leones(fuel),
    fuelPerKmLeones: Math.round(fuelPerKm * 100) / 100,
    pickupLeones: leones(pickup),
    distanceChargeLeones: leones(distanceCharge),
    serviceLeones: leones(service),
    roundingLeones: leones(rounded - exact),
    feeLeones: leones(rounded),
    riderLeones: leones(rider),
    riderKeepsLeones: leones(rider - fuel),
    mobicareLeones: leones(rounded - rider),
  };
}

/** Distances shown in the calculator's table, in km. */
export const TABLE_KM = [1, 2, 3, 5, 8, 10, 12, 15, 20, 25];
