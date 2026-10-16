/**
 * Prescription requests: a patient sends a photo of their prescription, and
 * the pharmacies around them are asked, round by round, whether they can fill
 * it. The first pharmacy to accept gets it (migration 0039).
 *
 *   Round 1  pharmacies within 3 km
 *   Round 2  within 8 km
 *   Round 3  as far as a rider delivers (HQ's maximum distance)
 *
 * Every pharmacy in rounds 1 to 3 can deliver. If none of them takes it and
 * there are pharmacies further away, the patient is asked ("out_of_range")
 * whether to try those too, knowing they would collect it themselves:
 *
 *   Round 4  beyond the delivery limit, up to 25 km (collection only)
 *
 * Each round lasts ROUND_MS. Only pharmacies whose portal is open (seen in the
 * last ONLINE_WINDOW_MS) are asked, and nobody is asked twice. A round with
 * nobody to ask is skipped at once. When every round is used up the request
 * expires and the patient is told.
 *
 * Once accepted, the pharmacist sees the original photo and the patient's
 * details, chooses what it can supply ("ready"), and the patient orders from
 * the normal cart. An accepted request the pharmacy does not answer within
 * ACCEPT_HOLD_MS goes back to the other pharmacies.
 *
 * Privacy: before accepting, pharmacies see only the covered copy of the photo
 * and the area name. Both photos are deleted when a request ends without an
 * order; when it becomes an order, the original moves to the prescription
 * record like any other.
 */
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  db,
  pharmaciesTable,
  prescriptionRequestOffersTable,
  prescriptionRequestsTable,
  prescriptionUploadsTable,
  patientsTable,
  type PrescriptionRequest,
} from "@workspace/db";
import { logger } from "./logger.js";
import type { Position } from "./delivery/geometry.js";
import { ROAD_FACTOR } from "./delivery/roadDistance.js";
import { loadPricing } from "./delivery/distanceQuote.js";
import { createPharmacyNotification } from "./pharmacyNotifications.js";
import { createPatientNotification } from "./patientNotifications.js";
import { deletePrescriptionFile } from "./prescriptionFiles.js";

export const ROUND_MS = 5 * 60_000;
/** Rounds 1 to 3 stay within delivery range; round 4 is the patient's choice. */
export const MAX_ROUNDS = 3;
export const COLLECTION_ROUND = 4;
/** Straight-line reach of rounds 1 and 2 (also capped at the delivery limit). */
export const ROUND_RADIUS_KM = [3, 8] as const;
/** The furthest anyone is asked: round 3 without a delivery limit, and round 4. */
export const WIDEST_KM = 25;
/** How long the patient has to choose "ask pharmacies further away". */
export const WIDER_CHOICE_MS = 30 * 60_000;
export const ONLINE_WINDOW_MS = 2 * 60_000;
export const ACCEPT_HOLD_MS = 15 * 60_000;
/** A ready request the patient has not ordered from expires after this. */
export const READY_HOLD_MS = 24 * 60 * 60_000;
export const MAX_OPEN_PER_PATIENT = 2;
export const MAX_PER_HOUR_PER_PATIENT = 5;
const TICK_MS = 15_000;

export const OPEN_STATUSES = ["searching", "accepted", "ready", "out_of_range"] as const;

// ── Pure rules (unit-tested) ────────────────────────────────────────────────

/** Great-circle distance in km between two [longitude, latitude] points. */
export function distanceKm(a: Position, b: Position): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface CandidatePharmacy {
  id: string;
  point: Position | null;
  online: boolean;
}

/**
 * Who a round may reach, in straight-line km. The delivery limit is road km,
 * so it is matched against the same road estimate checkout falls back on.
 */
function reaches(round: number, km: number, maxKm: number | null): boolean {
  const deliverable = maxKm == null || km * ROAD_FACTOR <= maxKm;
  if (round === 1 || round === 2) return deliverable && km <= ROUND_RADIUS_KM[round - 1]!;
  if (round === 3) return maxKm == null ? km <= WIDEST_KM : deliverable;
  if (round === COLLECTION_ROUND) return km <= WIDEST_KM;
  return false;
}

