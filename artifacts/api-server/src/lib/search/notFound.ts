/**
 * Why a search did not give the patient a medicine they could get.
 *
 * "Not available" covers two outcomes: nothing matched at all, or matches
 * came back but no pharmacy has any in stock. For a report to the Ministry or
 * a donor the reason matters as much as the count:
 *
 *   out_of_stock      MobiCare pharmacies list it, but every one is out of it.
 *   not_listed        A medicine MobiCare knows, but no pharmacy offers it.
 *   not_in_catalogue  Nothing like it in MobiCare's catalogue at all.
 *
 * A misspelling of a medicine that IS in stock is not a medicine not found:
 * the patient is offered "Did you mean …?" and the medicine is there. Since
 * 12 Oct 2026 such searches are not recorded as not found at all ("misspelled"
 * remains only on older rows, which the report and alerts leave out). A
 * misspelling of a medicine nobody has in stock still counts, under the
 * medicine's real name, so "amoxicilin" and "amoxicillin" are one medicine.
 */

import { and, eq, gt } from "drizzle-orm";
import { db, drugCatalogueTable, pharmaciesTable, pharmacyInventoryTable } from "@workspace/db";
import { normaliseSearch } from "./searchEvents.js";

export type NotFoundReason = "out_of_stock" | "not_listed" | "misspelled" | "not_in_catalogue";

export interface Unavailable {
  reason: NotFoundReason;
  /** The catalogue medicine the search was about, when one could be told. */
  drugId: string | null;
  drugName: string | null;
}

export interface CatalogueName {
  id: string;
  name: string;
  genericName: string | null;
}

/** What the search returned, as far as this needs to know. */
export interface ReturnedDrug {
  drugId: string;
  name: string;
  offers: Array<{ inStock: boolean }>;
}

/** Edit distance between two short strings (insert, delete, change, swap). */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * The catalogue medicine a typed word most likely meant, or null. A name is
 * close enough when at most one letter in four differs (and at least two
 * letters agree), e.g. "amoxicilin", "paracetmol", "artemeter".
 */
export function closestMedicine(query: string, catalogue: CatalogueName[]): CatalogueName | null {
  const typed = normaliseSearch(query).replace(/[^a-z0-9 ]/g, "");
  if (typed.length < 4) return null;
  let best: { drug: CatalogueName; score: number } | null = null;
  for (const drug of catalogue) {
    for (const candidate of [drug.name, drug.genericName]) {
      if (!candidate) continue;
      const name = normaliseSearch(candidate).replace(/[^a-z0-9 ]/g, "");
      // Compare with the start of the name, so "amoxicilin" meets
      // "amoxicillin" and not "amoxicillin + clavulanic acid" as a whole.
      const target = name.length > typed.length + 2 ? name.slice(0, typed.length + 1) : name;
      const distance = editDistance(typed, target);
      const allowed = Math.max(1, Math.floor(typed.length / 4));
      if (distance <= allowed && (!best || distance < best.score)) best = { drug, score: distance };
    }
  }
  return best?.drug ?? null;
}

/** A catalogue medicine, and whether any active pharmacy lists it or has it in stock. */
export interface Availability {
  drug: CatalogueName;
  listed: boolean;
  inStock: boolean;
}

/** Pure: the reason, given what the search returned and the catalogue. */
export function classify(input: {
  returned: ReturnedDrug[];
  /** A catalogue medicine whose name contains the words typed. */
  known: Availability | null;
  /** Otherwise, the medicine a misspelled search most likely meant. */
  closest: Availability | null;
}): Unavailable | null {
  if (input.returned.some((drug) => drug.offers.some((offer) => offer.inStock))) return null;
  const first = input.returned[0];
  if (first) return { reason: "out_of_stock", drugId: first.drugId, drugName: first.name };
  if (input.known) {
    const { drug, listed, inStock } = input.known;
    // In stock somewhere: this search was narrowed (one pharmacy, one
    // category), so the medicine is not missing from MobiCare.
    if (inStock) return null;
    return { reason: listed ? "out_of_stock" : "not_listed", drugId: drug.id, drugName: drug.name };
  }
  if (input.closest) {
    const { drug, listed, inStock } = input.closest;
    // Only a spelling problem: the medicine is there to be found.
    if (inStock) return null;
    return {
      reason: listed ? "out_of_stock" : "not_listed",
      drugId: drug.id,
      drugName: drug.name,
    };
  }
  return { reason: "not_in_catalogue", drugId: null, drugName: null };
}

