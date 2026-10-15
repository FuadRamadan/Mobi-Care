/**
 * Prescription requests, as a pharmacy sees them: open requests from patients
 * nearby (accept or decline), and the ones it accepted (confirm the medicines
 * or reject the prescription). See lib/prescriptionRequests.ts.
 */
import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  drugCatalogueTable,
  pharmaciesTable,
  pharmacyInventoryTable,
  prescriptionRequestOffersTable,
  prescriptionRequestsTable,
} from "@workspace/db";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { afterDecline, deleteImages } from "../../lib/prescriptionRequests.js";
import { acceptedView, openOfferView } from "../../lib/prescriptionRequestViews.js";
import { createPatientNotification } from "../../lib/patientNotifications.js";
import { PrescriptionFileMissing, readPrescriptionFile } from "../../lib/prescriptionFiles.js";
import { patientsTable } from "@workspace/db/schema";

const router = safeRouter();
const isId = (id: unknown) => z.string().uuid().safeParse(id).success;

const REJECT_REASONS = ["illegible_image", "expired_prescription", "invalid_prescription", "drug_unavailable", "controlled_substance_not_authorized", "patient_mismatch", "quantity_exceeded"] as const;
const REJECT_LABELS: Record<(typeof REJECT_REASONS)[number], string> = {
  illegible_image: "the photo could not be read",
  expired_prescription: "the prescription has expired",
  invalid_prescription: "the prescription is not valid",
  drug_unavailable: "the medicines are not available",
  controlled_substance_not_authorized: "it contains a controlled medicine this pharmacy cannot dispense",
  patient_mismatch: "the prescription is for someone else",
  quantity_exceeded: "the quantity is more than allowed",
};

async function myPoint(pharmacyId: string): Promise<[number, number] | null> {
  const [p] = await db.select().from(pharmaciesTable).where(eq(pharmaciesTable.id, pharmacyId)).limit(1);
  const lat = Number(p?.latitude ?? p?.locationLat), lng = Number(p?.longitude ?? p?.locationLng);
  return p && Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null;
}

// ── GET /pharmacy/prescription-requests ─────────────────────────────────────
// open: offered to this pharmacy, still searching, not declined.
// mine: accepted by this pharmacy (accepted, ready, or ordered in the last day).
router.get("/", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const offered = await db
    .select({ request: prescriptionRequestsTable })
    .from(prescriptionRequestOffersTable)
    .innerJoin(prescriptionRequestsTable, eq(prescriptionRequestsTable.id, prescriptionRequestOffersTable.requestId))
    .where(and(eq(prescriptionRequestOffersTable.pharmacyId, pharmacyId), isNull(prescriptionRequestOffersTable.declinedAt), eq(prescriptionRequestsTable.status, "searching")))
    .orderBy(desc(prescriptionRequestsTable.createdAt))
    .limit(50);
  const point = await myPoint(pharmacyId);
  const mine = await db.select().from(prescriptionRequestsTable)
    .where(and(eq(prescriptionRequestsTable.acceptedPharmacyId, pharmacyId), or(
      inArray(prescriptionRequestsTable.status, ["accepted", "ready"]),
      and(eq(prescriptionRequestsTable.status, "ordered"), gt(prescriptionRequestsTable.updatedAt, new Date(Date.now() - 24 * 3600_000))),
    )))
    .orderBy(desc(prescriptionRequestsTable.acceptedAt)).limit(50);
  res.json({
    open: offered.map(({ request }) => openOfferView(request, point)),
    mine: await Promise.all(mine.map(acceptedView)),
  });
});