/** The pharmacies to ask in a round, nearest first. Never someone already asked. */
export function pharmaciesForRound(
  round: number,
  patientPoint: Position,
  pharmacies: CandidatePharmacy[],
  alreadyAsked: ReadonlySet<string>,
  maxKm: number | null,
): string[] {
  return pharmacies
    .filter((p) => p.online && p.point && !alreadyAsked.has(p.id))
    .map((p) => ({ p, km: distanceKm(patientPoint, p.point!) }))
    .filter(({ km }) => reaches(round, km, maxKm))
    .sort((a, b) => a.km - b.km)
    .map(({ p }) => p.id);
}

/** The last round a request can reach: 3, or 4 once the patient chose collection. */
export const lastRound = (r: Pick<PrescriptionRequest, "collectionOnly">) => (r.collectionOnly ? COLLECTION_ROUND : MAX_ROUNDS);

/** Is a pharmacy's portal open? */
export const isOnline = (lastSeenAt: Date | null, now: Date) =>
  !!lastSeenAt && now.getTime() - lastSeenAt.getTime() <= ONLINE_WINDOW_MS;

/** When the current round ends, for the patient's countdown. */
export const roundEndsAt = (r: Pick<PrescriptionRequest, "status" | "roundStartedAt">) =>
  r.status === "searching" && r.roundStartedAt ? new Date(r.roundStartedAt.getTime() + ROUND_MS) : null;

// ── Presence ─────────────────────────────────────────────────────────────────

const lastWrite = new Map<string, number>();
/** Record that a pharmacy's portal is open. Writes at most every 30 seconds. */
export async function touchPharmacy(pharmacyId: string, now = Date.now()): Promise<void> {
  if (now - (lastWrite.get(pharmacyId) ?? 0) < 30_000) return;
  lastWrite.set(pharmacyId, now);
  await db.update(pharmaciesTable).set({ lastSeenAt: new Date(now) }).where(eq(pharmaciesTable.id, pharmacyId));
}

// ── Locating the patient ─────────────────────────────────────────────────────

const pharmacyPoint = (p: { latitude: string | null; longitude: string | null; locationLat: string | null; locationLng: string | null }): Position | null => {
  const lat = Number(p.latitude ?? p.locationLat), lng = Number(p.longitude ?? p.locationLng);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? [lng, lat] : null;
};

export { locate } from "./delivery/area.js";

// ── Rounds ───────────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type RoundResult = { notified: string[]; expired: boolean; offerWider?: boolean };

/**
 * Start the next round that has someone to ask. When the delivery rounds are
 * used up, offer the patient pharmacies further away, or expire the request.
 * Call inside a transaction holding the request row.
 */
