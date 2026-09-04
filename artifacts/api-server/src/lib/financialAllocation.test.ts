import assert from "node:assert/strict";
import test from "node:test";
import {
  allocatePatientPrices,
  calculateOrderPricing,
  SERVICE_FEE_BASIS_POINTS,
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

test("five percent charge reconciles exactly to patient total", () => {
  const pricing = calculateOrderPricing(1_000_000);
  assert.equal(SERVICE_FEE_BASIS_POINTS, 500);
  assert.deepEqual(pricing, {
    drugSubtotalMinor: 1_000_000,
    serviceFeeMinor: 50_000,
    totalPaidMinor: 1_050_000,
  });
});

test("rounds the order-level service fee once in integer minor units", () => {
  assert.deepEqual(calculateOrderPricing(303), {
    drugSubtotalMinor: 303,
    serviceFeeMinor: 15,
    totalPaidMinor: 318,
  });
  assert.throws(() => calculateOrderPricing(1.5));
});