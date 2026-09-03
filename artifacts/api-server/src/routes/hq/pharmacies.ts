import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { pharmaciesTable, refreshTokensTable } from "@workspace/db/schema";
import { eq, and, isNull, desc, sql, or } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import {
  getOrCreatePasswordPolicy,
  generateTemporaryPassword,
  calculateTempPasswordExpiry,
  appendPasswordHistory,
} from "../../lib/passwordPolicy.js";

const router = safeRouter();

function publicPharmacy(p: typeof pharmaciesTable.$inferSelect) {
  const { passwordHash: _ph, ...rest } = p;
  return rest;
}

export function pharmacyUniqueConstraint(error: unknown): string | null {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object") return null;
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (candidate.code === "23505") {
      return typeof candidate.constraint === "string"
        ? candidate.constraint
        : "unknown";
    }
    current = candidate.cause;
  }
  return null;
}

function sendPharmacyConflict(res: Parameters<Parameters<typeof router.post>[1]>[1], constraint: string): void {
  const error = constraint.includes("phone")
    ? "That phone number is already registered to another pharmacy"
    : constraint.includes("username")
      ? "That username is already registered to another pharmacy"
      : "A pharmacy with those login details already exists";
  res.status(409).json({ error });
}

// ── GET /hq/pharmacies ────────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
  const rows = await db
    .select()
    .from(pharmaciesTable)
    .orderBy(desc(pharmaciesTable.createdAt));
  res.json(rows.map(publicPharmacy));
});

// ── POST /hq/pharmacies — onboard a pharmacy, returns one-time temp password ──
router.post("/", async (req: AuthRequest, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      username: z
        .string()
        .min(3)
        .regex(
          /^[a-z0-9_.-]+$/i,
          "username may only contain letters, numbers, and _.-",
        ),
      phone: z.string().min(5).optional(),
      address: z.string().optional(),
      mobileMoneyProvider: z.string().min(1).optional(),
      mobileMoneyNumber: z.string().min(3).optional(),
      mobileMoneyAccountName: z.string().min(1).optional(),
      locationLat: z.number().min(-90).max(90).optional(),
      locationLng: z.number().min(-180).max(180).optional(),
      isOnline: z.boolean().optional(),
    })
    .safeParse(req.body);

  if (!body.success) {
    res
      .status(400)
      .json({ error: body.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const [existing] = await db
    .select({
      username: pharmaciesTable.username,
      phone: pharmaciesTable.phone,
    })
    .from(pharmaciesTable)
    .where(
      body.data.phone
        ? or(
            eq(pharmaciesTable.username, body.data.username),
            eq(pharmaciesTable.phone, body.data.phone),
          )
        : eq(pharmaciesTable.username, body.data.username),
    )
    .limit(1);
  if (existing) {
    sendPharmacyConflict(
      res,
      existing.username === body.data.username
        ? "pharmacies_username_unique"
        : "pharmacies_phone_unique",
    );
    return;
  }

  // Load policy for temp password expiry
  const policy = await getOrCreatePasswordPolicy();

  // One-time temp password — returned ONCE in this response, stored only as a hash.
  // The plaintext exists only in local scope and the immediate HTTP response.
  const tempPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  const temporaryPasswordExpiresAt = calculateTempPasswordExpiry(policy);
  const now = new Date();

  let created: typeof pharmaciesTable.$inferSelect;
  try {
    const [inserted] = await db
      .insert(pharmaciesTable)
      .values({
        name: body.data.name,
        username: body.data.username,
        phone: body.data.phone ?? null,
        address: body.data.address ?? null,
        mobileMoneyProvider: body.data.mobileMoneyProvider ?? null,
        mobileMoneyNumber: body.data.mobileMoneyNumber ?? null,
        mobileMoneyAccountName: body.data.mobileMoneyAccountName ?? null,
        locationLat: body.data.locationLat?.toString() ?? null,
        locationLng: body.data.locationLng?.toString() ?? null,
        isOnline: body.data.isOnline ?? true,
        passwordHash,
        mustChangePassword: true,
        temporaryPasswordExpiresAt,
        passwordLastChangedAt: now,
      })
      .returning();
    created = inserted!;
  } catch (error) {
    const constraint = pharmacyUniqueConstraint(error);
    if (constraint) {
      sendPharmacyConflict(res, constraint);
      return;
    }
    throw error;
  }

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "pharmacy.onboard",
    entityType: "pharmacy",
    entityId: created.id,
    // No plaintext or hash in audit details
    details: {
      name: created.name,
      username: created.username,
      temporaryPasswordExpiresAt: temporaryPasswordExpiresAt.toISOString(),
    },
  });

  res.status(201).json({
    pharmacy: publicPharmacy(created),
    tempPassword,
    temporaryPasswordExpiresAt: temporaryPasswordExpiresAt.toISOString(),
  });
});

