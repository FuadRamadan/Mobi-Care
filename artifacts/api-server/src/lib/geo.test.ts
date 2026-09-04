import assert from "node:assert/strict";
import test from "node:test";
import { haversineDistanceKm, isLatitude, isLongitude } from "./geo.js";

test("haversine distance returns a rounded great-circle distance", () => {
  assert.equal(haversineDistanceKm(8.484, -13.2317, 8.484, -13.2317), 0);
  // Freetown to Bo is approximately 178 km by great-circle calculation.
  assert.ok(haversineDistanceKm(8.484, -13.2317, 7.9647, -11.738) > 170);
});

test("coordinate validators reject values outside latitude/longitude ranges", () => {
  assert.equal(isLatitude(90), true);
  assert.equal(isLatitude(90.01), false);
  assert.equal(isLongitude(-180), true);
  assert.equal(isLongitude(-180.01), false);
});