let catalogueCache: { at: number; rows: CatalogueName[] } | null = null;
const CATALOGUE_CACHE_MS = 5 * 60_000;

async function approvedCatalogue(): Promise<CatalogueName[]> {
  if (catalogueCache && Date.now() - catalogueCache.at < CATALOGUE_CACHE_MS) return catalogueCache.rows;
  const rows = await db
    .select({ id: drugCatalogueTable.id, name: drugCatalogueTable.name, genericName: drugCatalogueTable.genericName })
    .from(drugCatalogueTable)
    .where(eq(drugCatalogueTable.isApproved, true));
  catalogueCache = { at: Date.now(), rows };
  return rows;
}

/** Whether any active pharmacy lists the medicine, and whether any has it in stock. */
async function availability(drugId: string): Promise<{ listed: boolean; inStock: boolean }> {
  const rows = await db
    .select({ stock: pharmacyInventoryTable.stockQuantity })
    .from(pharmacyInventoryTable)
    .innerJoin(pharmaciesTable, eq(pharmaciesTable.id, pharmacyInventoryTable.pharmacyId))
    .where(
      and(
        eq(pharmacyInventoryTable.drugId, drugId),
        eq(pharmacyInventoryTable.isActive, true),
        eq(pharmacyInventoryTable.completionStatus, "complete"),
        gt(pharmacyInventoryTable.expiryDate, new Date().toISOString().slice(0, 10)),
        eq(pharmaciesTable.isActive, true),
      ),
    );
  return { listed: rows.length > 0, inStock: rows.some((row) => row.stock > 0) };
}

let listedCache: { at: number; ids: Set<string> } | null = null;

/** Catalogue medicines at least one active pharmacy currently lists. */
async function listedMedicineIds(): Promise<Set<string>> {
  if (listedCache && Date.now() - listedCache.at < CATALOGUE_CACHE_MS) return listedCache.ids;
  const rows = await db
    .selectDistinct({ drugId: pharmacyInventoryTable.drugId })
    .from(pharmacyInventoryTable)
    .innerJoin(pharmaciesTable, eq(pharmaciesTable.id, pharmacyInventoryTable.pharmacyId))
    .where(
      and(
        eq(pharmacyInventoryTable.isActive, true),
        eq(pharmacyInventoryTable.completionStatus, "complete"),
        gt(pharmacyInventoryTable.expiryDate, new Date().toISOString().slice(0, 10)),
        eq(pharmaciesTable.isActive, true),
      ),
    );
  const ids = new Set(rows.map((row) => row.drugId).filter((id): id is string => Boolean(id)));
  listedCache = { at: Date.now(), ids };
  return ids;
}

/**
 * "Did you mean …?" for a search that found nothing: the medicine the words
 * were closest to, among those a pharmacy lists, so following the suggestion
 * always leads somewhere. Null when nothing is close or the words already
 * name a medicine (no pharmacy offering it is not a spelling problem).
 */
export async function suggestMedicine(query: string): Promise<{ drugId: string; name: string } | null> {
  const typed = normaliseSearch(query);
  if (typed.length < 4) return null;
  const catalogue = await approvedCatalogue();
  const named = catalogue.some(
    (drug) => normaliseSearch(drug.name).includes(typed) || (drug.genericName ? normaliseSearch(drug.genericName).includes(typed) : false),
  );
  if (named) return null;
  const listed = await listedMedicineIds();
  const drug = closestMedicine(query, catalogue.filter((entry) => listed.has(entry.id)));
  return drug ? { drugId: drug.id, name: drug.name } : null;
}

/** Why this search gave nothing the patient could get, or null when it did. */
export async function whyUnavailable(query: string, returned: ReturnedDrug[]): Promise<Unavailable | null> {
  if (returned.some((drug) => drug.offers.some((offer) => offer.inStock))) return null;
  if (returned.length > 0) return classify({ returned, known: null, closest: null });
  const catalogue = await approvedCatalogue();
  const typed = normaliseSearch(query);
  const match = catalogue.find(
    (drug) => normaliseSearch(drug.name).includes(typed) || (drug.genericName ? normaliseSearch(drug.genericName).includes(typed) : false),
  );
  const known = match ? { drug: match, ...(await availability(match.id)) } : null;
  let closest: Availability | null = null;
  if (!known) {
    const drug = closestMedicine(query, catalogue);
    if (drug) closest = { drug, ...(await availability(drug.id)) };
  }
  return classify({ returned, known, closest });
}
