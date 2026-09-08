/**
 * A patient's control over their own data: what they agreed to, a copy of
 * everything held about them, and the right to have it erased.
 *
 * Everything here is scoped to the caller's own id. There is no route by which
 * one patient reaches another's record.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  orderItemsTable,
  ordersTable,
  patientConsentsTable,
  patientNotificationsTable,
  patientRefreshTokensTable,
  patientsTable,
  prescriptionUploadsTable,
  prescriptionsTable,
  searchEventsTable,
} from "@workspace/db";
import { safeRouter } from "../../lib/safeRouter.js";
import { writeAudit, writeAuditStrict } from "../../lib/audit.js";
import {
  CONSENT_DESCRIPTIONS,
  CONSENT_TYPES,
  CURRENT_POLICY_VERSION,
} from "../../lib/consent.js";
import { readConsentState, recordConsent } from "../../lib/patientConsent.js";
import {
  isObjectStorageConfigured,
  ObjectStorageService,
} from "../../lib/storage/objectStorage.js";
import type { AuthRequest } from "../../middlewares/auth.js";

const router = safeRouter();
const objectStorage = new ObjectStorageService();

/** Mirrors the upload path in routes/patient/uploads.ts. */
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads/prescriptions");
const LOCAL_FILENAME = /^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i;

/** Typed to erase, so the request cannot be a mis-click or a stray call. */
export const ERASURE_PHRASE = "DELETE MY ACCOUNT";

// ── Consent ──────────────────────────────────────────────────────────────────

/**
 * GET /patient/privacy
 *
 * What the patient has agreed to, and the wording of each choice. The text is
 * served alongside the state so the app cannot show one thing while the record
 * says another.
 */
router.get("/", async (req: AuthRequest, res): Promise<void> => {
  const state = await readConsentState(req.pharmacy!.sub);
  res.json({
    ...state,
    consents: CONSENT_TYPES.map((type) => ({
      type,
      ...CONSENT_DESCRIPTIONS[type],
      decision:
        type === "terms_and_privacy" ? state.termsAndPrivacy : state.researchAnalytics,
    })),
  });
});

/**
 * POST /patient/privacy/consent
 *
 * Record a decision. Both answers are explicit: there is no default, and
 * omitting the optional one is not read as agreement to it.
 */
router.post("/consent", async (req: AuthRequest, res): Promise<void> => {
  const body = z
    .object({
      termsAndPrivacy: z.boolean(),
      researchAnalytics: z.boolean(),
    })
    .safeParse(req.body);

  if (!body.success) {
    res.status(400).json({
      error: "termsAndPrivacy and researchAnalytics must both be true or false.",
    });
    return;
  }

  const patientId = req.pharmacy!.sub;
  await recordConsent(
    [
      { patientId, consentType: "terms_and_privacy", granted: body.data.termsAndPrivacy },
      { patientId, consentType: "research_analytics", granted: body.data.researchAnalytics },
    ],
    "profile",
  );

  // Recorded without the patient's name: the audit log should show that a
  // decision was made, not restate the identity it belongs to.
  await writeAudit({
    actorType: "patient",
    actorId: patientId,
    action: "patient.consent_recorded",
    entityType: "patient",
    entityId: patientId,
    details: {
      policyVersion: CURRENT_POLICY_VERSION,
      termsAndPrivacy: body.data.termsAndPrivacy,
      researchAnalytics: body.data.researchAnalytics,
    },
  });

  res.json(await readConsentState(patientId));
});

// ── Export ───────────────────────────────────────────────────────────────────

/**
 * GET /patient/privacy/export
 *
 * Everything held about the caller, as one JSON file.
 *
 * Deliberately a download rather than a page: this is the patient's copy to
 * keep, and it is the honest answer to "what do you actually have on me". If a
 * table holding patient data is added later, it belongs here too.
 */
