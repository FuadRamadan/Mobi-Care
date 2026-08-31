import { safeRouter } from "../lib/safeRouter.js";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  createHash,
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { db } from "@workspace/db";
import {
  pharmaciesTable,
  refreshTokensTable,
  hqStaffTable,
  hqRefreshTokensTable,
  patientsTable,
  patientRefreshTokensTable,
  patientPasswordResetCodesTable,
} from "@workspace/db/schema";
import { eq, and, isNull, gt, sql, desc, or } from "drizzle-orm";
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
} from "../lib/jwt.js";
import { requireAuth, AuthRequest } from "../middlewares/auth.js";
import {
  getOrCreatePasswordPolicy,
  validatePasswordAgainstPolicy,
  isPasswordReused,
  appendPasswordHistory,
  serializePasswordPolicy,
} from "../lib/passwordPolicy.js";
import { sendSms } from "../lib/sms.js";

const router = safeRouter();
const RESET_TTL_MS = 10 * 60 * 1000;
const RESET_RESEND_SECONDS = 60;
const RESET_MAX_ATTEMPTS = 5;
const RESET_MAX_PHONE_REQUESTS_PER_HOUR = 3;
const RESET_MAX_REQUESTER_REQUESTS_PER_HOUR = 20;
const RESET_MESSAGE =
  "If that phone number belongs to an active patient account, a verification code has been sent.";

function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const prefix = trimmed.startsWith("+") ? "+" : "";
  return prefix + trimmed.replace(/\D/g, "");
}

function recoveryHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function recoveryCodeHash(requestId: string, code: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required");
  return createHmac("sha256", secret).update(`${requestId}:${code}`).digest("hex");
}

function hashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Login ─────────────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const body = z
    .object({ refreshToken: z.string().min(1) })
    .safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "identifier and password are required" });
    return;
  }

  const { identifier, password } = body.data;

  // ── Pharmacy account? ──
  const [byUsername] = await db
    .select()
    .from(pharmaciesTable)
    .where(eq(pharmaciesTable.username, identifier))
    .limit(1);

  const pharmacy =
    byUsername ??
    (
      await db
        .select()
        .from(pharmaciesTable)
        .where(eq(pharmaciesTable.phone, identifier))
        .limit(1)
    )[0];

  if (pharmacy && pharmacy.isActive) {
  const valid = await bcrypt.compare(
    body.data.currentPassword,
    record.passwordHash,
  );
    if (valid) {
      // Check if temporary password has expired
      if (
        pharmacy.temporaryPasswordExpiresAt &&
        pharmacy.mustChangePassword &&
        new Date() > pharmacy.temporaryPasswordExpiresAt
      ) {
        res.status(401).json({
          error:
            "Temporary password has expired. Please contact HQ for a new password reset.",
          code: "TEMPORARY_PASSWORD_EXPIRED",
        });
        return;
      }

      // Check if normal password has exceeded max age
  const policy = await getOrCreatePasswordPolicy();
    const passwordPolicy = serializePasswordPolicy(policy);
  const passwordAgeDays =
    (Date.now() - record.passwordLastChangedAt.getTime()) /
    (1000 * 60 * 60 * 24);
    const isExpiredByAge =
      !pharmacy.mustChangePassword &&
      passwordAgeDays > policy.maxPasswordAgeDays;

    let mustChangePassword = pharmacy.mustChangePassword;
      if (isExpiredByAge) {
        mustChangePassword = true;
        await db
          .update(pharmaciesTable)
          .set({ mustChangePassword: true, updatedAt: new Date() })
          .where(eq(pharmaciesTable.id, pharmacy.id));
      }

  const { raw, hash } = generateRefreshToken();
  await db.insert(patientRefreshTokensTable).values({
    patientId: created.id,
    tokenHash: hash,
    expiresAt: refreshTokenExpiresAt(),
  });

  const accessToken = signAccessToken({
    sub: record.id,
    role: "pharmacy",
    name: record.name,
    // mustChangePassword is now false — omit it
    sessionVersion: updatedCredential.sessionVersion,
    passwordLastChangedAt: now.toISOString(),
    passwordPolicy: serializePasswordPolicy(policy),
  });
      res.json({
        accessToken,
        refreshToken: raw,
        user: {
          id: pharmacy.id,
          role: "pharmacy",
          name: pharmacy.name,
          username: pharmacy.username,
          phone: pharmacy.phone,
          controlledSubstanceAuthorized: pharmacy.controlledSubstanceAuthorized,
          mustChangePassword,
          passwordLastChangedAt: pharmacy.passwordLastChangedAt.toISOString(),
        },
        passwordPolicy,
      });
      return;
    }
  }

  // ── HQ staff account? ──
  const [hqByUsername] = await db
    .select()
    .from(hqStaffTable)
    .where(eq(hqStaffTable.username, identifier))
    .limit(1);

  const staff =
    hqByUsername ??
    (
      await db
        .select()
        .from(hqStaffTable)
        .where(eq(hqStaffTable.phone, identifier))
        .limit(1)
    )[0];

  if (staff && staff.isActive) {
  const valid = await bcrypt.compare(
    body.data.currentPassword,
    record.passwordHash,
  );
    if (valid) {
  const { raw, hash } = generateRefreshToken();
  await db.insert(patientRefreshTokensTable).values({
    patientId: created.id,
    tokenHash: hash,
    expiresAt: refreshTokenExpiresAt(),
  });

  const accessToken = signAccessToken({
    sub: record.id,
    role: "pharmacy",
    name: record.name,
    // mustChangePassword is now false — omit it
    sessionVersion: updatedCredential.sessionVersion,
    passwordLastChangedAt: now.toISOString(),
    passwordPolicy: serializePasswordPolicy(policy),
  });
      res.json({
        accessToken,
        refreshToken: raw,
        user: {
          id: staff.id,
          role: "hq",
          name: staff.name,
          username: staff.username,
          phone: staff.phone,
           canManageIntegrations: staff.canManageIntegrations,
        },
      });
      return;
    }
  }

  // ── Patient account? (phone is the login identifier) ──
  const [patientAcc] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.phone, identifier))
    .limit(1);

  if (patientAcc && patientAcc.isActive) {
  const valid = await bcrypt.compare(
    body.data.currentPassword,
    record.passwordHash,
  );
    if (valid) {
  const { raw, hash } = generateRefreshToken();
  await db.insert(patientRefreshTokensTable).values({
    patientId: created.id,
    tokenHash: hash,
    expiresAt: refreshTokenExpiresAt(),
  });

  const accessToken = signAccessToken({
    sub: record.id,
    role: "pharmacy",
    name: record.name,
    // mustChangePassword is now false — omit it
    sessionVersion: updatedCredential.sessionVersion,
    passwordLastChangedAt: now.toISOString(),
    passwordPolicy: serializePasswordPolicy(policy),
  });

  res.json({
    accessToken,
    refreshToken: raw,
    user: {
      id: record.id,
      role: "pharmacy",
      name: record.name,
      username: record.username,
      phone: record.phone,
      controlledSubstanceAuthorized: record.controlledSubstanceAuthorized,
      mustChangePassword: false,
      passwordLastChangedAt: now.toISOString(),
    },
    passwordPolicy: serializePasswordPolicy(policy),
    message: "Password changed successfully",
  });
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post("/logout", async (req, res) => {
  const body = z
    .object({ refreshToken: z.string().min(1) })
    .safeParse(req.body);

  if (!body.success) {
    res
      .status(400)
      .json({
        error:
          "name (min 2), phone (min 5) and password (min 8 chars) are required",
      });
    return;
  }

  const [existing] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(eq(patientsTable.phone, body.data.phone))
    .limit(1);
  if (existing) {
    res
      .status(409)
      .json({ error: "An account with this phone number already exists" });
    return;
  }

    const passwordHash = await bcrypt.hash(body.data.newPassword, 12);
  const [created] = await db
    .insert(patientsTable)
    .values({ name: body.data.name, phone: body.data.phone, passwordHash })
    .onConflictDoNothing({ target: patientsTable.phone })
    .returning();
  if (!created) {
    res
      .status(409)
      .json({ error: "An account with this phone number already exists" });
    return;
  }

  const { raw, hash } = generateRefreshToken();
  await db.insert(patientRefreshTokensTable).values({
    patientId: created.id,
    tokenHash: hash,
    expiresAt: refreshTokenExpiresAt(),
  });

  const accessToken = signAccessToken({
    sub: record.id,
    role: "pharmacy",
    name: record.name,
    // mustChangePassword is now false — omit it
    sessionVersion: updatedCredential.sessionVersion,
    passwordLastChangedAt: now.toISOString(),
    passwordPolicy: serializePasswordPolicy(policy),
  });

  res.json({
    accessToken,
    refreshToken: raw,
    user: {
      id: record.id,
      role: "pharmacy",
      name: record.name,
      username: record.username,
      phone: record.phone,
      controlledSubstanceAuthorized: record.controlledSubstanceAuthorized,
      mustChangePassword: false,
      passwordLastChangedAt: now.toISOString(),
    },
    passwordPolicy: serializePasswordPolicy(policy),
    message: "Password changed successfully",
  });
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post("/logout", async (req, res) => {
  const body = z
    .object({ refreshToken: z.string().min(1) })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "A valid phone number is required" });
    return;
  }

  const phone = normalizePhone(body.data.phone);
  if (phone.replace(/\D/g, "").length < 5) {
    res.status(400).json({ error: "A valid phone number is required" });
    return;
  }

  const phoneHash = recoveryHash(phone);
  const requesterHash = recoveryHash(req.ip || req.socket.remoteAddress || "unknown");
  const outcome = await db.transaction(async (tx) => {
    // Serialize each phone and requester bucket so concurrent requests cannot
    // all pass the same pre-insert rate-limit check.
    const lockKeys = [`phone:${phoneHash}`, `requester:${requesterHash}`].sort();
    for (const lockKey of lockKeys) {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await tx
      .select({
        phoneHash: patientPasswordResetCodesTable.phoneHash,
        requesterHash: patientPasswordResetCodesTable.requesterHash,
        createdAt: patientPasswordResetCodesTable.createdAt,
      })
      .from(patientPasswordResetCodesTable)
      .where(
        and(
          gt(patientPasswordResetCodesTable.createdAt, oneHourAgo),
          or(
            eq(patientPasswordResetCodesTable.phoneHash, phoneHash),
            eq(patientPasswordResetCodesTable.requesterHash, requesterHash),
          ),
        ),
      )
      .orderBy(desc(patientPasswordResetCodesTable.createdAt))
      .limit(
        RESET_MAX_PHONE_REQUESTS_PER_HOUR +
          RESET_MAX_REQUESTER_REQUESTS_PER_HOUR +
          1,
      );
    const phoneRequests = recent.filter((row) => row.phoneHash === phoneHash);
    const requesterRequests = recent.filter(
      (row) => row.requesterHash === requesterHash,
    );
    const latest = phoneRequests[0];
    if (
      phoneRequests.length >= RESET_MAX_PHONE_REQUESTS_PER_HOUR ||
      requesterRequests.length >= RESET_MAX_REQUESTER_REQUESTS_PER_HOUR
    ) {
      return { blocked: true as const, retryAfterSeconds: 3600 };
    }
    if (
      latest &&
      Date.now() - latest.createdAt.getTime() < RESET_RESEND_SECONDS * 1000
    ) {
      return {
        blocked: true as const,
        retryAfterSeconds: Math.ceil(
          (RESET_RESEND_SECONDS * 1000 -
            (Date.now() - latest.createdAt.getTime())) /
            1000,
        ),
      };
    }

    const [patient] = await tx
      .select()
      .from(patientsTable)
      .where(
        sql`regexp_replace(${patientsTable.phone}, '[^0-9+]', '', 'g') = ${phone}`,
      )
      .limit(1);
    const requestId = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await tx.insert(patientPasswordResetCodesTable).values({
      id: requestId,
      patientId: patient?.isActive ? patient.id : null,
      phoneHash,
      requesterHash,
      codeHash: recoveryCodeHash(requestId, code),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    });
    return {
      blocked: false as const,
      requestId,
      code,
      patientPhone: patient?.isActive ? patient.phone : null,
    };
  });

      const code =
        error instanceof Error && "code" in error
          ? String(error.code)
          : "SMS_UNKNOWN_ERROR";
  const body = z
    .object({ refreshToken: z.string().min(1) })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Request, six-digit code, and new password are required" });
    return;
  }

  const [record] = await db
    .select()
    .from(pharmaciesTable)
    .where(eq(pharmaciesTable.id, accountId))
    .limit(1);
  const now = new Date();
  const unusable =
    !record ||
    !record.patientId ||
    !!record.usedAt ||
    record.expiresAt <= now ||
    record.attemptCount >= RESET_MAX_ATTEMPTS;
  if (unusable) {
    res.status(400).json({ error: "This reset code is invalid or has expired. Request a new code." });
    return;
  }

  const suppliedHash = recoveryCodeHash(record.id, body.data.code);
  if (!hashesMatch(record.codeHash, suppliedHash)) {
    const [updated] = await db
      .update(patientPasswordResetCodesTable)
      .set({ attemptCount: sql`${patientPasswordResetCodesTable.attemptCount} + 1` })
      .where(
        and(
          eq(patientPasswordResetCodesTable.id, record.id),
          isNull(patientPasswordResetCodesTable.usedAt),
          sql`${patientPasswordResetCodesTable.attemptCount} < ${RESET_MAX_ATTEMPTS}`,
        ),
      )
      .returning({ attemptCount: patientPasswordResetCodesTable.attemptCount });
    if ((updated?.attemptCount ?? RESET_MAX_ATTEMPTS) >= RESET_MAX_ATTEMPTS) {
      res.status(429).json({ error: "Too many incorrect codes. Request a new code." });
      return;
    }
    res.status(400).json({ error: "The verification code is incorrect." });
    return;
  }

    const passwordHash = await bcrypt.hash(body.data.newPassword, 12);
  const completed = await db.transaction(async (tx) => {
    // Serialize credential replacement with patient refresh rotation.
    await tx.execute(
      sql`SELECT id FROM patients WHERE id = ${record.patientId} FOR UPDATE`,
    );
    const [claimed] = await tx
      .update(patientPasswordResetCodesTable)
      .set({ usedAt: now })
      .where(
        and(
          eq(patientPasswordResetCodesTable.id, record.id),
          isNull(patientPasswordResetCodesTable.usedAt),
          gt(patientPasswordResetCodesTable.expiresAt, now),
          sql`${patientPasswordResetCodesTable.attemptCount} < ${RESET_MAX_ATTEMPTS}`,
        ),
      )
      .returning({ patientId: patientPasswordResetCodesTable.patientId });
    if (!claimed?.patientId) return false;

    await tx
      .update(patientsTable)
      .set({
        passwordHash,
        sessionVersion: sql`${patientsTable.sessionVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(patientsTable.id, claimed.patientId));
    await tx
      .update(patientRefreshTokensTable)
      .set({ revokedAt: now })
      .where(
        and(
          eq(patientRefreshTokensTable.patientId, claimed.patientId),
          isNull(patientRefreshTokensTable.revokedAt),
        ),
      );
    await tx
      .update(patientPasswordResetCodesTable)
      .set({ usedAt: now })
      .where(
        and(
          eq(patientPasswordResetCodesTable.patientId, claimed.patientId),
          isNull(patientPasswordResetCodesTable.usedAt),
        ),
      );
    return true;
  });

  if (!completed) {
    res.status(409).json({ error: "This reset request has already been completed." });
    return;
  }
  res.json({ message: "Password reset successfully. Sign in with your new password." });
});

// ── Refresh ───────────────────────────────────────────────────────────────────
router.post("/refresh", async (req, res) => {
  const body = z
    .object({ refreshToken: z.string().min(1) })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "refreshToken required" });
    return;
  }

  const hash = hashRefreshToken(body.data.refreshToken);
  const now = new Date();

  // ── Pharmacy token? ──
  // Atomically claim this one-time refresh credential. Concurrent requests
  // using the same raw token cannot both pass rotation.
  const [stored] = await db
    .update(refreshTokensTable)
    .set({ revokedAt: now })
    .where(
      and(
        eq(refreshTokensTable.tokenHash, hash),
        isNull(refreshTokensTable.revokedAt),
        gt(refreshTokensTable.expiresAt, now),
      ),
    )
    .returning();

  if (stored) {
    const [pharmacy] = await db
      .select()
      .from(pharmaciesTable)
      .where(eq(pharmaciesTable.id, stored.pharmacyId))
      .limit(1);

    if (!pharmacy || !pharmacy.isActive) {
      res.status(401).json({ error: "Account inactive" });
      return;
    }
    if (stored.sessionVersion !== pharmacy.sessionVersion) {
      res.status(401).json({
        error: "Session has been invalidated. Please sign in again.",
        code: "SESSION_INVALIDATED",
      });
      return;
    }
    if (
      pharmacy.mustChangePassword &&
      pharmacy.temporaryPasswordExpiresAt &&
      pharmacy.temporaryPasswordExpiresAt.getTime() <= now.getTime()
    ) {
      res.status(401).json({
        error:
          "Temporary password has expired. Please contact HQ for a new password reset.",
        code: "TEMPORARY_PASSWORD_EXPIRED",
      });
      return;
    }

    // Preserve mustChangePassword policy state from the live row
    // Check if password has exceeded max age (same logic as login)
  const policy = await getOrCreatePasswordPolicy();
    const passwordPolicy = serializePasswordPolicy(policy);
  const passwordAgeDays =
    (Date.now() - record.passwordLastChangedAt.getTime()) /
    (1000 * 60 * 60 * 24);
    const isExpiredByAge =
      !pharmacy.mustChangePassword &&
      passwordAgeDays > policy.maxPasswordAgeDays;

    let mustChangePassword = pharmacy.mustChangePassword;
    if (isExpiredByAge) {
      mustChangePassword = true;
      await db
        .update(pharmaciesTable)
        .set({ mustChangePassword: true, updatedAt: new Date() })
        .where(eq(pharmaciesTable.id, pharmacy.id));
    }

    const { raw, hash: newHash } = generateRefreshToken();
    await db.insert(hqRefreshTokensTable).values({
      hqStaffId: staff.id,
      tokenHash: newHash,
      expiresAt: refreshTokenExpiresAt(),
    });

  const accessToken = signAccessToken({
    sub: record.id,
    role: "pharmacy",
    name: record.name,
    // mustChangePassword is now false — omit it
    sessionVersion: updatedCredential.sessionVersion,
    passwordLastChangedAt: now.toISOString(),
    passwordPolicy: serializePasswordPolicy(policy),
  });
    res.json({ accessToken, refreshToken: raw });
    return;
  }

  // ── HQ token? ──
  const [hqStored] = await db
    .select()
    .from(hqRefreshTokensTable)
    .where(
      and(
        eq(hqRefreshTokensTable.tokenHash, hash),
        isNull(hqRefreshTokensTable.revokedAt),
        gt(hqRefreshTokensTable.expiresAt, now),
      ),
    )
    .limit(1);

  if (hqStored) {
    await db
      .update(hqRefreshTokensTable)
      .set({ revokedAt: now })
      .where(eq(hqRefreshTokensTable.id, hqStored.id));

    const [staff] = await db
      .select()
      .from(hqStaffTable)
      .where(eq(hqStaffTable.id, hqStored.hqStaffId))
      .limit(1);

    if (!staff || !staff.isActive) {
      res.status(401).json({ error: "Account inactive" });
      return;
    }

    const { raw, hash: newHash } = generateRefreshToken();
    await db.insert(hqRefreshTokensTable).values({
      hqStaffId: staff.id,
      tokenHash: newHash,
      expiresAt: refreshTokenExpiresAt(),
    });

  const accessToken = signAccessToken({
    sub: record.id,
    role: "pharmacy",
    name: record.name,
    // mustChangePassword is now false — omit it
    sessionVersion: updatedCredential.sessionVersion,
    passwordLastChangedAt: now.toISOString(),
    passwordPolicy: serializePasswordPolicy(policy),
  });
    res.json({ accessToken, refreshToken: raw });
    return;
  }

  // ── Patient token? ──
  const [ptCandidate] = await db
    .select()
    .from(patientRefreshTokensTable)
    .where(
      and(
        eq(patientRefreshTokensTable.tokenHash, hash),
        isNull(patientRefreshTokensTable.revokedAt),
        gt(patientRefreshTokensTable.expiresAt, now),
      ),
    )
    .limit(1);

  if (ptCandidate) {
    const refreshed = await db.transaction(async (tx) => {
      // Lock the patient first. Password reset/change takes the same lock, so
      // either the replacement token is revoked by the credential change or
      // this refresh observes that the original token was already revoked.
      await tx.execute(
        sql`SELECT id FROM patients WHERE id = ${ptCandidate.patientId} FOR UPDATE`,
      );
      const [patientAcc] = await tx
        .select()
        .from(patientsTable)
        .where(eq(patientsTable.id, ptCandidate.patientId))
        .limit(1);
      if (!patientAcc || !patientAcc.isActive) {
        return { inactive: true as const };
      }
      const [claimed] = await tx
        .update(patientRefreshTokensTable)
        .set({ revokedAt: now })
        .where(
          and(
            eq(patientRefreshTokensTable.id, ptCandidate.id),
            isNull(patientRefreshTokensTable.revokedAt),
            gt(patientRefreshTokensTable.expiresAt, now),
          ),
        )
        .returning({ id: patientRefreshTokensTable.id });
      if (!claimed) return null;

      const { raw, hash: newHash } = generateRefreshToken();
      await tx.insert(patientRefreshTokensTable).values({
        patientId: patientAcc.id,
        tokenHash: newHash,
        expiresAt: refreshTokenExpiresAt(),
      });
      const accessToken = signAccessToken({
        sub: patientAcc.id,
        role: "patient",
        name: patientAcc.name,
        sessionVersion: patientAcc.sessionVersion,
      });
      return { inactive: false as const, accessToken, refreshToken: raw };
    });

    if (refreshed?.inactive) {
      res.status(401).json({ error: "Account inactive" });
      return;
    }
    if (refreshed) {
      res.json({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
      });
      return;
    }
  }

  res.status(401).json({ error: "Invalid or expired refresh token" });
});

// ── Change Password ───────────────────────────────────────────────────────────
router.post("/change-password", requireAuth, async (req: AuthRequest, res) => {
  const body = z
    .object({ refreshToken: z.string().min(1) })
    .safeParse(req.body);

  if (!body.success) {
    res
      .status(400)
      .json({ error: "currentPassword and newPassword are required" });
    return;
  }

  const accountId = req.pharmacy!.sub;
  const role = req.pharmacy!.role;

  if (role === "hq") {
  const [record] = await db
    .select()
    .from(pharmaciesTable)
    .where(eq(pharmaciesTable.id, accountId))
    .limit(1);

    if (!record) {
      res.status(404).json({ error: "Not found" });
      return;
    }

  const valid = await bcrypt.compare(
    body.data.currentPassword,
    record.passwordHash,
  );
    if (!valid) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    const passwordHash = await bcrypt.hash(body.data.newPassword, 12);
    await db
      .update(hqStaffTable)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(hqStaffTable.id, accountId));

    await db
      .update(hqRefreshTokensTable)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(hqRefreshTokensTable.hqStaffId, accountId),
          isNull(hqRefreshTokensTable.revokedAt),
        ),
      );

    res.json({ message: "Password changed successfully" });
    return;
  }

  if (role === "patient") {
    const passwordHash = await bcrypt.hash(body.data.newPassword, 12);
    const changed = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM patients WHERE id = ${accountId} FOR UPDATE`,
      );
      const [record] = await tx
        .select()
        .from(patientsTable)
        .where(eq(patientsTable.id, accountId))
        .limit(1);
      if (!record) return "missing" as const;
      if (!(await bcrypt.compare(body.data.currentPassword, record.passwordHash))) {
        return "invalid" as const;
      }
      const now = new Date();
      await tx
        .update(patientsTable)
        .set({
          passwordHash,
          sessionVersion: sql`${patientsTable.sessionVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(patientsTable.id, accountId));
      await tx
        .update(patientRefreshTokensTable)
        .set({ revokedAt: now })
        .where(
          and(
            eq(patientRefreshTokensTable.patientId, accountId),
            isNull(patientRefreshTokensTable.revokedAt),
          ),
        );
      return "changed" as const;
    });
    if (changed === "missing") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (changed === "invalid") {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    res.json({ message: "Password changed successfully" });
    return;
  }

  // ── Pharmacy password change (full policy enforcement) ──
  const [record] = await db
    .select()
    .from(pharmaciesTable)
    .where(eq(pharmaciesTable.id, accountId))
    .limit(1);

  if (!record) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const policy = await getOrCreatePasswordPolicy();
  const passwordAgeDays =
    (Date.now() - record.passwordLastChangedAt.getTime()) /
    (1000 * 60 * 60 * 24);
  const canChangeForExpiry =
    passwordAgeDays >=
      policy.maxPasswordAgeDays -
        Math.min(policy.passwordExpiryWarningDays, policy.maxPasswordAgeDays) &&
    passwordAgeDays < policy.maxPasswordAgeDays;

  if (!record.mustChangePassword && !canChangeForExpiry) {
    res.status(403).json({
      error:
        "Password changes are available only when your password is close to expiry.",
      code: "PASSWORD_CHANGE_NOT_AVAILABLE",
    });
    return;
  }

  const valid = await bcrypt.compare(
    body.data.currentPassword,
    record.passwordHash,
  );
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  // Validate the new password against the policy loaded above.
  const { valid: policyValid, messages } = validatePasswordAgainstPolicy(
    body.data.newPassword,
    policy,
  );
  if (!policyValid) {
    res
      .status(422)
      .json({ error: "Password does not meet policy requirements", messages });
    return;
  }

  // Check history (current + recent history)
  const reused = await isPasswordReused(
    body.data.newPassword,
    record.passwordHash,
    accountId,
    policy,
  );
  if (reused) {
    res.status(422).json({
      error: `New password must differ from your current password and the last ${policy.passwordHistoryCount} previous passwords.`,
      messages: [
        `Password has been used recently. Choose a different password.`,
      ],
    });
    return;
  }

  const newPasswordHash = await bcrypt.hash(body.data.newPassword, 12);
  const now = new Date();
  // Transaction: update pharmacy, append history, revoke all refresh tokens
  const updatedCredential = await db.transaction(async (tx) => {
    // Only the request that still owns the version it validated may replace
    // credentials. Concurrent reset/change requests receive a conflict.
    const [updated] = await tx
      .update(pharmaciesTable)
      .set({
        passwordHash: newPasswordHash,
        mustChangePassword: false,
        temporaryPasswordExpiresAt: null,
        passwordLastChangedAt: now,
        sessionVersion: sql`${pharmaciesTable.sessionVersion} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(pharmaciesTable.id, accountId),
          eq(pharmaciesTable.sessionVersion, record.sessionVersion),
        ),
      )
      .returning({ sessionVersion: pharmaciesTable.sessionVersion });

    if (!updated) return null;

    // Temporary credentials are never part of the user's password history.
    // A normal or age-expired password is preserved before replacement.
    if (!record.temporaryPasswordExpiresAt) {
      await appendPasswordHistory(accountId, record.passwordHash, tx);
    }

    // Revoke all existing refresh tokens
    await tx
      .update(refreshTokensTable)
      .set({ revokedAt: now })
      .where(
        and(
          eq(refreshTokensTable.pharmacyId, accountId),
          isNull(refreshTokensTable.revokedAt),
        ),
      );

    return updated;
  });

  if (!updatedCredential) {
    res.status(409).json({
      error:
        "Credentials changed during this request. Please sign in and try again.",
      code: "CREDENTIALS_CHANGED",
    });
    return;
  }

  // Issue a fresh token pair so the frontend can continue without re-logging in
  const { raw, hash: newTokenHash } = generateRefreshToken();
  await db.insert(refreshTokensTable).values({
    pharmacyId: accountId,
    tokenHash: newTokenHash,
    sessionVersion: updatedCredential.sessionVersion,
    expiresAt: refreshTokenExpiresAt(),
  });

  const accessToken = signAccessToken({
    sub: record.id,
    role: "pharmacy",
    name: record.name,
    // mustChangePassword is now false — omit it
    sessionVersion: updatedCredential.sessionVersion,
    passwordLastChangedAt: now.toISOString(),
    passwordPolicy: serializePasswordPolicy(policy),
  });

  res.json({
    accessToken,
    refreshToken: raw,
    user: {
      id: record.id,
      role: "pharmacy",
      name: record.name,
      username: record.username,
      phone: record.phone,
      controlledSubstanceAuthorized: record.controlledSubstanceAuthorized,
      mustChangePassword: false,
      passwordLastChangedAt: now.toISOString(),
    },
    passwordPolicy: serializePasswordPolicy(policy),
    message: "Password changed successfully",
  });
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post("/logout", async (req, res) => {
  const body = z
    .object({ refreshToken: z.string().min(1) })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "refreshToken required" });
    return;
  }

  const hash = hashRefreshToken(body.data.refreshToken);
  const now = new Date();

  await db
    .update(refreshTokensTable)
    .set({ revokedAt: now })
    .where(eq(refreshTokensTable.tokenHash, hash));

  await db
    .update(hqRefreshTokensTable)
    .set({ revokedAt: now })
    .where(eq(hqRefreshTokensTable.tokenHash, hash));

  await db
    .update(patientRefreshTokensTable)
    .set({ revokedAt: now })
    .where(eq(patientRefreshTokensTable.tokenHash, hash));

  res.json({ message: "Logged out" });
});

export default router;
