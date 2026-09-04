import assert from "node:assert/strict";
import test from "node:test";
import { commissionStatus, reconcileCommission } from "./commissionSettlements.js";

test("commission settlement status follows append-only payment total", () => {
  assert.equal(commissionStatus(500, 0), "unpaid");
  assert.equal(commissionStatus(500, 499), "partially_paid");
  assert.equal(commissionStatus(500, 500), "paid");
});

test("daily settlement commission reconciles to stored service-fee snapshots", () => {
  const reconciliation = reconcileCommission({
    drugAmountTotalMinor: 1_000_000,
    serviceFeeTotalMinor: 50_000,
    grossCollectedMinor: 1_050_000,
  });
  assert.equal(reconciliation.commissionDueMinor, 50_000);
  assert.equal(reconciliation.reconciles, true);
});