async function openNextRound(tx: Tx, request: PrescriptionRequest, now: Date): Promise<RoundResult> {
  const asked = new Set(
    (await tx.select({ id: prescriptionRequestOffersTable.pharmacyId }).from(prescriptionRequestOffersTable)
      .where(eq(prescriptionRequestOffersTable.requestId, request.id))).map((r) => r.id),
  );
  if (request.acceptedPharmacyId) asked.add(request.acceptedPharmacyId);
  const rows = await tx.select().from(pharmaciesTable).where(eq(pharmaciesTable.isActive, true));
  const { current } = await loadPricing(now, tx);
  const candidates: CandidatePharmacy[] = rows.map((p) => ({ id: p.id, point: pharmacyPoint(p), online: isOnline(p.lastSeenAt, now) }));
  const patientPoint: Position = [request.longitude, request.latitude];
  const last = lastRound(request);
  for (let round = request.round + 1; round <= last; round++) {
    const ids = pharmaciesForRound(round, patientPoint, candidates, asked, current.maxKm);
    if (ids.length === 0) continue;
    await tx.insert(prescriptionRequestOffersTable).values(ids.map((pharmacyId) => ({ requestId: request.id, pharmacyId, round, notifiedAt: now })));
    await tx.update(prescriptionRequestsTable)
      .set({ status: "searching", round, roundStartedAt: now, acceptedPharmacyId: null, acceptedAt: null, updatedAt: now })
      .where(eq(prescriptionRequestsTable.id, request.id));
    return { notified: ids, expired: false };
  }
  // No one new to ask. While a pharmacy already asked has not said no, keep
  // the request open for another round rather than ending the patient's wait
  // early; pharmacies that come online meanwhile are asked on the next tick.
  if (request.round < last) {
    const [waiting] = await tx.select({ id: prescriptionRequestOffersTable.pharmacyId }).from(prescriptionRequestOffersTable)
      .where(and(eq(prescriptionRequestOffersTable.requestId, request.id), isNull(prescriptionRequestOffersTable.declinedAt))).limit(1);
    if (waiting) {
      await tx.update(prescriptionRequestsTable)
        .set({ status: "searching", round: request.round + 1, roundStartedAt: now, acceptedPharmacyId: null, acceptedAt: null, updatedAt: now })
        .where(eq(prescriptionRequestsTable.id, request.id));
      return { notified: [], expired: false };
    }
  }
  // Nobody within delivery range took it. If pharmacies further away are
  // open, let the patient decide whether to try them and collect.
  if (!request.collectionOnly && pharmaciesForRound(COLLECTION_ROUND, patientPoint, candidates, asked, current.maxKm).length > 0) {
    await tx.update(prescriptionRequestsTable)
      .set({ status: "out_of_range", round: MAX_ROUNDS, roundStartedAt: null, acceptedPharmacyId: null, acceptedAt: null, updatedAt: now })
      .where(eq(prescriptionRequestsTable.id, request.id));
    return { notified: [], expired: false, offerWider: true };
  }
  await tx.update(prescriptionRequestsTable)
    .set({ status: "expired", round: last, roundStartedAt: null, acceptedPharmacyId: null, endedAt: now, updatedAt: now })
    .where(eq(prescriptionRequestsTable.id, request.id));
  return { notified: [], expired: true };
}

async function announce(request: PrescriptionRequest, result: RoundResult) {
  for (const pharmacyId of result.notified) {
    void createPharmacyNotification({
      pharmacyId,
      title: request.collectionOnly ? "New prescription request · collection" : "New prescription request",
      body: request.collectionOnly
        ? `A patient in ${request.areaName ?? "another area"} sent a prescription. They are too far for delivery and will collect from you. Accept it in Prescription requests if you can fill it.`
        : `A patient in ${request.areaName ?? "your area"} sent a prescription. Accept it in Prescription requests if you can fill it.`,
      type: "prescription_request",
      referenceId: request.id,
    });
  }
  if (result.offerWider) {
    await notifyPatient(request, "No pharmacy within delivery range took your prescription",
      "Pharmacies further away can be asked, but you would collect from them yourself. Open your prescription in MobiCare to choose.");
  }
  if (result.expired) {
    await notifyPatient(request, "No pharmacy could take your prescription",
      "No pharmacy near you could take your prescription right now. You can send it again, or search for the medicine by name.");
    await deleteImages(request.id);
  }
}

async function notifyPatient(request: Pick<PrescriptionRequest, "id" | "patientId">, title: string, body: string) {
  const [patient] = await db.select({ phone: patientsTable.phone }).from(patientsTable).where(eq(patientsTable.id, request.patientId)).limit(1);
  if (!patient) return;
  await createPatientNotification({ patientId: request.patientId, patientPhone: patient.phone, title, body, type: "prescription_request", referenceId: request.id });
}

/** Start a new request's first round (or expire it if nobody is online). */
export async function startRequest(requestId: string, now = new Date()): Promise<PrescriptionRequest> {
  const outcome = await db.transaction(async (tx) => {
    const [request] = await tx.select().from(prescriptionRequestsTable).where(eq(prescriptionRequestsTable.id, requestId)).for("update");
    const result = await openNextRound(tx, request!, now);
    return { request: request!, result };
  });
  await announce(outcome.request, outcome.result);
  const [fresh] = await db.select().from(prescriptionRequestsTable).where(eq(prescriptionRequestsTable.id, requestId));
  return fresh!;
}

