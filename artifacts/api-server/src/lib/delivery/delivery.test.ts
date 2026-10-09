import assert from "node:assert/strict";
import test from "node:test";
import {
  boundariesOverlap,
  locatePoint,
  validateBoundary,
  zoneContains,
  type Boundary,
  type Position,
} from "./geometry.js";
import {
  feeInForce,
  nextBusinessMidnight,
  quoteDelivery,
  scheduledFee,
  type PricedZone,
} from "./pricing.js";

/** An axis-aligned box in Freetown, as a closed GeoJSON polygon. */
function box(west: number, south: number, east: number, north: number): Boundary {
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

// West and East share the border at longitude -13.24.
const WEST = box(-13.3, 8.44, -13.24, 8.5);
const EAST = box(-13.24, 8.44, -13.18, 8.5);

function zone(id: string, boundary: Boundary, feeMinor: number): PricedZone {
  return { id, name: id, boundary, feeMinor };
}

// ── Geometry ────────────────────────────────────────────────────────────────

test("points inside, outside and on the border of a zone", () => {
  assert.equal(locatePoint(WEST, [-13.27, 8.47]), "inside");
  assert.equal(locatePoint(WEST, [-13.1, 8.47]), "outside");
  assert.equal(locatePoint(WEST, [-13.24, 8.47]), "border");
  assert.equal(locatePoint(WEST, [-13.3, 8.44]), "border"); // a corner
  assert.equal(zoneContains(WEST, [-13.24, 8.47]), true);
});

test("a concave zone does not contain the notch cut out of it", () => {
  // An L shape: the north-east quarter is missing.
  const shape: Boundary = {
    type: "Polygon",
    coordinates: [
      [
        [-13.3, 8.44],
        [-13.2, 8.44],
        [-13.2, 8.47],
        [-13.25, 8.47],
        [-13.25, 8.5],
        [-13.3, 8.5],
        [-13.3, 8.44],
      ],
    ],
  };
  assert.equal(zoneContains(shape, [-13.22, 8.49]), false);
  assert.equal(zoneContains(shape, [-13.22, 8.45]), true);
  assert.equal(zoneContains(shape, [-13.28, 8.49]), true);
});

test("zones that share a border or a corner do not overlap", () => {
  assert.equal(boundariesOverlap(WEST, EAST), false);
  const northEast = box(-13.24, 8.5, -13.18, 8.56);
  assert.equal(boundariesOverlap(WEST, northEast), false);
});

test("zones that cover the same ground overlap", () => {
  assert.equal(boundariesOverlap(WEST, box(-13.25, 8.45, -13.2, 8.49)), true);
  assert.equal(boundariesOverlap(WEST, WEST), true, "identical zones");
  assert.equal(boundariesOverlap(WEST, box(-13.29, 8.45, -13.25, 8.49)), true, "one inside the other");
  // A cross shape: neither has a corner inside the other.
  assert.equal(
    boundariesOverlap(box(-13.3, 8.46, -13.2, 8.48), box(-13.26, 8.42, -13.24, 8.52)),
    true,
  );
});

test("a concave zone and a zone sitting in its notch do not overlap", () => {
  const shape: Boundary = {
    type: "Polygon",
    coordinates: [
      [
        [-13.3, 8.44],
        [-13.2, 8.44],
        [-13.2, 8.47],
        [-13.25, 8.47],
        [-13.25, 8.5],
        [-13.3, 8.5],
        [-13.3, 8.44],
      ],
    ],
  };
  assert.equal(boundariesOverlap(shape, box(-13.25, 8.47, -13.2, 8.5)), false);
});

test("a valid drawn zone is accepted, closed and rounded", () => {
  const result = validateBoundary({
    type: "Polygon",
    coordinates: [
      [
        [-13.30000001, 8.44],
        [-13.24, 8.44],
        [-13.24, 8.5],
        [-13.3, 8.5],
      ],
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const ring = (result.boundary.coordinates as Position[][])[0]!;
  assert.deepEqual(ring[0], ring[ring.length - 1], "ring is closed");
  assert.deepEqual(ring[0], [-13.3, 8.44], "coordinates rounded to six decimals");
});

test("zones breaking the drawing rules are refused with a reason", () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ type: "Point", coordinates: [-13.2, 8.4] }, /one area or several/],
    [{ type: "Polygon", coordinates: [[[-13.3, 8.44], [-13.24, 8.44], [-13.3, 8.44]]] }, /three separate corners/],
    [
      // A bow tie: the outline crosses itself.
      { type: "Polygon", coordinates: [[[-13.3, 8.44], [-13.24, 8.5], [-13.24, 8.44], [-13.3, 8.5]]] },
      /crosses over itself/,
    ],
    [{ type: "Polygon", coordinates: [[[-0.1, 51.5], [0, 51.5], [0, 51.6]]] }, /outside Sierra Leone/],
    [
      // About 11 m across.
      { type: "Polygon", coordinates: [[[-13.2, 8.44], [-13.1999, 8.44], [-13.1999, 8.4401]]] },
      /too small/,
    ],
    [
      {
        type: "Polygon",
        coordinates: [box(-13.3, 8.44, -13.2, 8.5).coordinates[0], box(-13.28, 8.46, -13.26, 8.48).coordinates[0]],
      },
      /hole/,
    ],
    [
      { type: "MultiPolygon", coordinates: [box(-13.3, 8.44, -13.24, 8.5).coordinates, box(-13.26, 8.44, -13.2, 8.5).coordinates] },
      /overlap/,
    ],
  ];
  for (const [input, message] of cases) {
    const result = validateBoundary(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    if (!result.ok) assert.match(result.error, message);
  }
});

test("a zone made of separate areas is accepted", () => {
  const result = validateBoundary({
    type: "MultiPolygon",
    coordinates: [WEST.coordinates, box(-13.1, 8.3, -13.05, 8.35).coordinates],
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(zoneContains(result.boundary, [-13.07, 8.32]), true);
});

// ── Pricing ─────────────────────────────────────────────────────────────────

const zones = [zone("West", WEST, 15_000), zone("East", EAST, 25_000)];

test("same zone: that zone's fee", () => {
  const quote = quoteDelivery({ pharmacy: [-13.28, 8.47], patient: [-13.26, 8.46], zones });
  assert.deepEqual(quote, {
    available: true,
    feeMinor: 15_000,
    zoneId: "West",
    zoneName: "West",
    pharmacyZoneName: "West",
    pricing: "same_zone",
  });
});

test("different zones: the higher of the two fees, whichever end it is", () => {
  const out = quoteDelivery({ pharmacy: [-13.28, 8.47], patient: [-13.2, 8.47], zones });
  const back = quoteDelivery({ pharmacy: [-13.2, 8.47], patient: [-13.28, 8.47], zones });
  for (const quote of [out, back]) {
    assert.equal(quote.available, true);
    if (!quote.available) continue;
    assert.equal(quote.feeMinor, 25_000);
    assert.equal(quote.pricing, "cross_zone");
  }
});

test("different zones: the order is named after the patient's zone, not the fee's", () => {
  // West pharmacy (Le 150) to a patient in East (Le 250), and the other way round.
  const out = quoteDelivery({ pharmacy: [-13.28, 8.47], patient: [-13.2, 8.47], zones });
  const back = quoteDelivery({ pharmacy: [-13.2, 8.47], patient: [-13.28, 8.47], zones });
  assert.ok(out.available && back.available);
  assert.deepEqual([out.zoneId, out.zoneName, out.pharmacyZoneName], ["East", "East", "West"]);
  assert.deepEqual([back.zoneId, back.zoneName, back.pharmacyZoneName], ["West", "West", "East"]);
});

test("a patient on the shared border pays the cheaper zone", () => {
  const quote = quoteDelivery({ pharmacy: [-13.2, 8.47], patient: [-13.24, 8.47], zones });
  // The border belongs to both, so this is a same-zone delivery within East...
  assert.equal(quote.available && quote.pricing, "same_zone");
  // ...while from a West pharmacy the border point is also in West, the cheaper.
  const fromWest = quoteDelivery({ pharmacy: [-13.28, 8.47], patient: [-13.24, 8.47], zones });
  assert.equal(fromWest.available && fromWest.feeMinor, 15_000);
});

test("no delivery when either end is outside every zone", () => {
  assert.deepEqual(quoteDelivery({ pharmacy: [-13.28, 8.47], patient: [-13.0, 8.3], zones }), {
    available: false,
    reason: "patient_outside_zones",
  });
  assert.deepEqual(quoteDelivery({ pharmacy: [-13.0, 8.3], patient: [-13.28, 8.47], zones }), {
    available: false,
    reason: "pharmacy_outside_zones",
  });
  assert.deepEqual(quoteDelivery({ pharmacy: null, patient: [-13.28, 8.47], zones }), {
    available: false,
    reason: "pharmacy_not_located",
  });
});

// ── Fees over time ──────────────────────────────────────────────────────────

test("the fee in force is the latest that has started; a later one waits", () => {
  const rows = [
    { feeMinor: 10_000, effectiveFrom: new Date("2026-09-01T00:00:00Z") },
    { feeMinor: 12_000, effectiveFrom: new Date("2026-09-20T00:00:00Z") },
    { feeMinor: 15_000, effectiveFrom: new Date("2026-09-24T00:00:00Z") },
  ];
  const now = new Date("2026-09-23T14:00:00Z");
  assert.equal(feeInForce(rows, now)?.feeMinor, 12_000);
  assert.equal(scheduledFee(rows, now)?.feeMinor, 15_000);
  // At midnight the scheduled fee takes over by itself.
  assert.equal(feeInForce(rows, new Date("2026-09-24T00:00:00Z"))?.feeMinor, 15_000);
  assert.equal(scheduledFee(rows, new Date("2026-09-24T00:00:00Z")), null);
  assert.equal(feeInForce([], now), null);
});

test("fee changes are scheduled for the next midnight in Freetown", () => {
  assert.equal(
    nextBusinessMidnight(new Date("2026-09-23T14:00:00Z")).toISOString(),
    "2026-09-24T00:00:00.000Z",
  );
  // A minute before midnight still means the coming midnight.
  assert.equal(
    nextBusinessMidnight(new Date("2026-12-31T23:59:00Z")).toISOString(),
    "2027-01-01T00:00:00.000Z",
  );
  // Exactly midnight means the following one, never "now".
  assert.equal(
    nextBusinessMidnight(new Date("2026-09-24T00:00:00Z")).toISOString(),
    "2026-09-25T00:00:00.000Z",
  );
  // The calculation respects zones that are not on GMT.
  assert.equal(
    nextBusinessMidnight(new Date("2026-09-23T14:00:00Z"), "Africa/Lagos").toISOString(),
    "2026-09-23T23:00:00.000Z",
  );
});
