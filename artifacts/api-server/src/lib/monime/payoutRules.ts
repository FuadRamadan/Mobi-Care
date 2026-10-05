/**
 * The money rules for releasing order money and pharmacy cash-outs (Monime
 * phase 2). No database or network here, so every rule is unit-tested.
 * Amounts are in cents (minor units), as everywhere else.
 */

/**
 * Monime's payout fee, charged on top of the payout and taken from the
 * pharmacy's balance (decision 3). 1% is Monime's stated rate; the actual
 * fee Monime reports replaces this estimate once the payout is processed.
 */
export const PAYOUT_FEE_BASIS_POINTS = 100;
/** Decision 10: a cash-out above Le 2,000 needs HQ approval. */
export const CASHOUT_APPROVAL_THRESHOLD_MINOR = 200_000;
/** Smallest cash-out, so the fee never swallows most of it. */
export const MIN_CASHOUT_MINOR = 1_000;
/** Decision 11: a changed payout number can't be paid for 48 hours. */
export const PAYOUT_NUMBER_HOLD_MS = 48 * 60 * 60 * 1000;
/**
 * Monime's collection fee on a patient payment comes out of what lands in
 * Holding (section 4 of the design). To confirm with the first test payment;
 * the daily reconciliation (phase 4) would show a difference at once.
 */
export const COLLECTION_FEE_TAKEN_FROM_HOLDING = true;

export type PayoutProvider = "m17" | "m18";
export const PROVIDER_NAMES: Record<PayoutProvider, string> = {
  m17: "Orange Money",
  m18: "AfriMoney",
};

/** The fee held back for a cash-out of this amount, rounded up. */
export function reservedFeeMinor(amountMinor: number): number {
  return Math.ceil((amountMinor * PAYOUT_FEE_BASIS_POINTS) / 10_000);
}

/** The largest cash-out whose amount plus fee fits in the balance. */
export function maxCashoutMinor(availableMinor: number): number {
  if (availableMinor <= 0) return 0;
  let amount = Math.floor((availableMinor * 10_000) / (10_000 + PAYOUT_FEE_BASIS_POINTS));
  while (amount > 0 && amount + reservedFeeMinor(amount) > availableMinor) amount -= 1;
  while (amount + 1 + reservedFeeMinor(amount + 1) <= availableMinor) amount += 1;
  return amount;
}

export interface ReleaseInput {
  /** What the payer paid (the completed payment link's amount). */
  paidMinor: number;
  pharmacyMedicineTotalMinor: number;
  pharmacyCommissionMinor: number;
  /** Monime's actual fees on the payment. */
  collectionFeesMinor: number;
}

export interface ReleaseAmounts {
  /** Medicine total less the 5% commission. */
  pharmacyShareMinor: number;
  /** Service fee, commission and delivery, less Monime's collection fee. */
  mobicareShareMinor: number;
}

/**
 * How a completed order's money leaves Holding. The two shares plus Monime's
 * fee always add up to exactly what was paid, so Holding is left with nothing
 * for that order.
 */
export function releaseAmounts(input: ReleaseInput): ReleaseAmounts {
  const pharmacyShareMinor = input.pharmacyMedicineTotalMinor - input.pharmacyCommissionMinor;
  if (pharmacyShareMinor < 0) throw new Error("Commission is larger than the medicine total");
  if (pharmacyShareMinor > input.paidMinor) throw new Error("The pharmacy's share is more than was paid");
  const inHolding = input.paidMinor - (COLLECTION_FEE_TAKEN_FROM_HOLDING ? input.collectionFeesMinor : 0);
  return { pharmacyShareMinor, mobicareShareMinor: inHolding - pharmacyShareMinor };
}

/** Sum of Monime fee entries ({ amount: { value } }), ignoring malformed ones. */
export function sumFeesMinor(fees: unknown): number {
  if (!Array.isArray(fees)) return 0;
  return fees.reduce((sum, fee) => {
    const value = (fee as { amount?: { value?: unknown } })?.amount?.value;
    return sum + (Number.isInteger(value) && (value as number) > 0 ? (value as number) : 0);
  }, 0);
}

/** "076 123 456" / "23276123456" → "+23276123456"; null if not a Sierra Leone number. */
export function payoutPhoneNumber(raw: string | null | undefined): string | null {
  const compact = (raw ?? "").trim().replace(/[^\d+]/g, "");
  if (!compact) return null;
  let digits: string;
  if (compact.startsWith("+232")) digits = compact.slice(1);
  else if (compact.startsWith("00232")) digits = compact.slice(2);
  else if (compact.startsWith("232")) digits = compact;
  else if (compact.startsWith("0")) digits = `232${compact.slice(1)}`;
  else digits = `232${compact}`;
  return /^232\d{8}$/.test(digits) ? `+${digits}` : null;
}

export interface PayoutLineColumns {
  orangeMoneyNumber: string | null;
  afriMoneyNumber: string | null;
  orangeMoneyChangedAt: Date | null;
  afriMoneyChangedAt: Date | null;
}

export type DestinationCheck =
  | { ok: true; provider: PayoutProvider; phoneNumber: string }
  | { ok: false; reason: "no_number" | "invalid_number" | "on_hold"; availableAt?: Date };

/** Where a cash-out to this network may go: only the registered number, after any hold. */
export function cashoutDestination(
  pharmacy: PayoutLineColumns,
  provider: PayoutProvider,
  now: Date,
): DestinationCheck {
  const raw = provider === "m17" ? pharmacy.orangeMoneyNumber : pharmacy.afriMoneyNumber;
  const changedAt = provider === "m17" ? pharmacy.orangeMoneyChangedAt : pharmacy.afriMoneyChangedAt;
  if (!raw?.trim()) return { ok: false, reason: "no_number" };
  const phoneNumber = payoutPhoneNumber(raw);
  if (!phoneNumber) return { ok: false, reason: "invalid_number" };
  if (changedAt) {
    const availableAt = new Date(changedAt.getTime() + PAYOUT_NUMBER_HOLD_MS);
    if (availableAt > now) return { ok: false, reason: "on_hold", availableAt };
  }
  return { ok: true, provider, phoneNumber };
}

/** Monime's payout failure codes, in words a pharmacy can act on. */
export function cashoutFailureMessage(code: string | null | undefined): string {
  switch (code) {
    case "provider_account_missing":
      return "There is no mobile money wallet on this number. Ask HQ to check your payout number.";
    case "provider_account_blocked":
      return "The mobile money wallet on this number is blocked. Contact your network, then try again.";
    case "provider_account_quota_exhausted":
      return "The wallet has reached its limit for now. Try a smaller amount, or try again tomorrow.";
    case "fund_insufficient":
      return "MobiCare's payout account could not cover this right now. HQ has been told; your balance is unchanged.";
    case "authorization_failed":
    case "provider_unknown":
      return "The mobile money network refused the payment. Your balance is unchanged; try again later.";
    default:
      return "The cash-out did not go through. Your balance is unchanged; try again later or contact HQ.";
  }
}

/** "+23276123456" → "+232 76 ••• 456" for screens and messages. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return phone;
  return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ••• ${digits.slice(-3)}`;
}
