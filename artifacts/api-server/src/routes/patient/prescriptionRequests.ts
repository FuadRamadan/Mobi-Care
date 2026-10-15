/**
 * Prescription requests, as the patient sees them: send a photo of a
 * prescription to the pharmacies nearby, follow it, cancel it. Ordering from
 * a ready request goes through POST /patient/orders with prescriptionRequestId.
 */
import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db, prescriptionRequestsTable, prescriptionUploadsTable } from "@workspace/db";
import { AuthRequest } from "../../middlewares/auth.js";
import { isLatitude, isLongitude } from "../../lib/geo.js";
import { writeAudit } from "../../lib/audit.js";
import {
  MAX_OPEN_PER_PATIENT,
  MAX_PER_HOUR_PER_PATIENT,
  OPEN_STATUSES,
  deleteImages,
  locate,
  startRequest,
} from "../../lib/prescriptionRequests.js";
import { patientView } from "../../lib/prescriptionRequestViews.js";

const router = safeRouter();
const isId = (id: unknown) => z.string().uuid().safeParse(id).success;

// ── POST /patient/prescription-requests ─────────────────────────────────────
// { imageKey, coveredImageKey?, latitude, longitude, note? } — both photos are
// uploaded first through POST /patient/uploads/prescription.
router.post("/", async (req: AuthRequest, res) => {
  const patientId = req.pharmacy!.sub;
  const body = z.object({
    imageKey: z.string().min(1),
    coveredImageKey: z.string().min(1).optional(),
    latitude: z.number().refine(isLatitude),
    longitude: z.number().refine(isLongitude),
    note: z.string().trim().max(300).optional(),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "A photo of the prescription and your location are needed." });
    return;
  }
  const input = body.data;

  const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(prescriptionRequestsTable)
    .where(and(eq(prescriptionRequestsTable.patientId, patientId), inArray(prescriptionRequestsTable.status, [...OPEN_STATUSES])));
  const [recent] = await db.select({ n: sql<number>`count(*)::int` }).from(prescriptionRequestsTable)
    .where(and(eq(prescriptionRequestsTable.patientId, patientId), gt(prescriptionRequestsTable.createdAt, new Date(Date.now() - 3600_000))));
  if ((open?.n ?? 0) >= MAX_OPEN_PER_PATIENT || (recent?.n ?? 0) >= MAX_PER_HOUR_PER_PATIENT) {
    res.status(429).json({ error: "You already have prescriptions waiting for a pharmacy. Please wait for them, or cancel one, before sending another.", code: "TOO_MANY_REQUESTS" });
    return;
  }

  // Both photos must be this patient's own, unused uploads.
  const keys = [input.imageKey, ...(input.coveredImageKey ? [input.coveredImageKey] : [])];
  const uploads = await db.select({ imageKey: prescriptionUploadsTable.imageKey }).from(prescriptionUploadsTable)
    .where(and(eq(prescriptionUploadsTable.patientId, patientId), inArray(prescriptionUploadsTable.imageKey, keys), isNull(prescriptionUploadsTable.consumedAt)));
  if (uploads.length !== keys.length) {
    res.status(400).json({ error: "Please upload the photo again.", code: "INVALID_PRESCRIPTION_KEY" });
    return;
  }

  const { zoneId, areaName } = await locate([input.longitude, input.latitude]);
  const [created] = await db.transaction(async (tx) => {
    // The covered copy is used up now; the original stays unused until the
    // order is placed, which consumes it as any prescription upload.
    if (input.coveredImageKey) {
      await tx.update(prescriptionUploadsTable).set({ consumedAt: new Date() })
        .where(and(eq(prescriptionUploadsTable.imageKey, input.coveredImageKey), eq(prescriptionUploadsTable.patientId, patientId)));
    }
    return tx.insert(prescriptionRequestsTable).values({
      patientId,
      imageKey: input.imageKey,
      coveredImageKey: input.coveredImageKey ?? null,
      latitude: input.latitude,
      longitude: input.longitude,
      zoneId,
      areaName,
      note: input.note || null,
    }).returning();
  });
  await writeAudit({ actorType: "patient", actorId: patientId, actorName: null, action: "prescription_request.create", entityType: "prescription_request", entityId: created!.id, details: { areaName, covered: !!input.coveredImageKey } });
  const started = await startRequest(created!.id);
  res.status(201).json(await patientView(started));
});

// ── GET /patient/prescription-requests ──────────────────────────────────────
// The patient's requests from the last 7 days, newest first.
router.get("/", async (req: AuthRequest, res) => {
  const rows = await db.select().from(prescriptionRequestsTable)
    .where(and(eq(prescriptionRequestsTable.patientId, req.pharmacy!.sub), gt(prescriptionRequestsTable.createdAt, new Date(Date.now() - 7 * 24 * 3600_000))))
    .orderBy(desc(prescriptionRequestsTable.createdAt)).limit(20);
  res.json(await Promise.all(rows.map(patientView)));
});

// ── GET /patient/prescription-requests/:id ──────────────────────────────────
router.get("/:id", async (req: AuthRequest, res) => {
  if (!isId(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }
  const [r] = await db.select().from(prescriptionRequestsTable)
    .where(and(eq(prescriptionRequestsTable.id, req.params.id as string), eq(prescriptionRequestsTable.patientId, req.pharmacy!.sub))).limit(1);
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await patientView(r));
});

// ── POST /patient/prescription-requests/:id/cancel ──────────────────────────
router.post("/:id/cancel", async (req: AuthRequest, res) => {
  if (!isId(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }
  const now = new Date();
  const [r] = await db.update(prescriptionRequestsTable).set({ status: "cancelled", endedAt: now, updatedAt: now })
    .where(and(eq(prescriptionRequestsTable.id, req.params.id as string), eq(prescriptionRequestsTable.patientId, req.pharmacy!.sub), inArray(prescriptionRequestsTable.status, [...OPEN_STATUSES])))
    .returning();
  if (!r) { res.status(409).json({ error: "This request can no longer be cancelled." }); return; }
  await deleteImages(r.id);
  res.json(await patientView(r));
});

export default router;
