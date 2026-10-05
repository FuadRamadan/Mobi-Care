import assert from "node:assert/strict";
import { test } from "node:test";
import { eachDay, fillDays, netRevenueMinor, validRange } from "./onlinePaymentFigures.js";

test("validRange accepts dates in order, up to 92 days apart", () => {
  assert.deepEqual(validRange("2026-10-01", "2026-10-05"), { start: "2026-10-01", end: "2026-10-05" });
  assert.deepEqual(validRange("2026-10-05", "2026-10-05"), { start: "2026-10-05", end: "2026-10-05" });
  assert.ok(validRange("2026-07-05", "2026-10-05"));
});

test("validRange refuses missing, malformed, reversed and over-long ranges", () => {
  assert.equal(validRange(undefined, "2026-10-05"), null);
  assert.equal(validRange("2026-10-5", "2026-10-05"), null);
  assert.equal(validRange("2026-10-05'; --", "2026-10-05"), null);
  assert.equal(validRange("2026-10-06", "2026-10-05"), null);
  assert.equal(validRange("2026-07-04", "2026-10-05"), null);
  assert.equal(validRange("2026-13-01", "2026-13-02"), null);
});

test("eachDay crosses month ends and includes both ends", () => {
  assert.deepEqual(eachDay("2026-09-29", "2026-10-02"), ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  assert.deepEqual(eachDay("2026-10-05", "2026-10-05"), ["2026-10-05"]);
});

test("fillDays keeps real rows and zero-fills the gaps, in date order", () => {
  const rows = [{ date: "2026-10-03", value: 7 }, { date: "2026-10-01", value: 2 }];
  assert.deepEqual(
    fillDays("2026-10-01", "2026-10-04", rows, (date) => ({ date, value: 0 })),
    [
      { date: "2026-10-01", value: 2 },
      { date: "2026-10-02", value: 0 },
      { date: "2026-10-03", value: 7 },
      { date: "2026-10-04", value: 0 },
    ],
  );
});

test("net is service fees + commission + delivery, less Monime's fees", () => {
  // Le 60 medicines (2% fee Le 1.20, 5% commission Le 3), Le 35 delivery, Le 0.96 Monime fee.
  assert.equal(
    netRevenueMinor({ serviceFeesMinor: 120, commissionMinor: 300, deliveryFeesMinor: 3500, monimeFeesMinor: 96 }),
    3824,
  );
  assert.equal(netRevenueMinor({ serviceFeesMinor: 0, commissionMinor: 0, deliveryFeesMinor: 0, monimeFeesMinor: 50 }), -50);
});
