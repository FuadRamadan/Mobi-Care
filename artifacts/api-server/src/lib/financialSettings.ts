import { db } from "@workspace/db";
import { platformSettingsTable } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";

const KEYS = [
  "medicine_markup_basis_points",
  "delivery_fee_minor",
  "courier_payout_minor",
] as const;

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

export async function getFinancialSettings() {
  const rows = await db
    .select()
    .from(platformSettingsTable)
    .where(inArray(platformSettingsTable.key, [...KEYS]));
  const values = new Map(rows.map((row) => [row.key, row.value]));
  for (const key of KEYS) {
    if (!values.has(key)) throw new Error(`Missing required platform setting: ${key}`);
  }
  const medicineMarkupBasisPoints = values.get(KEYS[0])!;
  const deliveryFeeMinor = values.get(KEYS[1])!;
  const courierPayoutMinor = values.get(KEYS[2])!;
  if (
    // Patient service commission is a contractual fixed 5%; checkout must
    // never silently drift when an administrator changes a generic markup.
    medicineMarkupBasisPoints !== 500 ||
    deliveryFeeMinor < 0 ||
    courierPayoutMinor < 0 ||
    courierPayoutMinor > deliveryFeeMinor
  ) {
    throw new Error("Invalid platform financial settings");
  }
  return {
    medicineMarkupBasisPoints,
    deliveryFeeMinor,
    courierPayoutMinor,
  };
}