// ── POST /hq/pharmacies/:id/reset-password — generate new temp password ───────
router.post("/:id/reset-password", async (req: AuthRequest, res) => {
  const idResult = z.string().uuid().safeParse(req.params.id);
  if (!idResult.success) {
    res.status(400).json({ error: "Invalid pharmacy id" });
    return;
  }
  const id = idResult.data;

  const [existing] = await db
    .select()
    .from(pharmaciesTable)
    .where(eq(pharmaciesTable.id, id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Pharmacy not found" });
    return;
  }
  if (!existing.isActive) {
    res
      .status(409)
      .json({ error: "Cannot reset password for an inactive pharmacy" });
    return;
  }

  const policy = await getOrCreatePasswordPolicy();

  // Generate temp password — plaintext stays only in this scope and the response
  const tempPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  const temporaryPasswordExpiresAt = calculateTempPasswordExpiry(policy);
  const now = new Date();

  const updatedCredential = await db.transaction(async (tx) => {
    // Only the request that still owns the version it validated may replace
    // credentials. Concurrent reset/change requests receive a conflict.
    const [updated] = await tx
      .update(pharmaciesTable)
      .set({
        passwordHash,
        mustChangePassword: true,
        temporaryPasswordExpiresAt,
        passwordLastChangedAt: now,
        sessionVersion: sql`${pharmaciesTable.sessionVersion} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(pharmaciesTable.id, id),
          eq(pharmaciesTable.sessionVersion, existing.sessionVersion),
        ),
      )
      .returning({ sessionVersion: pharmaciesTable.sessionVersion });

    if (!updated) return null;

    // Preserve the user's previous real password so it cannot be reused after
    // completing the temporary-password flow. Repeated resets never add a
    // temporary hash or displace real passwords from the history window.
    if (!existing.temporaryPasswordExpiresAt) {
      await appendPasswordHistory(id, existing.passwordHash, tx);
    }

    // Revoke all active refresh tokens (invalidates all existing sessions)
    await tx
      .update(refreshTokensTable)
      .set({ revokedAt: now })
      .where(
        and(
          eq(refreshTokensTable.pharmacyId, id),
          isNull(refreshTokensTable.revokedAt),
        ),
      );

    return updated;
  });

  if (!updatedCredential) {
    res.status(409).json({
      error: "Credentials changed during this reset. Please try again.",
      code: "CREDENTIALS_CHANGED",
    });
    return;
  }

  // Audit with NO plaintext or hash
  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "pharmacy.password_reset",
    entityType: "pharmacy",
    entityId: id,
    details: {
      pharmacyName: existing.name,
      temporaryPasswordExpiresAt: temporaryPasswordExpiresAt.toISOString(),
    },
  });

  // Return the fresh pharmacy row (minus hash)
  const [updated] = await db
    .select()
    .from(pharmaciesTable)
    .where(eq(pharmaciesTable.id, id))
    .limit(1);

  res.json({
    tempPassword,
    temporaryPasswordExpiresAt: temporaryPasswordExpiresAt.toISOString(),
    pharmacy: publicPharmacy(updated!),
  });
});

// ── PATCH /hq/pharmacies/:id — licence verification / tier-1 gate / status ────
router.patch("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const body = z
    .object({
      isActive: z.boolean().optional(),
      controlledSubstanceAuthorized: z.boolean().optional(),
      name: z.string().min(1).optional(),
      phone: z.string().min(5).nullable().optional(),
      address: z.string().nullable().optional(),
      mobileMoneyProvider: z.string().min(1).nullable().optional(),
      mobileMoneyNumber: z.string().min(3).nullable().optional(),
      mobileMoneyAccountName: z.string().min(1).nullable().optional(),
      locationLat: z.number().min(-90).max(90).nullable().optional(),
      locationLng: z.number().min(-180).max(180).nullable().optional(),
      isOnline: z.boolean().optional(),
    })
    .safeParse(req.body);

  if (!body.success || Object.keys(body.data).length === 0) {
    res.status(400).json({ error: "No valid fields provided" });
    return;
  }

  const [existing] = await db
    .select()
    .from(pharmaciesTable)
    .where(eq(pharmaciesTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Pharmacy not found" });
    return;
  }

  const [updated] = await db
    .update(pharmaciesTable)
    .set({
      ...body.data,
      locationLat:
        body.data.locationLat === undefined
          ? undefined
          : body.data.locationLat?.toString() ?? null,
      locationLng:
        body.data.locationLng === undefined
          ? undefined
          : body.data.locationLng?.toString() ?? null,
      updatedAt: new Date(),
    })
    .where(eq(pharmaciesTable.id, id))
    .returning();

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "pharmacy.update",
    entityType: "pharmacy",
    entityId: id,
    details: { changes: body.data },
  });

  res.json(publicPharmacy(updated!));
});

export default router;
