/**
 * Where a search came from, as an area name only.
 *
 * The phone's location (when the patient allows it) is turned into the name
 * of the MobiCare delivery zone it falls in, or, outside every zone, the
 * district. Only that name is stored: never the coordinates, so no search can
 * be traced back to a house.
 *
 * Without a location from the phone, the zone of the patient's last delivery
 * pin is used, then a district named in their address, then "Unknown".
 */

import { desc, eq, isNotNull, and } from "drizzle-orm";
import { db, deliveryZonesTable, ordersTable } from "@workspace/db";
import { zoneContains, type Boundary, type Position } from "../delivery/geometry.js";
import { SIERRA_LEONE_DISTRICTS } from "../geo/sierraLeoneDistricts.js";

export type AreaSource = "location" | "delivery_pin" | "address" | "unknown";

export interface SearchArea {
  /** The delivery zone the search came from, if it was inside one. */
  zone: string | null;
  /** The district, or "Unknown". */
  district: string;
  source: AreaSource;
}

export interface NamedArea {
  name: string;
  boundary: Boundary;
}

const DISTRICT_AREAS: NamedArea[] = SIERRA_LEONE_DISTRICTS.map((district) => ({
  name: district.name,
  boundary: { type: "MultiPolygon", coordinates: district.polygons },
}));

/** The district a [longitude, latitude] point is in, or null outside the country. */
export function districtAt(point: Position): string | null {
  return DISTRICT_AREAS.find((district) => zoneContains(district.boundary, point))?.name ?? null;
}

/** The first zone containing the point, or null. */
export function zoneAt(point: Position, zones: NamedArea[]): string | null {
  return zones.find((zone) => zoneContains(zone.boundary, point))?.name ?? null;
}

// Names as written in addresses, matched to the district they mean. Longer
// names first, so "western area" is not read as some shorter match.
const ADDRESS_DISTRICTS: Array<[string, string]> = [
  ["western area rural", "Western Area Rural"],
  ["western area urban", "Western Area Urban (Freetown)"],
  ["western area", "Western Area Urban (Freetown)"],
  ["freetown", "Western Area Urban (Freetown)"],
  ["port loko", "Port Loko"],
  ["bombali", "Bombali"],
  ["makeni", "Bombali"],
  ["bonthe", "Bonthe"],
  ["kailahun", "Kailahun"],
  ["kambia", "Kambia"],
  ["kenema", "Kenema"],
  ["koinadugu", "Koinadugu"],
  ["falaba", "Koinadugu"],
  ["karene", "Bombali"],
  ["kono", "Kono"],
  ["moyamba", "Moyamba"],
  ["pujehun", "Pujehun"],
  ["tonkolili", "Tonkolili"],
  ["bo", "Bo"],
];

/** A district named in a free-text address, or null. Whole words only. */
export function districtFromAddress(address: string | null | undefined): string | null {
  const words = ` ${address?.toLocaleLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim() ?? ""} `;
  if (words.trim() === "") return null;
  return ADDRESS_DISTRICTS.find(([name]) => words.includes(` ${name} `))?.[1] ?? null;
}

/** Pure: decides the area from what is known, so it can be tested. */
export function areaFrom(input: {
  location: Position | null;
  deliveryPin: Position | null;
  address: string | null | undefined;
  zones: NamedArea[];
}): SearchArea {
  for (const [point, source] of [
    [input.location, "location"],
    [input.deliveryPin, "delivery_pin"],
  ] as const) {
    if (!point) continue;
    const district = districtAt(point);
    const zone = zoneAt(point, input.zones);
    // A point outside the country and every zone is not a usable location.
    if (zone || district) return { zone, district: district ?? "Unknown", source };
  }
  const fromAddress = districtFromAddress(input.address);
  if (fromAddress) return { zone: null, district: fromAddress, source: "address" };
  return { zone: null, district: "Unknown", source: "unknown" };
}

let zoneCache: { at: number; zones: NamedArea[] } | null = null;
const ZONE_CACHE_MS = 60_000;

/** Every drawn zone, switched on or off: a switched-off zone is still an area. */
async function namedZones(): Promise<NamedArea[]> {
  if (zoneCache && Date.now() - zoneCache.at < ZONE_CACHE_MS) return zoneCache.zones;
  const rows = await db
    .select({ name: deliveryZonesTable.name, boundary: deliveryZonesTable.boundary })
    .from(deliveryZonesTable);
  const zones = rows.map((row) => ({ name: row.name, boundary: row.boundary as Boundary }));
  zoneCache = { at: Date.now(), zones };
  return zones;
}

/** The area for one search by this patient. */
export async function resolveSearchArea(input: {
  patientId: string;
  location: Position | null;
  address: string | null | undefined;
}): Promise<SearchArea> {
  const zones = await namedZones();
  let deliveryPin: Position | null = null;
  if (!input.location) {
    const [last] = await db
      .select({ latitude: ordersTable.deliveryLatitude, longitude: ordersTable.deliveryLongitude })
      .from(ordersTable)
      .where(and(eq(ordersTable.patientId, input.patientId), isNotNull(ordersTable.deliveryLatitude)))
      .orderBy(desc(ordersTable.createdAt))
      .limit(1);
    if (last?.latitude != null && last.longitude != null) {
      deliveryPin = [Number(last.longitude), Number(last.latitude)];
    }
  }
  return areaFrom({ location: input.location, deliveryPin, address: input.address, zones });
}
