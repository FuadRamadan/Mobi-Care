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