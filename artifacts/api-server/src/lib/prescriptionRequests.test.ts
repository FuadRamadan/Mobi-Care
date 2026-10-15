import { test } from "node:test";
import assert from "node:assert/strict";
import { distanceKm, isOnline, pharmaciesForRound, ONLINE_WINDOW_MS, type CandidatePharmacy } from "./prescriptionRequests.js";

// Freetown, roughly: Lumley (west), Central, East End; Waterloo further out.
const LUMLEY: [number, number] = [-13.276, 8.457];
const CENTRAL: [number, number] = [-13.234, 8.484];
const EAST: [number, number] = [-13.19, 8.47];
const WATERLOO: [number, number] = [-13.07, 8.34];
const BO: [number, number] = [-11.738, 7.964];

const ph = (id: string, point: [number, number] | null, zoneId: string | null, online = true): CandidatePharmacy => ({ id, point, zoneId, online });

test("distance: Central to East End is a few km; Freetown to Bo is far", () => {
  const d = distanceKm(CENTRAL, EAST);
  assert.ok(d > 4 && d < 6, `got ${d}`);
  assert.ok(distanceKm(CENTRAL, BO) > 150);
});

test("round 1: only the patient's zone, nearest first, online only", () => {
  const all = [ph("far-in-zone", EAST, "z-east"), ph("near-other-zone", CENTRAL, "z-central"), ph("in-zone", [-13.2, 8.472], "z-east"), ph("offline", EAST, "z-east", false)];
  assert.deepEqual(pharmaciesForRound(1, { point: [-13.198, 8.471], zoneId: "z-east" }, all, new Set()), ["in-zone", "far-in-zone"]);
});

test("round 1 without a zone: within 3 km", () => {
  const all = [ph("central", CENTRAL, null), ph("lumley", LUMLEY, null)];
  assert.deepEqual(pharmaciesForRound(1, { point: [-13.236, 8.482], zoneId: null }, all, new Set()), ["central"]);
});

test("rounds 2 and 3 reach further and never ask anyone twice", () => {
  const all = [ph("central", CENTRAL, "z-central"), ph("lumley", LUMLEY, "z-west"), ph("waterloo", WATERLOO, null), ph("bo", BO, null)];
  const patient = { point: EAST, zoneId: "z-east" };
  const asked = new Set<string>();
  const r2 = pharmaciesForRound(2, patient, all, asked);
  assert.deepEqual(r2, ["central"]); // ~5 km; Lumley is ~10 km
  r2.forEach((id) => asked.add(id));
  const r3 = pharmaciesForRound(3, patient, all, asked);
  assert.deepEqual(r3, ["lumley", "waterloo"]); // Bo is beyond 25 km
  assert.deepEqual(pharmaciesForRound(4, patient, all, asked), [], "no fourth round");
});

test("a pharmacy without a location is never asked", () => {
  assert.deepEqual(pharmaciesForRound(3, { point: EAST, zoneId: null }, [ph("nowhere", null, null)], new Set()), []);
});

test("online means the portal was seen in the last two minutes", () => {
  const now = new Date("2026-10-15T10:00:00Z");
  assert.equal(isOnline(new Date(now.getTime() - ONLINE_WINDOW_MS + 1000), now), true);
  assert.equal(isOnline(new Date(now.getTime() - ONLINE_WINDOW_MS - 1000), now), false);
  assert.equal(isOnline(null, now), false);
});
