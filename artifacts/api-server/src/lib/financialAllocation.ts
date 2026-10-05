export type PriceAllocationLine = {
  key: string;
  baseUnitPriceMinor: number;
  quantity: number;
};

export type AllocatedPriceLine = PriceAllocationLine & {
  baseLineTotalMinor: number;
  medicineCommissionMinor: number;
  patientLineTotalMinor: number;
  patientUnitPriceMinor: number;
};

export const SERVICE_FEE_BASIS_POINTS = 500;

export function calculateOrderPricing(drugSubtotalMinor: number) {
  if (!Number.isSafeInteger(drugSubtotalMinor) || drugSubtotalMinor < 0) {
    throw new Error("drugSubtotalMinor must be a non-negative safe integer");
  }
  const serviceFeeMinor = Math.round(
    (drugSubtotalMinor * SERVICE_FEE_BASIS_POINTS) / 10_000,
  );
  return {
    drugSubtotalMinor,
    serviceFeeMinor,
    totalPaidMinor: drugSubtotalMinor + serviceFeeMinor,
  };
}

/** With Monime: the patient pays 2% on top, the pharmacy gives up 5%. */
export const SPLIT_PATIENT_SERVICE_FEE_BASIS_POINTS = 200;
export const SPLIT_PHARMACY_COMMISSION_BASIS_POINTS = 500;

export type PricingModel = "patient_fee_v1" | "split_v1";

export interface OrderPricing {
  pricingModel: PricingModel;
  /** The pharmacy's own prices, added up. */
  pharmacyMedicineTotalMinor: number;
  /** Paid by the patient on top of the medicine prices. */
  patientServiceFeeMinor: number;
  /** Kept from the pharmacy's price when the money is released. */
  pharmacyCommissionMinor: number;
  /** MobiCare's medicine revenue: service fee + commission. */
  medicineCommissionMinor: number;
  /** What the patient pays for the medicines. */
  patientMedicineTotalMinor: number;
  /** What the pharmacy receives for the medicines. */
  pharmacyPayoutMinor: number;
  /** Shown on the order: the service fee rate, in basis points. */
  serviceFeeBasisPoints: number;
}

const percentOf = (amountMinor: number, basisPoints: number) =>
  Math.round((amountMinor * basisPoints) / 10_000);

/**
 * How an order's medicine money divides between patient, pharmacy and
 * MobiCare. Each percentage is rounded once per order (half up), and the
 * parts always add up exactly.
 *
 * - 'patient_fee_v1' (today): patient pays 5% on top; pharmacy keeps its price.
 * - 'split_v1' (with Monime): patient pays 2% on top; pharmacy pays 5%.
 */
export function priceOrder(
  pharmacyMedicineTotalMinor: number,
  pricingModel: PricingModel,
): OrderPricing {
  if (!Number.isSafeInteger(pharmacyMedicineTotalMinor) || pharmacyMedicineTotalMinor < 0) {
    throw new Error("pharmacyMedicineTotalMinor must be a non-negative safe integer");
  }
  const split = pricingModel === "split_v1";
  const serviceFeeBasisPoints = split
    ? SPLIT_PATIENT_SERVICE_FEE_BASIS_POINTS
    : SERVICE_FEE_BASIS_POINTS;
  const patientServiceFeeMinor = percentOf(pharmacyMedicineTotalMinor, serviceFeeBasisPoints);
  const pharmacyCommissionMinor = split
    ? percentOf(pharmacyMedicineTotalMinor, SPLIT_PHARMACY_COMMISSION_BASIS_POINTS)
    : 0;
  return {
    pricingModel,
    pharmacyMedicineTotalMinor,
    patientServiceFeeMinor,
    pharmacyCommissionMinor,
    medicineCommissionMinor: patientServiceFeeMinor + pharmacyCommissionMinor,
    patientMedicineTotalMinor: pharmacyMedicineTotalMinor + patientServiceFeeMinor,
    pharmacyPayoutMinor: pharmacyMedicineTotalMinor - pharmacyCommissionMinor,
    serviceFeeBasisPoints,
  };
}

/**
 * Allocates the order-level basis-point commission in whole minor units.
 * Largest fractional remainders receive the extra units; the stable key makes
 * ties deterministic. `patientLineTotalMinor` is authoritative because a
 * one-cent remainder cannot always be represented in an integer unit price.
 */
export function allocatePatientPrices(
  lines: PriceAllocationLine[],
  markupBasisPoints: number,
): AllocatedPriceLine[] {
  const denominator = 10_000;
  const prepared = lines.map((line, index) => {
    const baseLineTotalMinor = line.baseUnitPriceMinor * line.quantity;
    const numerator = baseLineTotalMinor * markupBasisPoints;
    return {
      ...line,
      baseLineTotalMinor,
      commissionFloor: Math.floor(numerator / denominator),
      remainder: numerator % denominator,
      index,
    };
  });
  const totalBaseMinor = prepared.reduce(
    (total, line) => total + line.baseLineTotalMinor,
    0,
  );
  const targetCommissionMinor = Math.round(
    (totalBaseMinor * markupBasisPoints) / denominator,
  );
  let unitsToAllocate =
    targetCommissionMinor -
    prepared.reduce((total, line) => total + line.commissionFloor, 0);
  const extraIndexes = new Set(
    [...prepared]
      .sort(
        (a, b) =>
          b.remainder - a.remainder ||
          a.key.localeCompare(b.key) ||
          a.index - b.index,
      )
      .filter(() => unitsToAllocate-- > 0)
      .map((line) => line.index),
  );

  return prepared.map((line) => {
    const medicineCommissionMinor =
      line.commissionFloor + (extraIndexes.has(line.index) ? 1 : 0);
    const patientLineTotalMinor =
      line.baseLineTotalMinor + medicineCommissionMinor;
    return {
      key: line.key,
      baseUnitPriceMinor: line.baseUnitPriceMinor,
      quantity: line.quantity,
      baseLineTotalMinor: line.baseLineTotalMinor,
      medicineCommissionMinor,
      patientLineTotalMinor,
      patientUnitPriceMinor: Math.round(
        patientLineTotalMinor / line.quantity,
      ),
    };
  });
}