// ── GET /pharmacy/prescription-requests/:id/photo ───────────────────────────
// Before accepting: the covered copy, and only for a pharmacy that was asked.
// After accepting: the original.
router.get("/:id/photo", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  if (!isId(req.params.id)) { res.status(404).json({ error: "Request not found" }); return; }
  const [r] = await db.select().from(prescriptionRequestsTable).where(eq(prescriptionRequestsTable.id, req.params.id as string)).limit(1);
  if (!r) { res.status(404).json({ error: "Request not found" }); return; }
  let key: string | null = null;
  if (r.acceptedPharmacyId === pharmacyId && (r.status === "accepted" || r.status === "ready")) {
    key = r.imageKey;
  } else if (r.status === "searching") {
    const [offer] = await db.select().from(prescriptionRequestOffersTable)
      .where(and(eq(prescriptionRequestOffersTable.requestId, r.id), eq(prescriptionRequestOffersTable.pharmacyId, pharmacyId), isNull(prescriptionRequestOffersTable.declinedAt))).limit(1);
    if (offer) key = r.coveredImageKey ?? r.imageKey;
  }
  if (!key) { res.status(404).json({ error: "This request is no longer available to your pharmacy." }); return; }
  try {
    const file = await readPrescriptionFile(key);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(file.bytes);
  } catch (error) {
    if (error instanceof PrescriptionFileMissing) { res.status(404).json({ error: "The photo is no longer available." }); return; }
    throw error;
  }
});

// ── POST /pharmacy/prescription-requests/:id/accept ─────────────────────────
// First to accept wins; everyone else sees it disappear.
router.post("/:id/accept", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  if (!isId(req.params.id)) { res.status(404).json({ error: "Request not found" }); return; }
  const id = req.params.id as string;
  const now = new Date();
  const outcome = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(prescriptionRequestsTable).where(eq(prescriptionRequestsTable.id, id)).for("update");
    if (!r) return { code: 404, error: "Request not found" } as const;
    const [offer] = await tx.select().from(prescriptionRequestOffersTable)
      .where(and(eq(prescriptionRequestOffersTable.requestId, id), eq(prescriptionRequestOffersTable.pharmacyId, pharmacyId))).limit(1);
    if (!offer || offer.declinedAt) return { code: 404, error: "This request was not sent to your pharmacy." } as const;
    if (r.status !== "searching") return { code: 409, error: "Another pharmacy has already taken this request." } as const;
    await tx.update(prescriptionRequestsTable).set({ status: "accepted", acceptedPharmacyId: pharmacyId, acceptedAt: now, updatedAt: now }).where(eq(prescriptionRequestsTable.id, id));
    return { code: 200, request: { ...r, status: "accepted" as const, acceptedPharmacyId: pharmacyId, acceptedAt: now } } as const;
  });
  if (outcome.code !== 200) { res.status(outcome.code).json({ error: outcome.error }); return; }
  await writeAudit({ actorType: "pharmacy", actorId: pharmacyId, actorName: req.pharmacy!.name, action: "prescription_request.accept", entityType: "prescription_request", entityId: id, details: {} });
  const [patient] = await db.select({ phone: patientsTable.phone }).from(patientsTable).where(eq(patientsTable.id, outcome.request.patientId)).limit(1);
  if (patient) {
    void createPatientNotification({ patientId: outcome.request.patientId, patientPhone: patient.phone, title: "A pharmacy took your prescription", body: `${req.pharmacy!.name} is checking your prescription now. We'll tell you when the medicines are ready to order.`, type: "prescription_request", referenceId: id });
  }
  res.json(await acceptedView(outcome.request));
});

// ── POST /pharmacy/prescription-requests/:id/decline ────────────────────────
router.post("/:id/decline", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  if (!isId(req.params.id)) { res.status(404).json({ error: "Request not found" }); return; }
  const id = req.params.id as string;
  const updated = await db.update(prescriptionRequestOffersTable).set({ declinedAt: new Date() })
    .where(and(eq(prescriptionRequestOffersTable.requestId, id), eq(prescriptionRequestOffersTable.pharmacyId, pharmacyId), isNull(prescriptionRequestOffersTable.declinedAt)))
    .returning({ id: prescriptionRequestOffersTable.requestId });
  if (updated.length === 0) { res.status(404).json({ error: "Request not found" }); return; }
  await afterDecline(id);
  res.status(204).end();
});

