import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import { prescriptionsTable, ordersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { mintImageToken } from "../../lib/signedUrl.js";
import { createPatientNotification } from "../../lib/patientNotifications.js";

const router = safeRouter();

const REJECT_REASONS = [
  "illegible_image",
  "expired_prescription",
  "invalid_prescription",
  "drug_unavailable",
  "controlled_substance_not_authorized",
  "patient_mismatch",
  "quantity_exceeded",
] as const;

// ── List prescriptions ────────────────────────────────────────────────────────
router.get("/", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const statusFilter = req.query.status as string | undefined;

  const rows = await db
    .select()
    .from(prescriptionsTable)
    .where(
      statusFilter
        ? and(
            eq(prescriptionsTable.pharmacyId, pharmacyId),
            eq(prescriptionsTable.status, statusFilter as any),
          )
        : eq(prescriptionsTable.pharmacyId, pharmacyId),
    )
    .orderBy(prescriptionsTable.createdAt);

  // Strip the raw image key — never expose it
  res.json(rows.map(({ imageKey: _k, ...r }) => r));
});

// ── Get single prescription ───────────────────────────────────────────────────
router.get("/:id", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const id = req.params.id as string;

  const [row] = await db
    .select()
    .from(prescriptionsTable)
    .where(
      and(
        eq(prescriptionsTable.id, id),
        eq(prescriptionsTable.pharmacyId, pharmacyId),
      ),
    )
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Prescription not found" });
    return;
  }
  const { imageKey: _k, ...safe } = row;
  res.json(safe);
});

// ── Mint signed image URL ─────────────────────────────────────────────────────
router.post("/:id/image-url", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const id = req.params.id as string;

  const body = z
    .object({
      variant: z.enum(["preview", "full"]).default("preview"),
    })
    .safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "variant must be 'preview' or 'full'" });
    return;
  }

  const [row] = await db
    .select({
      id: prescriptionsTable.id,
      imageKey: prescriptionsTable.imageKey,
    })
    .from(prescriptionsTable)
    .where(
      and(
        eq(prescriptionsTable.id, id),
        eq(prescriptionsTable.pharmacyId, pharmacyId),
      ),
    )
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Prescription not found" });
    return;
  }

  const { token, expiresAt } = mintImageToken(id, body.data.variant);

  // In production: exchange (imageKey, variant, token) with your encrypted object-store
  // (e.g. S3 server-side encryption + presigned URL) and return that URL instead.
  res.json({
    url: `/api/prescription-images/${id}?variant=${body.data.variant}&expires=${expiresAt}&sig=${token}`,
    expiresAt: new Date(expiresAt).toISOString(),
    note: "This URL is valid for 15 minutes. In production it resolves to an encrypted-at-rest object store.",
  });
});

// ── Approve prescription ──────────────────────────────────────────────────────
router.post("/:id/approve", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const id = req.params.id as string;

  const body = z
    .object({
      approvedDrugIds: z.array(z.string().uuid()).min(1),
    })
    .safeParse(req.body);

  if (!body.success) {
    res
      .status(400)
      .json({ error: "approvedDrugIds (non-empty array of UUIDs) required" });
    return;
  }

  const [row] = await db
    .select()
    .from(prescriptionsTable)
    .where(
      and(
        eq(prescriptionsTable.id, id),
        eq(prescriptionsTable.pharmacyId, pharmacyId),
      ),
    )
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Prescription not found" });
    return;
  }
  if (row.status !== "pending") {
    res.status(409).json({ error: `Prescription is already '${row.status}'` });
    return;
  }

  const [updated] = await db
    .update(prescriptionsTable)
    .set({
      status: "approved",
      approvedDrugIds: body.data.approvedDrugIds,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(prescriptionsTable.id, id))
    .returning();

  await writeAudit({
    actorType: "pharmacy",
    actorId: pharmacyId,
    actorName: req.pharmacy!.name,
    action: "prescription.approve",
    entityType: "prescription",
    entityId: id,
    details: { approvedDrugIds: body.data.approvedDrugIds },
  });

  const { imageKey: _k, ...safe } = updated;
  res.json(safe);
});

// ── Reject prescription ───────────────────────────────────────────────────────
router.post("/:id/reject", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const id = req.params.id as string;

  const body = z
    .object({
      reason: z.enum(REJECT_REASONS),
      note: z.string().optional(), // supplementary context, not the primary record
    })
    .safeParse(req.body);

  if (!body.success) {
    res.status(400).json({
      error: "reason must be one of the fixed enum values",
      allowedReasons: REJECT_REASONS,
      issues: body.error.issues,
    });
    return;
  }

  const [row] = await db
    .select()
    .from(prescriptionsTable)
    .where(
      and(
        eq(prescriptionsTable.id, id),
        eq(prescriptionsTable.pharmacyId, pharmacyId),
      ),
    )
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Prescription not found" });
    return;
  }
  if (row.status !== "pending") {
    res.status(409).json({ error: `Prescription is already '${row.status}'` });
    return;
  }

  const [updated] = await db
    .update(prescriptionsTable)
    .set({
      status: "rejected",
      rejectReason: body.data.reason,
      rejectNote: body.data.note ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(prescriptionsTable.id, id))
    .returning();

  await writeAudit({
    actorType: "pharmacy",
    actorId: pharmacyId,
    actorName: req.pharmacy!.name,
    action: "prescription.reject",
    entityType: "prescription",
    entityId: id,
    details: { reason: body.data.reason },
  });

  // Notify the patient about the prescription rejection — this is the most
  // actionable notification: they need to know and may need to re-upload.
  // Look up the linked order's patientId (null for legacy/HQ-created orders).
  void (async () => {
    try {
      let patientId: string | null = null;
      let orderId: string | undefined;

      if (updated.orderId) {
        const [linkedOrder] = await db
          .select({ patientId: ordersTable.patientId, id: ordersTable.id })
          .from(ordersTable)
          .where(eq(ordersTable.id, updated.orderId))
          .limit(1);
        if (linkedOrder) {
          patientId = linkedOrder.patientId ?? null;
          orderId = linkedOrder.id;
        }
      }

      if (patientId) {
        const reasonLabel = body.data.reason.replaceAll("_", " ");
        await createPatientNotification({
          patientId,
          patientPhone: updated.patientPhone,
          title: "Prescription rejected ⚠️",
          body: `Your prescription was rejected (${reasonLabel}). Please check your order for next steps or contact the pharmacy.`,
          type: "prescription_rejected",
          referenceId: orderId,
        });
      }
    } catch (err) {
      console.error("[prescriptions] rejection notification failed:", err);
    }
  })();

  const { imageKey: _k, ...safe } = updated;
  res.json(safe);
});

export default router;
