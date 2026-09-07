/**
 * A pharmacy's mobile money lines, as the patient needs to see them.
 *
 * Patients pay the pharmacy directly, so these numbers are the payment
 * instruction — if they are wrong or missing, the order cannot be paid for. A
 * pharmacy may publish an Orange Money line, an AfriMoney line, or both, and a
 * patient holding only one wallet needs to see which.
 *
 * Older rows predate that split and carry a single number under a free-text
 * provider. Those are surfaced too rather than dropped: a pharmacy whose only
 * recorded number is a legacy one must still be payable.
 */

export interface MobileMoneyLine {
  /** Ready to display — never a raw enum value like "orange_money". */
  provider: string;
  number: string;
}

interface PharmacyPaymentColumns {
  orangeMoneyNumber?: string | null;
  afriMoneyNumber?: string | null;
  mobileMoneyNumber?: string | null;
  mobileMoneyProvider?: string | null;
}

export const ORANGE_MONEY = "Orange Money";
export const AFRIMONEY = "AfriMoney";

/** "orange_money" → "Orange Money". Legacy provider text was never display-ready. */
function displayProvider(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "Mobile money";
  if (/orange/i.test(text)) return ORANGE_MONEY;
  if (/afri/i.test(text)) return AFRIMONEY;
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const clean = (value: string | null | undefined): string | null => {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : null;
};

/**
 * The lines to show, in the order to show them. Empty when the pharmacy has
 * published no way to be paid — which callers should treat as a problem to
 * surface, not a blank to ignore.
 */
export function mobileMoneyLines(
  pharmacy: PharmacyPaymentColumns,
): MobileMoneyLine[] {
  const lines: MobileMoneyLine[] = [];

  const orange = clean(pharmacy.orangeMoneyNumber);
  if (orange) lines.push({ provider: ORANGE_MONEY, number: orange });

  const afri = clean(pharmacy.afriMoneyNumber);
  if (afri) lines.push({ provider: AFRIMONEY, number: afri });

  // Only when neither named line is set. Once a pharmacy has been given proper
  // lines the legacy column is stale history, and showing it again would offer
  // the patient a number nobody is maintaining.
  if (lines.length === 0) {
    const legacy = clean(pharmacy.mobileMoneyNumber);
    if (legacy) {
      lines.push({
        provider: displayProvider(pharmacy.mobileMoneyProvider),
        number: legacy,
      });
    }
  }

  return lines;
}
