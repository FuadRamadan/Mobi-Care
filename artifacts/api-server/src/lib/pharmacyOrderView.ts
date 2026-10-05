import type { Order } from "@workspace/db/schema";

/**
 * An order as a pharmacy may see it.
 *
 * With the Monime fee split ('split_v1'), the patient's 2% service fee is
 * between the patient and MobiCare: the pharmacy sees its own prices, its 5%
 * commission and what it receives, never the fee or the patient's total
 * (from which the fee could be worked out). The fee fields are removed from
 * the response, not just hidden on screen, and `totalLeones` becomes the
 * pharmacy's own medicine total.
 *
 * Orders paid directly to the pharmacy ('patient_fee_v1') are unchanged: the
 * pharmacy collects the whole amount itself and owes MobiCare the fee.
 */
export function pharmacyOrderView<T extends Order>(order: T) {
  if (order.pricingModel !== "split_v1") return order;
  const {
    patientServiceFeeMinor: _fee,
    patientMedicineTotalMinor: _patientTotal,
    medicineCommissionMinor: _mobicareShare,
    medicineMarkupBasisPoints: _feeRate,
    ...rest
  } = order;
  return {
    ...rest,
    totalLeones: (order.pharmacyMedicineTotalMinor / 100).toFixed(2),
  };
}
