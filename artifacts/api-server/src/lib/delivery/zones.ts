import { db } from "@workspace/db";
import {
  deliveryZoneFeesTable,
  deliveryZonesTable,
  pharmaciesTable,
  type DeliveryZone,
  type DeliveryZoneFee,
} from "@workspace/db/schema";
import { asc } from "drizzle-orm";
import { boundariesOverlap, type Boundary, type Position } from "./geometry.js";
import {
  feeInForce,
  quoteDelivery,
  scheduledFee,
  zonesAt,
  type DeliveryQuote,
  type PricedZone,
} from "./pricing.js";

/** The database side of delivery zones: loading them and asking questions of them. */

export interface ZoneWithFees extends DeliveryZone {
  currentFee: DeliveryZoneFee | null;
  scheduledFee: DeliveryZoneFee | null;
}

type Reader = Pick<typeof db, "select">;

export async function loadZones(now = new Date(), reader: Reader = db): Promise<ZoneWithFees[]> {
  const [zones, fees] = await Promise.all([
    reader.select().from(deliveryZonesTable).orderBy(asc(deliveryZonesTable.name)),
    reader.select().from(deliveryZoneFeesTable),
  ]);
  return zones.map((zone) => {
    const rows = fees.filter((fee) => fee.zoneId === zone.id);
    return {
      ...zone,
      currentFee: feeInForce(rows, now),
      scheduledFee: scheduledFee(rows, now),
    };
  });
}

/** Active zones that have a fee in force: the only ones that can price a delivery. */
export function pricedZones(zones: ZoneWithFees[]): PricedZone[] {
  return zones
    .filter((zone) => zone.isActive && zone.currentFee)
    .map((zone) => ({
      id: zone.id,
      name: zone.name,
      boundary: zone.boundary as Boundary,
      feeMinor: zone.currentFee!.feeMinor,
    }));
}

function parseCoordinate(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Where a pharmacy is, as [longitude, latitude]. Uses the current coordinate
 * fields, falling back to the legacy ones for pharmacies onboarded before
 * those existed.
 */
export function pharmacyPosition(pharmacy: {
  latitude: string | null;
  longitude: string | null;
  locationLat: string | null;
  locationLng: string | null;
}): Position | null {
  const latitude = parseCoordinate(pharmacy.latitude) ?? parseCoordinate(pharmacy.locationLat);
  const longitude = parseCoordinate(pharmacy.longitude) ?? parseCoordinate(pharmacy.locationLng);
  if (latitude == null || longitude == null) return null;
  return [longitude, latitude];
}

/** Prices a delivery from a pharmacy to a point, with the fees in force now. */
export async function quoteForPharmacy(
  pharmacy: Parameters<typeof pharmacyPosition>[0],
  patient: Position,
  now = new Date(),
  reader: Reader = db,
): Promise<DeliveryQuote> {
  const zones = pricedZones(await loadZones(now, reader));
  return quoteDelivery({ pharmacy: pharmacyPosition(pharmacy), patient, zones });
}

/** The active zones a proposed outline would overlap (rule R4). */
export function overlappingZones(
  boundary: Boundary,
  zones: ZoneWithFees[],
  exceptZoneId?: string,
): ZoneWithFees[] {
  return zones.filter(
    (zone) =>
      zone.isActive &&
      zone.id !== exceptZoneId &&
      boundariesOverlap(boundary, zone.boundary as Boundary),
  );
}

export interface PharmacyPlacement {
  id: string;
  name: string;
  isActive: boolean;
  latitude: number | null;
  longitude: number | null;
  zoneId: string | null;
  zoneName: string | null;
}

/**
 * Every pharmacy with the zone it sits in. When a pharmacy sits on a border it
 * belongs to the cheaper zone, as it would for pricing.
 */
export async function placePharmacies(
  zones: PricedZone[],
  reader: Reader = db,
): Promise<PharmacyPlacement[]> {
  const pharmacies = await reader
    .select({
      id: pharmaciesTable.id,
      name: pharmaciesTable.name,
      isActive: pharmaciesTable.isActive,
      latitude: pharmaciesTable.latitude,
      longitude: pharmaciesTable.longitude,
      locationLat: pharmaciesTable.locationLat,
      locationLng: pharmaciesTable.locationLng,
    })
    .from(pharmaciesTable)
    .orderBy(asc(pharmaciesTable.name));
  return pharmacies.map((pharmacy) => {
    const position = pharmacyPosition(pharmacy);
    const zone = position ? zonesAt(position, zones)[0] : undefined;
    return {
      id: pharmacy.id,
      name: pharmacy.name,
      isActive: pharmacy.isActive,
      latitude: position ? position[1] : null,
      longitude: position ? position[0] : null,
      zoneId: zone?.id ?? null,
      zoneName: zone?.name ?? null,
    };
  });
}
