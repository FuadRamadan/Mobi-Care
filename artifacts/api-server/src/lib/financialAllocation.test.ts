import assert from "node:assert/strict";
import test from "node:test";
import {
  allocatePatientPrices,
  calculateServiceFeeMinor,
} from "./financialAllocation.js";

test("allocates basis-point remainders deterministically and exactly", () => {
  const lines = [
    { key: "b", baseUnitPriceMinor: 1, quantity: 1 },
    { key: "a", baseUnitPriceMinor: 1, quantity: 1 },
    { key: "bulk", baseUnitPriceMinor: 1, quantity: 2 },
  ];
  const allocation = allocatePatientPrices(lines, 5_000);

  assert.deepEqual(
    allocation.map((line) => [line.key, line.medicineCommissionMinor]),
    [["b", 0], ["a", 1], ["bulk", 1]],
  );
  assert.equal(
    allocation.reduce((total, line) => total + line.patientLineTotalMinor, 0),
    6,
  );
  assert.equal(
    allocation.reduce((total, line) => total + line.medicineCommissionMinor, 0),
    2,
  );
});

test("charges exactly five percent for the worked example", () => {
  const drugTotalMinor = 100_000 * 100;
  const serviceFeeMinor = calculateServiceFeeMinor(drugTotalMinor);
  assert.equal(serviceFeeMinor, 5_000 * 100);
  assert.equal(drugTotalMinor + serviceFeeMinor, 105_000 * 100);
});

test("rounds the order-level fee once in minor units", () => {
  assert.equal(calculateServiceFeeMinor(1), 0);
  assert.equal(calculateServiceFeeMinor(10), 1);
  assert.equal(calculateServiceFeeMinor(29), 1);
  assert.equal(calculateServiceFeeMinor(30), 2);
});

test("quantities, pharmacy share, platform share, and patient total reconcile", () => {
  const lines = [
    { key: "tablets", baseUnitPriceMinor: 12_345, quantity: 3 },
    { key: "syrup", baseUnitPriceMinor: 98_765, quantity: 2 },
  ];
  const allocation = allocatePatientPrices(lines, 500);
  const pharmacyShare = allocation.reduce(
    (total, line) => total + line.baseLineTotalMinor,
    0,
  );
  const platformShare = allocation.reduce(
    (total, line) => total + line.medicineCommissionMinor,
    0,
  );
  const patientTotal = allocation.reduce(
    (total, line) => total + line.patientLineTotalMinor,
    0,
  );

  assert.equal(pharmacyShare, 234_565);
  assert.equal(platformShare, calculateServiceFeeMinor(pharmacyShare));
  assert.equal(platformShare, 11_728);
  assert.equal(patientTotal, 246_293);
  assert.equal(patientTotal, pharmacyShare + platformShare);
});