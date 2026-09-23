/**
 * Plane geometry for delivery zones.
 *
 * Coordinates follow GeoJSON: [longitude, latitude]. Zones are a few kilometres
 * across, so treating degrees as flat x/y is accurate enough to decide which
 * side of a border a point is on; only areas are converted to square metres.
 *
 * Written here rather than taken from a GIS library because the rules are
 * small and specific: borders count as inside, neighbouring zones may share a
 * border but not overlap, and zones have no holes.
 */

export type Position = [number, number];
export type Ring = Position[];
export type Boundary =
  | { type: "Polygon"; coordinates: Ring[] }
  | { type: "MultiPolygon"; coordinates: Ring[][] };

/** About a centimetre. Differences smaller than this are the same place. */
const EPSILON = 1e-7;

/** Smallest zone accepted, in square metres (one hectare). */
export const MIN_ZONE_AREA_M2 = 10_000;

/**
 * A box around Sierra Leone with a little sea on each side, so a coastal zone
 * drawn slightly past the shoreline is still accepted.
 */
export const SIERRA_LEONE_BOUNDS = {
  minLatitude: 6.75,
  maxLatitude: 10.05,
  minLongitude: -13.5,
  maxLongitude: -10.2,
} as const;

// ── Basic predicates ─────────────────────────────────────────────────────────

function cross(o: Position, a: Position, b: Position): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function samePoint(a: Position, b: Position): boolean {
  return Math.abs(a[0] - b[0]) <= EPSILON && Math.abs(a[1] - b[1]) <= EPSILON;
}

/** True when p lies on segment ab, ends included. */
function onSegment(p: Position, a: Position, b: Position): boolean {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length === 0) return samePoint(p, a);
  if (Math.abs(cross(a, b, p)) / length > EPSILON) return false;
  return (
    p[0] >= Math.min(a[0], b[0]) - EPSILON &&
    p[0] <= Math.max(a[0], b[0]) + EPSILON &&
    p[1] >= Math.min(a[1], b[1]) - EPSILON &&
    p[1] <= Math.max(a[1], b[1]) + EPSILON
  );
}

function orientation(a: Position, b: Position, c: Position): -1 | 0 | 1 {
  const value = cross(a, b, c);
  const scale = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (scale === 0 || Math.abs(value) / scale <= EPSILON) return 0;
  return value > 0 ? 1 : -1;
}

/** True when segments ab and cd touch or cross anywhere. */
function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) {
    return true;
  }
  return (
    onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d)
  );
}

// ── Rings ────────────────────────────────────────────────────────────────────

/** The ring's corners without the repeated closing point. */
function corners(ring: Ring): Position[] {
  const points = ring.slice();
  if (points.length > 1 && samePoint(points[0]!, points[points.length - 1]!)) {
    points.pop();
  }
  return points;
}

