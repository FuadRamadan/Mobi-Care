/**
 * What patients and pharmacies see of a prescription request. Kept apart from
 * the routes so the privacy rules live in one place: before a pharmacy
 * accepts, it sees the area and the covered photo only.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  drugCatalogueTable,
  pharmaciesTable,
  pharmacyInventoryTable,
  patientsTable,
  type PrescriptionRequest,
} from "@workspace/db";
import { mobileMoneyLines } from "./mobileMoney.js";
import { MAX_ROUNDS, distanceKm, roundEndsAt, ACCEPT_HOLD_MS } from "./prescriptionRequests.js";
import type { Position } from "./delivery/geometry.js";

/** A medicine the pharmacy confirmed, in the shape the patient app's cart uses. */
export async function requestItems(request: PrescriptionRequest) {
  const items = request.items ?? [];
  if (items.length === 0 || !request.acceptedPharmacyId) return [];
  const rows = await db
    .select({
      inventoryId: pharmacyInventoryTable.id,
      drugId: pharmacyInventoryTable.drugId,
      strength: pharmacyInventoryTable.strength,
      form: pharmacyInventoryTable.form,
      unitOfSale: pharmacyInventoryTable.unitOfSale,
      priceLeones: pharmacyInventoryTable.priceLeones,
      stockQuantity: pharmacyInventoryTable.stockQuantity,
      brand: pharmacyInventoryTable.brand,
      manufacturer: pharmacyInventoryTable.manufacturer,
      countryOfOrigin: pharmacyInventoryTable.countryOfOrigin,
      availableForDelivery: pharmacyInventoryTable.availableForDelivery,
      availableForCollection: pharmacyInventoryTable.availableForCollection,
      drugName: drugCatalogueTable.name,
      tier: drugCatalogueTable.tier,
      maxUnitsPerOrder: drugCatalogueTable.maxUnitsPerOrder,
    })
    .from(pharmacyInventoryTable)
    .innerJoin(drugCatalogueTable, eq(drugCatalogueTable.id, pharmacyInventoryTable.drugId))
    .where(and(eq(pharmacyInventoryTable.pharmacyId, request.acceptedPharmacyId), inArray(pharmacyInventoryTable.id, items.map((i) => i.inventoryId))));
  return items.flatMap((item) => {
    const r = rows.find((row) => row.inventoryId === item.inventoryId);
    if (!r) return [];
    const cap = Math.min(item.maxQuantity, r.stockQuantity, r.tier === "1" && r.maxUnitsPerOrder != null ? r.maxUnitsPerOrder : Infinity);
    return [{
      inventoryId: r.inventoryId,
      drugId: r.drugId,
      drugName: r.drugName,
      strength: r.strength ?? "",
      form: r.form ?? "",
      unitOfSale: r.unitOfSale ?? "",
      tier: r.tier as "1" | "2" | "3",
      priceLeones: Number(r.priceLeones),
      brand: r.brand,
      manufacturer: r.manufacturer,
      countryOfOrigin: r.countryOfOrigin,
      availableForDelivery: r.availableForDelivery && r.tier !== "1",
      availableForCollection: r.availableForCollection,
      prescriptionRequired: r.tier === "1" || r.tier === "2",
      collectionOnly: r.tier === "1",
      /** The pharmacist's limit for this prescription (and stock and the legal cap). */
      maxQuantity: Math.max(0, cap),
    }];
  });
}

/** The patient's view of their request. */
export async function patientView(request: PrescriptionRequest) {
  let pharmacy = null;
  if (request.acceptedPharmacyId && ["accepted", "ready", "ordered", "rejected"].includes(request.status)) {
    const [p] = await db.select().from(pharmaciesTable).where(eq(pharmaciesTable.id, request.acceptedPharmacyId)).limit(1);
    if (p) pharmacy = { id: p.id, name: p.name, address: p.address, mobileMoneyLines: mobileMoneyLines(p), mobileMoneyAccountName: p.mobileMoneyAccountName };
  }
  return {
    id: request.id,
    status: request.status,
    round: request.round,
    maxRounds: MAX_ROUNDS,
    roundEndsAt: roundEndsAt(request)?.toISOString() ?? null,
    areaName: request.areaName,
    note: request.note,
    pharmacy,
    items: request.status === "ready" || request.status === "ordered" ? await requestItems(request) : [],
    rejectReason: request.rejectReason,
    orderId: request.orderId,
    createdAt: request.createdAt.toISOString(),
  };
}

/** A request offered to a pharmacy that has not accepted it: no patient details. */
export function openOfferView(request: PrescriptionRequest, pharmacyPoint: Position | null) {
  const km = pharmacyPoint ? distanceKm(pharmacyPoint, [request.longitude, request.latitude]) : null;
  return {
    id: request.id,
    areaName: request.areaName,
    distanceKm: km == null ? null : Math.max(0.5, Math.round(km * 2) / 2),
    hasCoveredPhoto: !!request.coveredImageKey,
    round: request.round,
    roundEndsAt: roundEndsAt(request)?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
  };
}

/** A request this pharmacy accepted: now it sees who it is for. */
export async function acceptedView(request: PrescriptionRequest) {
  const [patient] = await db.select({ name: patientsTable.name, phone: patientsTable.phone }).from(patientsTable).where(eq(patientsTable.id, request.patientId)).limit(1);
  return {
    id: request.id,
    status: request.status,
    areaName: request.areaName,
    note: request.note,
    patientName: patient?.name ?? null,
    patientPhone: patient?.phone ?? null,
    acceptedAt: request.acceptedAt?.toISOString() ?? null,
    confirmBy: request.acceptedAt && request.status === "accepted" ? new Date(request.acceptedAt.getTime() + ACCEPT_HOLD_MS).toISOString() : null,
    items: request.status === "accepted" ? [] : await requestItems(request),
    orderId: request.orderId,
  };
}
