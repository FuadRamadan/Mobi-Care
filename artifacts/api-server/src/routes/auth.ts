import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import {
  pharmaciesTable,
  refreshTokensTable,
  hqStaffTable,
  hqRefreshTokensTable,
  patientsTable,
  patientRefreshTokensTable,
} from "@workspace/db/schema";
import { eq, and, isNull, gt, sql } from "drizzle-orm";
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
} from "../lib/passwordPolicy.js";

const router = Router();

// ── Login ─────────────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const body = z.object({
    identifier: z.string().min(1),
    password: z.string().min(1),
  }).safeParse(req.body);

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

  const pharmacy = byUsername ?? (
    await db
      .select()
      .from(pharmaciesTable)
      .where(eq(pharmaciesTable.phone, identifier))
      .limit(1)
  )[0];

  if (pharmacy && pharmacy.isActive) {
    const valid = await bcrypt.compare(password, pharmacy.passwordHash);
    if (valid) {
      // Check if temporary password has expired
      if (
        pharmacy.temporaryPasswordExpiresAt &&
        pharmacy.mustChangePassword &&
        new Date() > pharmacy.temporaryPasswordExpiresAt
      ) {
        res.status(401).json({
          error: "Temporary password has expired. Please contact HQ for a new password reset.",
          code: "TEMPORARY_PASSWORD_EXPIRED",
        });
        return;
      }

      // Check if normal password has exceeded max age
      const policy = await getOrCreatePasswordPolicy();
      const passwordAgeDays =
        (Date.now() - pharmacy.passwordLastChangedAt.getTime()) /
        (1000 * 60 * 60 * 24);
      const isExpiredByAge =
        !pharmacy.mustChangePassword &&
        passwordAgeDays > policy.maxPasswordAgeDays;

      // If password has exceeded max age, mark mustChangePassword
      let mustChangePassword = pharmacy.mustChangePassword;
      if (isExpiredByAge) {
        mustChangePassword = true;
        await db
          .update(pharmaciesTable)
          .set({ mustChangePassword: true, updatedAt: new Date() })
          .where(eq(pharmaciesTable.id, pharmacy.id));
      }

      const { raw, hash } = generateRefreshToken();
      await db.insert(refreshTokensTable).values({
        pharmacyId: pharmacy.id,
        tokenHash: hash,
        sessionVersion: pharmacy.sessionVersion,
        expiresAt: refreshTokenExpiresAt(),
      });

      const accessToken = signAccessToken({
        sub: pharmacy.id,
        role: "pharmacy",
        name: pharmacy.name,
        mustChangePassword: mustChangePassword || undefined,
        sessionVersion: pharmacy.sessionVersion,
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
        },
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

  const staff = hqByUsername ?? (
    await db
      .select()
      .from(hqStaffTable)
      .where(eq(hqStaffTable.phone, identifier))
      .limit(1)
  )[0];

  if (staff && staff.isActive) {
    const valid = await bcrypt.compare(password, staff.passwordHash);
    if (valid) {
      const { raw, hash } = generateRefreshToken();
      await db.insert(hqRefreshTokensTable).values({
        hqStaffId: staff.id,
        tokenHash: hash,
        expiresAt: refreshTokenExpiresAt(),
      });

      const accessToken = signAccessToken({ sub: staff.id, role: "hq", name: staff.name });
      res.json({
        accessToken,
        refreshToken: raw,
        user: {
          id: staff.id,
          role: "hq",
          name: staff.name,
          username: staff.username,
          phone: staff.phone,
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
    const valid = await bcrypt.compare(password, patientAcc.passwordHash);
    if (valid) {
      const { raw, hash } = generateRefreshToken();
      await db.insert(patientRefreshTokensTable).values({
        patientId: patientAcc.id,
        tokenHash: hash,
        expiresAt: refreshTokenExpiresAt(),
      });

      const accessToken = signAccessToken({ sub: patientAcc.id, role: "patient", name: patientAcc.name });
      res.json({
        accessToken,
        refreshToken: raw,
        user: {
          id: patientAcc.id,
          role: "patient",
          name: patientAcc.name,
          username: patientAcc.phone,
          phone: patientAcc.phone,
        },
      });
      return;
    }
  }

  res.status(401).json({ error: "Invalid credentials" });
});

// ── Patient registration ──────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    phone: z.string().min(5),
    password: z.string().min(8),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "name (min 2), phone (min 5) and password (min 8 chars) are required" });
    return;
  }

  const [existing] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(eq(patientsTable.phone, body.data.phone))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "An account with this phone number already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(body.data.password, 12);
  const [created] = await db
    .insert(patientsTable)
    .values({ name: body.data.name, phone: body.data.phone, passwordHash })
    .onConflictDoNothing({ target: patientsTable.phone })
    .returning();
  if (!created) {
    res.status(409).json({ error: "An account with this phone number already exists" });
    return;
  }

  const { raw, hash } = generateRefreshToken();
  await db.insert(patientRefreshTokensTable).values({
    patientId: created.id,
    tokenHash: hash,
    expiresAt: refreshTokenExpiresAt(),
  });

  const accessToken = signAccessToken({ sub: created.id, role: "patient", name: created.name });
  res.status(201).json({
    accessToken,
    refreshToken: raw,
    user: {
      id: created.id,
      role: "patient",
      name: created.name,
      username: created.phone,
      phone: created.phone,
    },
  });
});

