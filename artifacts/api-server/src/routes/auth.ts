import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { pharmaciesTable, refreshTokensTable } from "@workspace/db/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
} from "../lib/jwt.js";
import { requireAuth, AuthRequest } from "../middlewares/auth.js";

const router = Router();

// ── Login ─────────────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const body = z.object({
    identifier: z.string().min(1), // username or phone
    password: z.string().min(1),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "identifier and password are required" });
    return;
  }

  const { identifier, password } = body.data;

  const [pharmacy] = await db
    .select()
    .from(pharmaciesTable)
    .where(
      eq(pharmaciesTable.username, identifier)
    )
    .limit(1);

  // Also try phone if username didn't match
  const record = pharmacy ?? (
    await db
      .select()
      .from(pharmaciesTable)
      .where(eq(pharmaciesTable.phone, identifier))
      .limit(1)
  )[0];

  if (!record || !record.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, record.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const { raw, hash } = generateRefreshToken();
  await db.insert(refreshTokensTable).values({
    pharmacyId: record.id,
    tokenHash: hash,
    expiresAt: refreshTokenExpiresAt(),
  });

  const accessToken = signAccessToken({ sub: record.id, role: "pharmacy", name: record.name });

  res.json({
    accessToken,
    refreshToken: raw,
    user: {
      id: record.id,
      name: record.name,
      username: record.username,
      phone: record.phone,
      controlledSubstanceAuthorized: record.controlledSubstanceAuthorized,
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

  const [stored] = await db
    .select()
    .from(refreshTokensTable)
    .where(
      and(
        eq(refreshTokensTable.tokenHash, hash),
        isNull(refreshTokensTable.revokedAt),
        gt(refreshTokensTable.expiresAt, now)
      )
    )
    .limit(1);

  if (!stored) {
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }

  // Revoke old token (rotation)
  await db
    .update(refreshTokensTable)
    .set({ revokedAt: now })
    .where(eq(refreshTokensTable.id, stored.id));

  const [pharmacy] = await db
    .select()
    .from(pharmaciesTable)
    .where(eq(pharmaciesTable.id, stored.pharmacyId))
    .limit(1);

  if (!pharmacy || !pharmacy.isActive) {
    res.status(401).json({ error: "Account inactive" });
    return;
  }

  const { raw, hash: newHash } = generateRefreshToken();
  await db.insert(refreshTokensTable).values({
    pharmacyId: pharmacy.id,
    tokenHash: newHash,
    expiresAt: refreshTokenExpiresAt(),
  });

  const accessToken = signAccessToken({ sub: pharmacy.id, role: "pharmacy", name: pharmacy.name });
  res.json({ accessToken, refreshToken: raw });
});

// ── Change Password ───────────────────────────────────────────────────────────
router.post("/change-password", requireAuth, async (req: AuthRequest, res) => {
  const body = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "currentPassword and newPassword (min 8 chars) required" });
    return;
  }

  const pharmacyId = req.pharmacy!.sub;
  const [record] = await db
    .select()
    .from(pharmaciesTable)
    .where(eq(pharmaciesTable.id, pharmacyId))
    .limit(1);

  if (!record) { res.status(404).json({ error: "Not found" }); return; }

  const valid = await bcrypt.compare(body.data.currentPassword, record.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(body.data.newPassword, 12);
  await db
    .update(pharmaciesTable)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(pharmaciesTable.id, pharmacyId));

  // Revoke all existing refresh tokens on password change
  await db
    .update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokensTable.pharmacyId, pharmacyId),
        isNull(refreshTokensTable.revokedAt)
      )
    );

  res.json({ message: "Password changed successfully" });
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post("/logout", async (req, res) => {
  const body = z.object({ refreshToken: z.string().min(1) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "refreshToken required" }); return; }

  const hash = hashRefreshToken(body.data.refreshToken);
  await db
    .update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokensTable.tokenHash, hash));

  res.json({ message: "Logged out" });
});

export default router;
