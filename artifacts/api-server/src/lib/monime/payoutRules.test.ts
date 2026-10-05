import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CASHOUT_APPROVAL_THRESHOLD_MINOR,
  cashoutDestination,
  cashoutFailureMessage,
  maskPhone,
  maxCashoutMinor,
  payoutPhoneNumber,
  releaseAmounts,
  reservedFeeMinor,
  sumFeesMinor,
} from "./payoutRules.js";
import { cashoutKey, pharmacyAccountKey, transferKey } from "./keys.js";

test("release: the design's worked example adds up to what was paid", () => {
  // Medicine Le 1,000, 2% fee Le 20, delivery Le 30: paid Le 1,050; Monime keeps Le 10.50.
  const amounts = releaseAmounts({
    paidMinor: 105_000,
    pharmacyMedicineTotalMinor: 100_000,
    pharmacyCommissionMinor: 5_000,
    collectionFeesMinor: 1_050,
  });
  assert.deepEqual(amounts, { pharmacyShareMinor: 95_000, mobicareShareMinor: 8_950 });
  assert.equal(amounts.pharmacyShareMinor + amounts.mobicareShareMinor + 1_050, 105_000);
});

test("release: the pharmacy is paid in full even when Monime's fee exceeds MobiCare's share", () => {
  const amounts = releaseAmounts({ paidMinor: 1_000, pharmacyMedicineTotalMinor: 980, pharmacyCommissionMinor: 49, collectionFeesMinor: 100 });
  assert.equal(amounts.pharmacyShareMinor, 931);
  assert.equal(amounts.mobicareShareMinor, -31);
});

test("release: refuses impossible orders", () => {
  assert.throws(() => releaseAmounts({ paidMinor: 100, pharmacyMedicineTotalMinor: 10, pharmacyCommissionMinor: 20, collectionFeesMinor: 0 }));
  assert.throws(() => releaseAmounts({ paidMinor: 100, pharmacyMedicineTotalMinor: 500, pharmacyCommissionMinor: 25, collectionFeesMinor: 0 }));
});

test("fees: Monime fee entries are summed, junk ignored", () => {
  assert.equal(sumFeesMinor([{ amount: { value: 96 } }, { amount: { value: 4 } }]), 100);
  assert.equal(sumFeesMinor([{ amount: { value: "9" } }, {}, null]), 0);
  assert.equal(sumFeesMinor(null), 0);
});

test("cash-out fee is 1% rounded up, and the maximum always fits the balance", () => {
  assert.equal(reservedFeeMinor(10_000), 100);
  assert.equal(reservedFeeMinor(10_001), 101);
  for (const balance of [0, 1, 99, 101, 1_000, 12_825, 95_000, 1_234_567]) {
    const max = maxCashoutMinor(balance);
    assert.ok(max + reservedFeeMinor(max) <= balance, `fits ${balance}`);
    assert.ok(max + 1 + reservedFeeMinor(max + 1) > balance, `is the largest for ${balance}`);
  }
  assert.equal(maxCashoutMinor(-50), 0);
});

test("approval is needed above Le 2,000, not at it", () => {
  assert.equal(CASHOUT_APPROVAL_THRESHOLD_MINOR, 200_000);
});

test("payout numbers are normalised to +232 and anything else is refused", () => {
  assert.equal(payoutPhoneNumber("076 123 456"), "+23276123456");
  assert.equal(payoutPhoneNumber("23276123456"), "+23276123456");
  assert.equal(payoutPhoneNumber("+232 30 000 001"), "+23230000001");
  assert.equal(payoutPhoneNumber("12345"), null);
  assert.equal(payoutPhoneNumber(""), null);
});

test("cash-outs go only to the registered number, and wait 48 hours after a change", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const pharmacy = {
    orangeMoneyNumber: "076123456",
    afriMoneyNumber: null,
    orangeMoneyChangedAt: null,
    afriMoneyChangedAt: null,
  };
  assert.deepEqual(cashoutDestination(pharmacy, "m17", now), { ok: true, provider: "m17", phoneNumber: "+23276123456" });
  assert.deepEqual(cashoutDestination(pharmacy, "m18", now), { ok: false, reason: "no_number" });

  const changed = { ...pharmacy, orangeMoneyChangedAt: new Date("2026-10-05T12:00:00Z") };
  const held = cashoutDestination(changed, "m17", now);
  assert.equal(held.ok, false);
  assert.equal(!held.ok && held.reason, "on_hold");
  assert.equal(!held.ok && held.availableAt?.toISOString(), "2026-10-07T12:00:00.000Z");
  assert.equal(cashoutDestination(changed, "m17", new Date("2026-10-07T12:00:01Z")).ok, true);

  assert.deepEqual(cashoutDestination({ ...pharmacy, orangeMoneyNumber: "99" }, "m17", now), { ok: false, reason: "invalid_number" });
});

test("failure codes become plain words, and numbers are masked", () => {
  assert.match(cashoutFailureMessage("provider_account_missing"), /no mobile money wallet/);
  assert.match(cashoutFailureMessage("something_new"), /balance is unchanged/);
  assert.equal(maskPhone("+23276123456"), "+232 76 ••• 456");
});

test("each money movement has its own fixed key", () => {
  const order = "11111111-1111-1111-1111-111111111111";
  assert.equal(transferKey(order, "pharmacy_share", 1), transferKey(order, "pharmacy_share", 1));
  assert.notEqual(transferKey(order, "pharmacy_share", 1), transferKey(order, "pharmacy_share", 2));
  assert.notEqual(transferKey(order, "pharmacy_share", 1), transferKey(order, "mobicare_share", 1));
  assert.notEqual(pharmacyAccountKey(order), cashoutKey(order));
  assert.equal(cashoutKey(order).length, 36);
});