// ── Refresh ───────────────────────────────────────────────────────────────────
router.post("/refresh", async (req, res) => {
  const body = z.object({ refreshToken: z.string().min(1) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "refreshToken is required" });
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
        gt(refreshTokensTable.expiresAt, now)
      )
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
        error: "Temporary password has expired. Please contact HQ for a new password reset.",
        code: "TEMPORARY_PASSWORD_EXPIRED",
      });
      return;
    }

    // Preserve mustChangePassword policy state from the live row
    // Check if password has exceeded max age (same logic as login)
    const policy = await getOrCreatePasswordPolicy();
    const passwordAgeDays =
      (Date.now() - pharmacy.passwordLastChangedAt.getTime()) /
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
    await db.insert(refreshTokensTable).values({
      pharmacyId: pharmacy.id,
      tokenHash: newHash,
      sessionVersion: pharmacy.sessionVersion,
      expiresAt: refreshTokenExpiresAt(),
    });

    const accessToken = signAccessToken({
      sub: pharmacy.id,
      role: "pharmacy",
      name: pharmacy.name,
      mustChangePassword: mustChangePassword || undefined,
      sessionVersion: pharmacy.sessionVersion,
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
        gt(hqRefreshTokensTable.expiresAt, now)
      )
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

    const accessToken = signAccessToken({ sub: staff.id, role: "hq", name: staff.name });
    res.json({ accessToken, refreshToken: raw });
    return;
  }

  // ── Patient token? ──
  const [ptStored] = await db
    .select()
    .from(patientRefreshTokensTable)
    .where(
      and(
        eq(patientRefreshTokensTable.tokenHash, hash),
        isNull(patientRefreshTokensTable.revokedAt),
        gt(patientRefreshTokensTable.expiresAt, now)
      )
    )
    .limit(1);

  if (ptStored) {
    await db
      .update(patientRefreshTokensTable)
      .set({ revokedAt: now })
      .where(eq(patientRefreshTokensTable.id, ptStored.id));

    const [patientAcc] = await db
      .select()
      .from(patientsTable)
      .where(eq(patientsTable.id, ptStored.patientId))
      .limit(1);

    if (!patientAcc || !patientAcc.isActive) {
      res.status(401).json({ error: "Account inactive" });
      return;
    }

    const { raw, hash: newHash } = generateRefreshToken();
    await db.insert(patientRefreshTokensTable).values({
      patientId: patientAcc.id,
      tokenHash: newHash,
      expiresAt: refreshTokenExpiresAt(),
    });

    const accessToken = signAccessToken({ sub: patientAcc.id, role: "patient", name: patientAcc.name });
    res.json({ accessToken, refreshToken: raw });
    return;
  }

  res.status(401).json({ error: "Invalid or expired refresh token" });
});

// ── Change Password ───────────────────────────────────────────────────────────
router.post("/change-password", requireAuth, async (req: AuthRequest, res) => {
  const body = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "currentPassword and newPassword are required" });
    return;
  }

  const accountId = req.pharmacy!.sub;
  const role = req.pharmacy!.role;

  if (role === "hq") {
    const [record] = await db
      .select()
      .from(hqStaffTable)
      .where(eq(hqStaffTable.id, accountId))
      .limit(1);

    if (!record) { res.status(404).json({ error: "Not found" }); return; }

    const valid = await bcrypt.compare(body.data.currentPassword, record.passwordHash);
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
          isNull(hqRefreshTokensTable.revokedAt)
        )
      );

    res.json({ message: "Password changed successfully" });
    return;
  }

  if (role === "patient") {
    const [record] = await db
      .select()
      .from(patientsTable)
      .where(eq(patientsTable.id, accountId))
      .limit(1);

    if (!record) { res.status(404).json({ error: "Not found" }); return; }

    const valid = await bcrypt.compare(body.data.currentPassword, record.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    const passwordHash = await bcrypt.hash(body.data.newPassword, 12);
    await db
      .update(patientsTable)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(patientsTable.id, accountId));

    await db
      .update(patientRefreshTokensTable)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(patientRefreshTokensTable.patientId, accountId),
          isNull(patientRefreshTokensTable.revokedAt)
        )
      );

    res.json({ message: "Password changed successfully" });
    return;
  }

  // ── Pharmacy password change (full policy enforcement) ──
  const [record] = await db
    .select()
    .from(pharmaciesTable)
    .where(eq(pharmaciesTable.id, accountId))
    .limit(1);

  if (!record) { res.status(404).json({ error: "Not found" }); return; }

  const valid = await bcrypt.compare(body.data.currentPassword, record.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  // Load policy and validate the new password
  const policy = await getOrCreatePasswordPolicy();
  const { valid: policyValid, messages } = validatePasswordAgainstPolicy(body.data.newPassword, policy);
  if (!policyValid) {
    res.status(422).json({ error: "Password does not meet policy requirements", messages });
    return;
  }

  // Check history (current + recent history)
  const reused = await isPasswordReused(body.data.newPassword, record.passwordHash, accountId, policy);
  if (reused) {
    res.status(422).json({
      error: `New password must differ from your current password and the last ${policy.passwordHistoryCount} previous passwords.`,
      messages: [`Password has been used recently. Choose a different password.`],
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
          isNull(refreshTokensTable.revokedAt)
        )
      );

    return updated;
  });

  if (!updatedCredential) {
    res.status(409).json({
      error: "Credentials changed during this request. Please sign in and try again.",
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
    },
    message: "Password changed successfully",
  });
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post("/logout", async (req, res) => {
  const body = z.object({ refreshToken: z.string().min(1) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "refreshToken required" }); return; }

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