router.get("/export", async (req: AuthRequest, res): Promise<void> => {
  const patientId = req.pharmacy!.sub;

  const [profile] = await db
    .select({
      id: patientsTable.id,
      name: patientsTable.name,
      phone: patientsTable.phone,
      email: patientsTable.email,
      address: patientsTable.address,
      dateOfBirth: patientsTable.dateOfBirth,
      age: patientsTable.age,
      nin: patientsTable.nin,
      nationality: patientsTable.nationality,
      createdAt: patientsTable.createdAt,
    })
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId))
    .limit(1);

  if (!profile) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const orders = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.patientId, patientId));
  const orderIds = orders.map((order) => order.id);

  const [items, prescriptions, uploads, notifications, searches, consents] =
    await Promise.all([
      orderIds.length
        ? db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds))
        : [],
      orderIds.length
        ? db
            .select({
              id: prescriptionsTable.id,
              status: prescriptionsTable.status,
              rejectReason: prescriptionsTable.rejectReason,
              reviewedAt: prescriptionsTable.reviewedAt,
              orderId: prescriptionsTable.orderId,
              createdAt: prescriptionsTable.createdAt,
            })
            .from(prescriptionsTable)
            .where(inArray(prescriptionsTable.orderId, orderIds))
        : [],
      db
        .select({
          id: prescriptionUploadsTable.id,
          consumedAt: prescriptionUploadsTable.consumedAt,
          createdAt: prescriptionUploadsTable.createdAt,
        })
        .from(prescriptionUploadsTable)
        .where(eq(prescriptionUploadsTable.patientId, patientId)),
      db
        .select()
        .from(patientNotificationsTable)
        .where(eq(patientNotificationsTable.patientId, patientId)),
      db.select().from(searchEventsTable).where(eq(searchEventsTable.patientId, patientId)),
      db
        .select()
        .from(patientConsentsTable)
        .where(eq(patientConsentsTable.patientId, patientId)),
    ]);

  await writeAudit({
    actorType: "patient",
    actorId: patientId,
    action: "patient.data_exported",
    entityType: "patient",
    entityId: patientId,
    details: { orders: orders.length, searchEvents: searches.length },
  });

  res
    .type("application/json")
    .attachment(`mobicare-my-data-${new Date().toISOString().slice(0, 10)}.json`)
    .send(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          notice:
            "Everything MobiCare holds about you. Image files are not included; " +
            "prescription images you uploaded are referenced by the orders below.",
          profile,
          consents,
          orders,
          orderItems: items,
          prescriptions,
          prescriptionUploads: uploads,
          notifications,
          searchEvents: searches,
        },
        null,
        2,
      ),
    );
});

// ── Erasure ──────────────────────────────────────────────────────────────────

