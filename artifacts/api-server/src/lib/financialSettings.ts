/**
 * Money conversion between the Leone amounts people type and the integer minor
 * units the database stores.
 *
 * Prices are held as whole minor units (cents) so arithmetic is exact —
 * floating point cannot represent most decimal amounts, and a rounding error in
 * an order total is a real discrepancy someone has to reconcile by hand.
 *
 * There is deliberately no delivery pricing here. During the pilot MobiCare
 * charges no delivery fee and pays riders outside the platform, so a fee or
 * courier payout figure in code would be a number nobody set and nobody
 * honours. Checkout writes zero to both order columns. When a delivery partner
 * is contracted, the pricing rule that comes with that agreement belongs here.
 */

export function decimalLeonesToMinor(value: string | number): number {
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`Invalid Leone amount: ${text}`);
  const amount = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(amount)) throw new Error("Leone amount exceeds safe range");
  return amount;
}

export function minorToLeones(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid minor-unit amount");
  }
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}