// ── POST /pharmacy/prescription-requests/:id/confirm ────────────────────────
// The pharmacist chooses what it can supply from its stock, with the most the
// patient may order of each. The patient is told and can order.
router.post("/:id/confirm", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const body = z.object({ items: z.array(z.object({ inventoryId: z.string().uuid(), maxQuantity: z.number().int().min(1).max(1000) })).min(1).max(30) }).safeParse(req.body);
  if (!isId(req.params.id) || !body.success) { res.status(400).json({ error: "Choose at least one medicine from your stock." }); return; }
  const id = req.params.id as string;
  const items = body.data.items;
  if (new Set(items.map((i) => i.inventoryId)).size !== items.length) { res.status(400).json({ error: "Each medicine can be listed once." }); return; }
  const listings = await db.select({ id: pharmacyInventoryTable.id, tier: drugCatalogueTable.tier, isActive: pharmacyInventoryTable.isActive, stock: pharmacyInventoryTable.stockQuantity, name: drugCatalogueTable.name })
    .from(pharmacyInventoryTable).innerJoin(drugCatalogueTable, eq(drugCatalogueTable.id, pharmacyInventoryTable.drugId))
    .where(and(eq(pharmacyInventoryTable.pharmacyId, pharmacyId), inArray(pharmacyInventoryTable.id, items.map((i) => i.inventoryId))));
  const bad = items.find((i) => { const l = listings.find((x) => x.id === i.inventoryId); return !l || !l.isActive || l.stock <= 0; });
  if (bad) { res.status(409).json({ error: "One of the medicines is not in your active stock." }); return; }
  const [me] = await db.select({ authorised: pharmaciesTable.controlledSubstanceAuthorized, name: pharmaciesTable.name }).from(pharmaciesTable).where(eq(pharmaciesTable.id, pharmacyId)).limit(1);
  if (listings.some((l) => l.tier === "1") && !me?.authorised) { res.status(409).json({ error: "Your pharmacy is not authorised for controlled medicines." }); return; }
  const now = new Date();
  const [r] = await db.update(prescriptionRequestsTable).set({ status: "ready", items, readyAt: now, updatedAt: now })
    .where(and(eq(prescriptionRequestsTable.id, id), eq(prescriptionRequestsTable.acceptedPharmacyId, pharmacyId), eq(prescriptionRequestsTable.status, "accepted")))
    .returning();
  if (!r) { res.status(409).json({ error: "This request is no longer waiting for your confirmation." }); return; }
  await writeAudit({ actorType: "pharmacy", actorId: pharmacyId, actorName: req.pharmacy!.name, action: "prescription_request.confirm", entityType: "prescription_request", entityId: id, details: { items } });
  const [patient] = await db.select({ phone: patientsTable.phone }).from(patientsTable).where(eq(patientsTable.id, r.patientId)).limit(1);
  if (patient) {
    void createPatientNotification({ patientId: r.patientId, patientPhone: patient.phone, title: "Your medicines are ready to order", body: `${me?.name ?? "The pharmacy"} checked your prescription. Open MobiCare to choose quantities, delivery or collection, and pay.`, type: "prescription_request", referenceId: id });
  }
  res.json(await acceptedView(r));
});

// ── POST /pharmacy/prescription-requests/:id/reject ─────────────────────────
router.post("/:id/reject", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const body = z.object({ reason: z.enum(REJECT_REASONS) }).safeParse(req.body);
  if (!isId(req.params.id) || !body.success) { res.status(400).json({ error: "Choose a reason." }); return; }
  const id = req.params.id as string;
  const now = new Date();
  const [r] = await db.update(prescriptionRequestsTable).set({ status: "rejected", rejectReason: body.data.reason, endedAt: now, updatedAt: now })
    .where(and(eq(prescriptionRequestsTable.id, id), eq(prescriptionRequestsTable.acceptedPharmacyId, pharmacyId), inArray(prescriptionRequestsTable.status, ["accepted", "ready"])))
    .returning();
  if (!r) { res.status(409).json({ error: "This request is no longer yours to reject." }); return; }
  await writeAudit({ actorType: "pharmacy", actorId: pharmacyId, actorName: req.pharmacy!.name, action: "prescription_request.reject", entityType: "prescription_request", entityId: id, details: { reason: body.data.reason } });
  const [patient] = await db.select({ phone: patientsTable.phone }).from(patientsTable).where(eq(patientsTable.id, r.patientId)).limit(1);
  if (patient) {
    void createPatientNotification({ patientId: r.patientId, patientPhone: patient.phone, title: "The pharmacy could not accept your prescription", body: `${req.pharmacy!.name} could not fill your prescription: ${REJECT_LABELS[body.data.reason]}. You can send a clearer photo or a new prescription.`, type: "prescription_request", referenceId: id });
  }
  await deleteImages(id);
  res.json({ ok: true });
});

export default router;
