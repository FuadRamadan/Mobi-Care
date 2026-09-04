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