/**
 * The patient chose to ask pharmacies beyond delivery range, and collect.
 * Returns null when the request is no longer waiting for that choice.
 */
export async function askFurtherAway(requestId: string, patientId: string, now = new Date()): Promise<PrescriptionRequest | null> {
  const outcome = await db.transaction(async (tx) => {
    const [request] = await tx.select().from(prescriptionRequestsTable)
      .where(and(eq(prescriptionRequestsTable.id, requestId), eq(prescriptionRequestsTable.patientId, patientId))).for("update");
    if (!request || request.status !== "out_of_range") return null;
    await tx.update(prescriptionRequestsTable).set({ collectionOnly: true, updatedAt: now }).where(eq(prescriptionRequestsTable.id, requestId));
    const widened = { ...request, collectionOnly: true, round: MAX_ROUNDS };
    return { request: widened, result: await openNextRound(tx, widened, now) };
  });
  if (!outcome) return null;
  await announce(outcome.request, outcome.result);
  const [fresh] = await db.select().from(prescriptionRequestsTable).where(eq(prescriptionRequestsTable.id, requestId));
  return fresh!;
}

/** After a pharmacy declines: if everyone asked this round has said no, move on now. */
export async function afterDecline(requestId: string, now = new Date()): Promise<void> {
  const outcome = await db.transaction(async (tx) => {
    const [request] = await tx.select().from(prescriptionRequestsTable).where(eq(prescriptionRequestsTable.id, requestId)).for("update");
    if (!request || request.status !== "searching") return null;
    const open = await tx.select({ n: sql<number>`count(*)::int` }).from(prescriptionRequestOffersTable)
      .where(and(eq(prescriptionRequestOffersTable.requestId, requestId), eq(prescriptionRequestOffersTable.round, request.round), isNull(prescriptionRequestOffersTable.declinedAt)));
    if ((open[0]?.n ?? 0) > 0) return null;
    return { request, result: await openNextRound(tx, request, now) };
  });
  if (outcome) await announce(outcome.request, outcome.result);
}

/** Delete a finished request's photos, unless the original became an order's prescription. */
export async function deleteImages(requestId: string): Promise<void> {
  const [r] = await db.select().from(prescriptionRequestsTable).where(eq(prescriptionRequestsTable.id, requestId));
  if (!r || r.imagesDeletedAt) return;
  try {
    if (r.coveredImageKey) await deletePrescriptionFile(r.coveredImageKey);
    if (r.status !== "ordered") {
      await deletePrescriptionFile(r.imageKey);
      // The upload can no longer be attached to an order.
      await db.update(prescriptionUploadsTable).set({ consumedAt: new Date() })
        .where(and(eq(prescriptionUploadsTable.imageKey, r.imageKey), isNull(prescriptionUploadsTable.consumedAt)));
    }
    await db.update(prescriptionRequestsTable).set({ imagesDeletedAt: new Date() }).where(eq(prescriptionRequestsTable.id, requestId));
  } catch (err) {
    logger.error({ err, requestId }, "Could not delete a prescription request's photos; will retry");
  }
}

/**
 * The matching job: moves on rounds whose time is up, releases accepted
 * requests a pharmacy did not answer, and expires ready requests never ordered.
 */