/** Best effort, after the transaction: storage cannot roll back with the rows. */
async function deleteImage(imageKey: string): Promise<boolean> {
  try {
    if (imageKey.startsWith("cloud:")) {
      if (!isObjectStorageConfigured()) return false;
      await objectStorage.deleteObjectEntity(imageKey.slice("cloud:".length));
      return true;
    }
    if (imageKey.startsWith("local:")) {
      const filename = imageKey.slice("local:".length);
      if (!LOCAL_FILENAME.test(filename)) return false;
      await fs.rm(path.join(UPLOAD_DIR, filename), { force: true });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * POST /patient/privacy/erase   { password, confirm: "DELETE MY ACCOUNT" }
 *
 * Erases the patient's identity and everything held only for their benefit.
 *
 * What it does NOT do is delete the orders themselves. A pharmacy's record of
 * what medicine it dispensed, to an order it filled, is not the patient's alone
 * to remove — it is the pharmacy's professional record and the basis of the
 * commission it was paid. What goes is the identity attached to it: after this,
 * the order says a medicine was dispensed and no longer says to whom.
 *
 * Prescription images already attached to an order are kept for the same
 * reason. Images uploaded and never used are deleted outright — nothing has a
 * claim on those.
 *
 * The password is required because this cannot be undone and a signed-in phone
 * left on a table should not be enough to do it.
 */
router.post("/erase", async (req: AuthRequest, res): Promise<void> => {
  const body = z
    .object({ password: z.string().min(1), confirm: z.string() })
    .safeParse(req.body);

  if (!body.success || body.data.confirm !== ERASURE_PHRASE) {
    res.status(400).json({
      error: `Your password and confirm: "${ERASURE_PHRASE}" are both required.`,
    });
    return;
  }

  const patientId = req.pharmacy!.sub;
  const [patient] = await db
    .select({
      passwordHash: patientsTable.passwordHash,
      profileImageKey: patientsTable.profileImageKey,
      erasedAt: patientsTable.erasedAt,
    })
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId))
    .limit(1);

  if (!patient || patient.erasedAt) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  if (!(await bcrypt.compare(body.data.password, patient.passwordHash))) {
    res.status(403).json({ error: "That password is not correct." });
    return;
  }

  const orphanImages: string[] = [];
  if (patient.profileImageKey) orphanImages.push(patient.profileImageKey);

  const removed = await db.transaction(async (tx) => {
    // Uploads never attached to an order have no record-keeping claim on them.
    const unusedUploads = await tx
      .select({ id: prescriptionUploadsTable.id, imageKey: prescriptionUploadsTable.imageKey })
      .from(prescriptionUploadsTable)
      .where(
        and(
          eq(prescriptionUploadsTable.patientId, patientId),
          sql`${prescriptionUploadsTable.consumedAt} IS NULL`,
        ),
      );
    for (const upload of unusedUploads) orphanImages.push(upload.imageKey);

    const searches = await tx
      .delete(searchEventsTable)
      .where(eq(searchEventsTable.patientId, patientId));
    const notifications = await tx
      .delete(patientNotificationsTable)
      .where(eq(patientNotificationsTable.patientId, patientId));
    await tx
      .delete(prescriptionUploadsTable)
      .where(eq(prescriptionUploadsTable.patientId, patientId));
    // Every session ends here, not at the next token expiry.
    await tx
      .delete(patientRefreshTokensTable)
      .where(eq(patientRefreshTokensTable.patientId, patientId));

    // The order survives; the person on it does not.
    const orders = await tx
      .update(ordersTable)
      .set({
        patientName: "Erased at the patient's request",
        patientPhone: "",
        deliveryAddress: null,
        updatedAt: new Date(),
      })
      .where(eq(ordersTable.patientId, patientId))
      .returning({ id: ordersTable.id });

    if (orders.length > 0) {
      await tx
        .update(prescriptionsTable)
        .set({
          patientName: "Erased at the patient's request",
          patientPhone: "",
          updatedAt: new Date(),
        })
        .where(
          inArray(
            prescriptionsTable.orderId,
            orders.map((order) => order.id),
          ),
        );
    }

    // A final row: the account was erased, so consent to hold it ended.
    await recordConsent(
      [
        { patientId, consentType: "terms_and_privacy", granted: false },
        { patientId, consentType: "research_analytics", granted: false },
      ],
      "profile",
      tx,
    );

    // The row stays, emptied. Orders reference it, and the phone column is
    // unique and not null, so it is replaced rather than blanked.
    await tx
      .update(patientsTable)
      .set({
        name: "Erased account",
        phone: `erased:${crypto.randomUUID()}`,
        // An unusable hash, not a blank one: nothing should ever match it.
        passwordHash: `erased:${crypto.randomBytes(32).toString("hex")}`,
        email: null,
        address: null,
        nin: null,
        nationality: null,
        dateOfBirth: null,
        profileImageKey: null,
        expoPushToken: null,
        isActive: false,
        sessionVersion: sql`${patientsTable.sessionVersion} + 1`,
        erasedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(patientsTable.id, patientId));

    // Inside the transaction: if the erasure rolls back, so does the record of
    // it. The id is kept and the name is not — it points at a row that no
    // longer identifies anyone.
    await writeAuditStrict(
      {
        actorType: "patient",
        actorId: patientId,
        actorName: "Erased account",
        action: "patient.erased",
        entityType: "patient",
        entityId: patientId,
        details: {
          searchEvents: searches.rowCount ?? 0,
          notifications: notifications.rowCount ?? 0,
          ordersAnonymised: orders.length,
          unusedUploadsRemoved: unusedUploads.length,
        },
      },
      tx,
    );

    return {
      searchEvents: searches.rowCount ?? 0,
      notifications: notifications.rowCount ?? 0,
      ordersAnonymised: orders.length,
    };
  });

  let imagesDeleted = 0;
  for (const key of orphanImages) {
    if (await deleteImage(key)) imagesDeleted += 1;
  }

  res.json({
    erased: true,
    removed: { ...removed, images: imagesDeleted },
    retained:
      "Orders and any prescription attached to them are kept as the pharmacy's " +
      "dispensing record, with your name, phone number and address removed.",
  });
});

export default router;
