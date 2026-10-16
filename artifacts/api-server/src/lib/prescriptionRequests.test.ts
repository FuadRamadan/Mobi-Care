import { test } from "node:test";
import assert from "node:assert/strict";
import { COLLECTION_ROUND, distanceKm, isOnline, lastRound, pharmaciesForRound, ONLINE_WINDOW_MS, type CandidatePharmacy } from "./prescriptionRequests.js";

// Freetown, roughly: Lumley (west), Central, East End; Waterloo further out.
const LUMLEY: [number, number] = [-13.276, 8.457];
const CENTRAL: [number, number] = [-13.234, 8.484];
const EAST: [number, number] = [-13.19, 8.47];
const WATERLOO: [number, number] = [-13.07, 8.34];
const BO: [number, number] = [-11.738, 7.964];

const ph = (id: string, point: [number, number] | null, online = true): CandidatePharmacy => ({ id, point, online });

test("distance: Central to East End is a few km; Freetown to Bo is far", () => {
  const d = distanceKm(CENTRAL, EAST);
  assert.ok(d > 4 && d < 6, `got ${d}`);
  assert.ok(distanceKm(CENTRAL, BO) > 150);
});

test("round 1: within 3 km, nearest first, online only (zones play no part)", () => {
  const patient: [number, number] = [-13.198, 8.471];
  const all = [ph("east", EAST), ph("near", [-13.2, 8.472]), ph("central", CENTRAL), ph("offline", [-13.199, 8.471], false)];
  assert.deepEqual(pharmaciesForRound(1, patient, all, new Set(), 15), ["near", "east"]);
});

test("rounds 1 to 3 stay within the delivery limit; nobody is asked twice", () => {
  const all = [ph("central", CENTRAL), ph("lumley", LUMLEY), ph("waterloo", WATERLOO), ph("bo", BO)];
  const asked = new Set<string>();
  const r2 = pharmaciesForRound(2, EAST, all, asked, 15);
  assert.deepEqual(r2, ["central"]); // ~5 km; Lumley is ~10 km
  r2.forEach((id) => asked.add(id));
  // Lumley ~10 km in a line, ~13 km by road: deliverable. Waterloo ~20 km in a line: not.
  assert.deepEqual(pharmaciesForRound(3, EAST, all, asked, 15), ["lumley"]);
  asked.add("lumley");
  // Round 4, once the patient chooses to collect: beyond the limit, up to 25 km. Bo never.
  assert.deepEqual(pharmaciesForRound(COLLECTION_ROUND, EAST, all, asked, 15), ["waterloo"]);
  assert.deepEqual(pharmaciesForRound(5, EAST, all, asked, 15), [], "no fifth round");
});

test("a smaller delivery limit shrinks the early rounds too", () => {
  // 8 km in a line is ~10.4 km by road: beyond a 6 km limit.
  assert.deepEqual(pharmaciesForRound(2, EAST, [ph("central", CENTRAL)], new Set(), 6), []);
  assert.deepEqual(pharmaciesForRound(2, EAST, [ph("central", CENTRAL)], new Set(), 8), ["central"]);
});

test("without a delivery limit, round 3 reaches 25 km as before", () => {
  const all = [ph("lumley", LUMLEY), ph("waterloo", WATERLOO), ph("bo", BO)];
  assert.deepEqual(pharmaciesForRound(3, EAST, all, new Set(), null), ["lumley", "waterloo"]);
});

test("a pharmacy without a location is never asked", () => {
  assert.deepEqual(pharmaciesForRound(3, EAST, [ph("nowhere", null)], new Set(), 15), []);
  assert.deepEqual(pharmaciesForRound(COLLECTION_ROUND, EAST, [ph("nowhere", null)], new Set(), 15), []);
});

test("the last round is 3, or 4 once the patient chose to collect", () => {
  assert.equal(lastRound({ collectionOnly: false }), 3);
  assert.equal(lastRound({ collectionOnly: true }), 4);
});

test("online means the portal was seen in the last two minutes", () => {
  const now = new Date("2026-10-15T10:00:00Z");
  assert.equal(isOnline(new Date(now.getTime() - ONLINE_WINDOW_MS + 1000), now), true);
  assert.equal(isOnline(new Date(now.getTime() - ONLINE_WINDOW_MS - 1000), now), false);
  assert.equal(isOnline(null, now), false);
});