export async function runPrescriptionRequestTick(now = new Date()): Promise<void> {
  const roundCutoff = new Date(now.getTime() - ROUND_MS);
  const acceptCutoff = new Date(now.getTime() - ACCEPT_HOLD_MS);
  const readyCutoff = new Date(now.getTime() - READY_HOLD_MS);
  const choiceCutoff = new Date(now.getTime() - WIDER_CHOICE_MS);
  const due = await db.select({ id: prescriptionRequestsTable.id }).from(prescriptionRequestsTable).where(
    sql`(${prescriptionRequestsTable.status} = 'searching' AND ${prescriptionRequestsTable.roundStartedAt} <= ${roundCutoff})
      OR (${prescriptionRequestsTable.status} = 'accepted' AND ${prescriptionRequestsTable.acceptedAt} <= ${acceptCutoff})
      OR (${prescriptionRequestsTable.status} = 'ready' AND ${prescriptionRequestsTable.readyAt} <= ${readyCutoff})
      OR (${prescriptionRequestsTable.status} = 'out_of_range' AND ${prescriptionRequestsTable.updatedAt} <= ${choiceCutoff})`,
  ).limit(100);
  for (const { id } of due) {
    try {
      const outcome = await db.transaction(async (tx) => {
        const [r] = await tx.select().from(prescriptionRequestsTable).where(eq(prescriptionRequestsTable.id, id)).for("update");
        if (!r) return null;
        if (r.status === "searching" && r.roundStartedAt && r.roundStartedAt <= roundCutoff) {
          return { request: r, result: await openNextRound(tx, r, now), released: null as string | null, readyExpired: false };
        }
        if (r.status === "accepted" && r.acceptedAt && r.acceptedAt <= acceptCutoff) {
          // The pharmacy went quiet: count it as a decline and ask the others.
          if (r.acceptedPharmacyId) {
            await tx.update(prescriptionRequestOffersTable).set({ declinedAt: now })
              .where(and(eq(prescriptionRequestOffersTable.requestId, r.id), eq(prescriptionRequestOffersTable.pharmacyId, r.acceptedPharmacyId)));
          }
          const reopened = { ...r, round: r.round - 1 }; // the current round's radius again, then onwards
          return { request: r, result: await openNextRound(tx, reopened, now), released: r.acceptedPharmacyId, readyExpired: false };
        }
        if (r.status === "out_of_range" && r.updatedAt <= choiceCutoff) {
          // The patient did not choose to ask further away.
          await tx.update(prescriptionRequestsTable).set({ status: "expired", endedAt: now, updatedAt: now }).where(eq(prescriptionRequestsTable.id, r.id));
          return { request: r, result: { notified: [], expired: false }, released: null, readyExpired: true };
        }
        if (r.status === "ready" && r.readyAt && r.readyAt <= readyCutoff) {
          await tx.update(prescriptionRequestsTable).set({ status: "expired", endedAt: now, updatedAt: now }).where(eq(prescriptionRequestsTable.id, r.id));
          return { request: r, result: { notified: [], expired: false }, released: null, readyExpired: true };
        }
        return null;
      });
      if (!outcome) continue;
      await announce(outcome.request, outcome.result);
      if (outcome.released) {
        void createPharmacyNotification({ pharmacyId: outcome.released, title: "Prescription request released", body: "You accepted a prescription request but did not confirm the medicines within 15 minutes, so it went to other pharmacies.", type: "prescription_request", referenceId: id });
      }
      if (outcome.readyExpired) await deleteImages(id);
    } catch (err) {
      logger.error({ err, requestId: id }, "Prescription request tick failed for one request");
    }
  }
  // Retry photo clean-up for finished requests whose deletion failed earlier.
  const leftovers = await db.select({ id: prescriptionRequestsTable.id }).from(prescriptionRequestsTable)
    .where(and(inArray(prescriptionRequestsTable.status, ["expired", "cancelled", "rejected", "ordered"]), isNull(prescriptionRequestsTable.imagesDeletedAt), lte(prescriptionRequestsTable.endedAt, new Date(now.getTime() - 60_000))))
    .limit(50);
  for (const { id } of leftovers) await deleteImages(id);
}

let timer: NodeJS.Timeout | null = null;
export function startPrescriptionRequestJobs(): void {
  const run = () => void runPrescriptionRequestTick().catch((err) => logger.error({ err }, "Prescription request job failed"));
  timer = setInterval(run, TICK_MS);
  timer.unref();
}
export function stopPrescriptionRequestJobs(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