/** Signed area in square degrees; positive when the corners run anticlockwise. */
function signedArea(points: Position[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Area in square metres, using a local flat projection. */
export function ringAreaSquareMetres(ring: Ring): number {
  const points = corners(ring);
  if (points.length < 3) return 0;
  const meanLatitude = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const metresPerDegreeLng = 111_320 * Math.cos((meanLatitude * Math.PI) / 180);
  const metresPerDegreeLat = 110_574;
  const projected = points.map(
    ([lng, lat]) => [lng * metresPerDegreeLng, lat * metresPerDegreeLat] as Position,
  );
  return Math.abs(signedArea(projected));
}

/** A zone's whole area in square kilometres, to two decimals. */
export function boundaryAreaSquareKm(boundary: Boundary): number {
  const squareMetres = outerRings(boundary).reduce(
    (sum, ring) => sum + ringAreaSquareMetres(ring),
    0,
  );
  return Math.round(squareMetres / 10_000) / 100;
}

type PointLocation = "inside" | "border" | "outside";

function locateInRing(point: Position, ring: Ring): PointLocation {
  const points = corners(ring);
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (onSegment(point, a, b)) return "border";
    if (a[1] > point[1] !== b[1] > point[1]) {
      const x = ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
      if (point[0] < x) inside = !inside;
    }
  }
  return inside ? "inside" : "outside";
}

/** The outer ring of every part. Zones have no holes (see validateBoundary). */
function outerRings(boundary: Boundary): Ring[] {
  return boundary.type === "Polygon"
    ? [boundary.coordinates[0]!]
    : boundary.coordinates.map((polygon) => polygon[0]!);
}

/** Where a point sits relative to a zone: inside, on its border, or outside. */
export function locatePoint(boundary: Boundary, point: Position): PointLocation {
  let result: PointLocation = "outside";
  for (const ring of outerRings(boundary)) {
    const location = locateInRing(point, ring);
    if (location === "inside") return "inside";
    if (location === "border") result = "border";
  }
  return result;
}

/** A point on a zone's border counts as inside it (rule R6). */
export function zoneContains(boundary: Boundary, point: Position): boolean {
  return locatePoint(boundary, point) !== "outside";
}

// ── Overlap ──────────────────────────────────────────────────────────────────

type Triangle = [Position, Position, Position];

/**
 * Splits a simple ring into triangles (ear clipping). Corners that lie on a
 * straight line add no area and are dropped first.
 */
function triangulate(ring: Ring): Triangle[] {
  let points = corners(ring).filter(
    (p, i, all) => i === 0 || !samePoint(p, all[i - 1]!),
  );
  points = points.filter((p, i, all) => {
    const prev = all[(i - 1 + all.length) % all.length]!;
    const next = all[(i + 1) % all.length]!;
    return orientation(prev, p, next) !== 0;
  });
  if (signedArea(points) < 0) points.reverse();

  const triangles: Triangle[] = [];
  let guard = points.length * points.length + 10;
  while (points.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < points.length; i++) {
      const prev = points[(i - 1 + points.length) % points.length]!;
      const current = points[i]!;
      const next = points[(i + 1) % points.length]!;
      if (orientation(prev, current, next) <= 0) continue;
      const blocked = points.some(
        (p) =>
          p !== prev &&
          p !== current &&
          p !== next &&
          orientation(prev, current, p) >= 0 &&
          orientation(current, next, p) >= 0 &&
          orientation(next, prev, p) >= 0,
      );
      if (blocked) continue;
      triangles.push([prev, current, next]);
      points.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Only reachable when a corner sits exactly on a diagonal. Clip the
      // first convex corner anyway so no part of the zone goes uncounted.
      const i = points.findIndex(
        (p, k) =>
          orientation(
            points[(k - 1 + points.length) % points.length]!,
            p,
            points[(k + 1) % points.length]!,
          ) > 0,
      );
      if (i < 0) break;
      triangles.push([
        points[(i - 1 + points.length) % points.length]!,
        points[i]!,
        points[(i + 1) % points.length]!,
      ]);
      points.splice(i, 1);
    }
  }
  if (points.length === 3) triangles.push([points[0]!, points[1]!, points[2]!]);
  return triangles;
}

/**
 * True when two triangles share some area. Touching along an edge or at a
 * corner does not count: there is a separating line through the contact.
 */
function trianglesOverlap(a: Triangle, b: Triangle): boolean {
  for (const shape of [a, b]) {
    for (let i = 0; i < 3; i++) {
      const p = shape[i]!;
      const q = shape[(i + 1) % 3]!;
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (length === 0) continue;
      const nx = -(q[1] - p[1]) / length;
      const ny = (q[0] - p[0]) / length;
      const project = (t: Triangle) => t.map(([x, y]) => x * nx + y * ny);
      const pa = project(a);
      const pb = project(b);
      if (
        Math.max(...pa) <= Math.min(...pb) + EPSILON ||
        Math.max(...pb) <= Math.min(...pa) + EPSILON
      ) {
        return false;
      }
    }
  }
  return true;
}

