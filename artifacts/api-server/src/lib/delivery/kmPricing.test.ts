import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_KM_PRICING, priceByKm, type KmPricing } from "./kmPricing.js";
import { estimateKm, straightKm } from "./roadDistance.js";

// Le 40/litre, 40 km/litre, pickup Le 20, Le 4/km, rider 40%, round to Le 5; no distance limit.
const P: KmPricing = { ...DEFAULT_KM_PRICING, maxKm: null };

test("Lumley to Goderich, 5.5 km: fuel first, then 40% of the service", () => {
  const q = priceByKm(5.5, P);
  assert.ok(q.available);
  assert.equal(q.fuelLeones, 11); // 2 × 5.5 km × Le 1
  assert.equal(q.serviceLeones, 42); // 20 + 4 × 5.5
  assert.equal(q.feeLeones, 55); // 53 rounded up
  assert.equal(q.roundingLeones, 2);
  assert.equal(q.riderLeones, 28); // 11 + 40% of 42 (16.8, rounded to Le 17)
  assert.equal(q.riderKeepsLeones, 17);
  assert.equal(q.mobicareLeones, 27);
  assert.equal(q.riderLeones + q.mobicareLeones, q.feeLeones);
});

test("Jui to Lumley, 20 km", () => {
  const q = priceByKm(20, P);
  assert.ok(q.available);
  assert.deepEqual([q.fuelLeones, q.serviceLeones, q.feeLeones, q.riderLeones, q.riderKeepsLeones, q.mobicareLeones], [40, 100, 140, 80, 40, 60]);
});

test("the rider never loses money: they keep more the further they go", () => {
  let last = -1;
  for (const km of [0.5, 1, 3, 8, 15, 30]) {
    const q = priceByKm(km, P);
    assert.ok(q.available && q.riderKeepsLeones > last);
    last = q.available ? q.riderKeepsLeones : last;
  }
});

test("whole leones only, whatever the distance", () => {
  for (const km of [0.3, 1.7, 5.3, 12.6, 20.1]) {
    const q = priceByKm(km, P);
    assert.ok(q.available);
    for (const v of [q.fuelLeones, q.distanceChargeLeones, q.feeLeones, q.riderLeones, q.mobicareLeones]) assert.ok(Number.isInteger(v), `${km} km: ${v}`);
    assert.equal(q.riderLeones + q.mobicareLeones, q.feeLeones);
  }
});

test("the starting numbers deliver up to 15 km", () => {
  assert.equal(DEFAULT_KM_PRICING.maxKm, 15);
  assert.ok(priceByKm(15, DEFAULT_KM_PRICING).available);
  assert.equal(priceByKm(33.8, DEFAULT_KM_PRICING).available, false);
});

test("minimum fee and maximum distance", () => {
  const q = priceByKm(1, { ...P, minimumFeeLeones: 40 });
  assert.ok(q.available);
  assert.equal(q.feeLeones, 40);
  assert.equal(q.mobicareLeones, 40 - q.riderLeones);
  assert.deepEqual(priceByKm(16, { ...P, maxKm: 15 }), { available: false, km: 16, reason: "too_far" });
});

test("fuel price changes move only the fuel part", () => {
  const a = priceByKm(10, P);
  const b = priceByKm(10, { ...P, fuelPricePerLitre: 60 });
  assert.ok(a.available && b.available);
  assert.equal(b.fuelLeones - a.fuelLeones, 10); // 20 km of riding × Le 0.5 more per km
  assert.equal(b.serviceLeones, a.serviceLeones);
});

test("distance estimate: straight line × 1.3", () => {
  const jui: [number, number] = [-13.1311, 8.4136];
  const lumley: [number, number] = [-13.264, 8.458];
  assert.equal(Math.round(straightKm(jui, lumley)), 15);
  assert.equal(estimateKm(jui, lumley).km, 20.1);
  assert.equal(estimateKm(jui, lumley).method, "estimate");
});
