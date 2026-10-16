/**
 * How far a rider goes from the pharmacy to the patient.
 *
 * With OPENROUTESERVICE_API_KEY set, the road distance comes from
 * OpenRouteService (OpenStreetMap roads; free plan: 2,000 lookups a day).
 * Without it, or if the service fails, it is estimated: the straight line ×
 * 1.3, since Freetown's roads wind round hills and the bay. The answer says
 * which one it is.
 */
import { logger } from "../logger.js";
import type { Position } from "./geometry.js";

export const ROAD_FACTOR = 1.3;
const ORS_URL = "https://api.openrouteservice.org/v2/directions/driving-car";

export interface RoadDistance {
  km: number;
  straightKm: number;
  method: "road" | "estimate";
}

/** Distance along the earth's surface, in km. Positions are [lng, lat]. */
export function straightKm(a: Position, b: Position): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function estimateKm(a: Position, b: Position): RoadDistance {
  const straight = straightKm(a, b);
  return { km: round1(straight * ROAD_FACTOR), straightKm: round1(straight), method: "estimate" };
}

const round1 = (km: number) => Math.round(km * 10) / 10;

// The same trip is asked for again and again (a pin nudged, a page reloaded):
// remember answers for a day, keyed to about 10 m.
const cache = new Map<string, { at: number; km: number }>();
const DAY_MS = 24 * 3600 * 1000;
const key = (a: Position, b: Position) => [a, b].map((p) => p.map((v) => v.toFixed(4)).join(",")).join(";");

export async function roadDistance(from: Position, to: Position, apiKey = process.env["OPENROUTESERVICE_API_KEY"]): Promise<RoadDistance> {
  const estimate = estimateKm(from, to);
  if (!apiKey || estimate.straightKm < 0.05) return estimate;
  const k = key(from, to);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < DAY_MS) return { km: hit.km, straightKm: estimate.straightKm, method: "road" };
  try {
    const res = await fetch(ORS_URL, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ coordinates: [from, to], instructions: false }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`OpenRouteService answered ${res.status}`);
    const body = (await res.json()) as { routes?: Array<{ summary?: { distance?: number } }> };
    const metres = body.routes?.[0]?.summary?.distance;
    if (typeof metres !== "number" || !Number.isFinite(metres)) throw new Error("No route in the answer");
    const km = round1(metres / 1000);
    if (cache.size > 5000) cache.clear();
    cache.set(k, { at: Date.now(), km });
    return { km, straightKm: estimate.straightKm, method: "road" };
  } catch (err) {
    logger.warn({ err: String(err) }, "Road distance unavailable; using the straight-line estimate");
    return estimate;
  }
}