function bbox(ring: Ring) {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function ringsOverlap(a: Ring, b: Ring): boolean {
  const boxA = bbox(a);
  const boxB = bbox(b);
  if (
    boxA.maxX <= boxB.minX + EPSILON ||
    boxB.maxX <= boxA.minX + EPSILON ||
    boxA.maxY <= boxB.minY + EPSILON ||
    boxB.maxY <= boxA.minY + EPSILON
  ) {
    return false;
  }
  const trianglesA = triangulate(a);
  const trianglesB = triangulate(b);
  return trianglesA.some((ta) => trianglesB.some((tb) => trianglesOverlap(ta, tb)));
}

/**
 * True when two zones cover some of the same ground (rule R4). Sharing a
 * border, or touching at a corner, is allowed.
 */
export function boundariesOverlap(a: Boundary, b: Boundary): boolean {
  return outerRings(a).some((ringA) =>
    outerRings(b).some((ringB) => ringsOverlap(ringA, ringB)),
  );
}

// ── Validation ───────────────────────────────────────────────────────────────

export type BoundaryCheck =
  | { ok: true; boundary: Boundary }
  | { ok: false; error: string };

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

/** Six decimals is about 11 cm: finer than anyone can place a corner. */
function roundPosition([lng, lat]: Position): Position {
  return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
}

function checkRing(raw: unknown, label: string): { ring: Ring } | { error: string } {
  if (!Array.isArray(raw) || !raw.every(isPosition)) {
    return { error: `${label} is not a list of map points.` };
  }
  const points = corners((raw as Position[]).map(roundPosition)).filter(
    (p, i, all) => i === 0 || !samePoint(p, all[i - 1]!),
  );
  if (points.length > 1 && samePoint(points[0]!, points[points.length - 1]!)) {
    points.pop();
  }
  const distinct = points.filter(
    (p, i) => points.findIndex((q) => samePoint(p, q)) === i,
  );
  if (distinct.length < 3) {
    return { error: `${label} needs at least three separate corners.` };
  }
  if (distinct.length !== points.length) {
    return { error: `${label} passes through the same corner twice.` };
  }

  const b = SIERRA_LEONE_BOUNDS;
  for (const [lng, lat] of points) {
    if (
      lat < b.minLatitude ||
      lat > b.maxLatitude ||
      lng < b.minLongitude ||
      lng > b.maxLongitude
    ) {
      return { error: `${label} reaches outside Sierra Leone.` };
    }
  }

  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a1 = points[i]!;
    const a2 = points[(i + 1) % n]!;
    const next = points[(i + 2) % n]!;
    // Doubling straight back along the previous edge makes a zero-width spike.
    if (
      orientation(a1, a2, next) === 0 &&
      (next[0] - a2[0]) * (a2[0] - a1[0]) + (next[1] - a2[1]) * (a2[1] - a1[1]) < 0
    ) {
      return { error: `${label} folds back on itself.` };
    }
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // first and last edges share a corner
      if (segmentsIntersect(a1, a2, points[j]!, points[(j + 1) % n]!)) {
        return { error: `${label} crosses over itself.` };
      }
    }
  }

  const ring: Ring = [...points, points[0]!];
  if (ringAreaSquareMetres(ring) < MIN_ZONE_AREA_M2) {
    return { error: `${label} is too small to deliver to (under one hectare).` };
  }
  return { ring };
}

/**
 * Checks a drawn zone against rules R2, R3 and R9, and returns it in a clean
 * form: closed rings, coordinates rounded to six decimals.
 */
export function validateBoundary(input: unknown): BoundaryCheck {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Draw the zone on the map." };
  }
  const { type, coordinates } = input as { type?: unknown; coordinates?: unknown };
  if (type !== "Polygon" && type !== "MultiPolygon") {
    return { ok: false, error: "A zone must be one area or several separate areas." };
  }
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return { ok: false, error: "Draw the zone on the map." };
  }

  const polygons = (type === "Polygon" ? [coordinates] : coordinates) as unknown[];
  const parts: Ring[] = [];
  for (let index = 0; index < polygons.length; index++) {
    const polygon = polygons[index];
    const label = polygons.length > 1 ? `Area ${index + 1} of this zone` : "The zone";
    if (!Array.isArray(polygon) || polygon.length === 0) {
      return { ok: false, error: `${label} has no outline.` };
    }
    if (polygon.length > 1) {
      return { ok: false, error: `${label} has a hole in it; zones cannot have holes.` };
    }
    const checked = checkRing(polygon[0], label);
    if ("error" in checked) return { ok: false, error: checked.error };
    parts.push(checked.ring);
  }

  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (ringsOverlap(parts[i]!, parts[j]!)) {
        return {
          ok: false,
          error: `Areas ${i + 1} and ${j + 1} of this zone overlap; merge them into one.`,
        };
      }
    }
  }

  return {
    ok: true,
    boundary:
      parts.length === 1 && type === "Polygon"
        ? { type: "Polygon", coordinates: [parts[0]!] }
        : { type: "MultiPolygon", coordinates: parts.map((ring) => [ring]) },
  };
}
