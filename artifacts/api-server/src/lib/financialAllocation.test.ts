import assert from "node:assert/strict";
import test from "node:test";
import { allocatePatientPrices } from "./financialAllocation.js";

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
  const allocation = allocatePatientPrices(
    [
      { key: "ten-thousand", baseUnitPriceMinor: 1_000_000, quantity: 1 },
      { key: "small", baseUnitPriceMinor: 101, quantity: 3 },
    ],
    500,
  );
  const drugAmountMinor = allocation.reduce(
    (total, line) => total + line.baseLineTotalMinor,
    0,
  );
  const serviceFeeMinor = allocation.reduce(
    (total, line) => total + line.medicineCommissionMinor,
    0,
  );
  const patientTotalMinor = allocation.reduce(
    (total, line) => total + line.patientLineTotalMinor,
    0,
  );

  assert.equal(allocation[0]?.medicineCommissionMinor, 50_000);
  assert.equal(serviceFeeMinor, Math.round((drugAmountMinor * 5) / 100));
  assert.equal(patientTotalMinor, drugAmountMinor + serviceFeeMinor);
});