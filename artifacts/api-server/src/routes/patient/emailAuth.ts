import { ReplitConnectors } from "@replit/connectors-sdk";
import bcrypt from "bcryptjs";
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  patientEmailPasswordResetsTable,
  patientRefreshTokensTable,
  patientsTable,
} from "@workspace/db/schema";
import { safeRouter } from "../../lib/safeRouter.js";
import {
  emailOtpHash,
  emailRecoveryHash,
  encodePasswordResetEmail,
  normalizeRecoveryEmail,
  resetTokenHash,
} from "../../lib/patientEmailReset.js";
import {
  getOrCreatePasswordPolicy,
  serializePasswordPolicy,
  validatePasswordAgainstPolicy,
} from "../../lib/passwordPolicy.js";

const router = safeRouter();

const GENERIC_MESSAGE =
  "If an account exists with this email, a code has been sent.";
const RESEND_SECONDS = 60;
const MAX_EMAIL_REQUESTS = 3;
const MAX_IP_REQUESTS = 20;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

function otpTtlMs(): number {
  const configured = Number(process.env.PATIENT_EMAIL_OTP_TTL_SECONDS);
  // A bounded configuration avoids accidentally issuing credentials that are
  // effectively permanent while retaining the secure ten-minute default.
  const seconds =
    Number.isFinite(configured) && configured >= 60 && configured <= 30 * 60
      ? configured
      : 10 * 60;
  return seconds * 1000;
}

function hashMatches(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

router.post("/forgot-password", async (req, res): Promise<void> => {
  const body = z.object({ email: z.string().email().max(320) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "A valid email is required" });
    return;
  }

  const email = normalizeRecoveryEmail(body.data.email);
  const passwordPolicy = serializePasswordPolicy(
    await getOrCreatePasswordPolicy(),
  );
  const emailHash = emailRecoveryHash(email);
  const requesterHash = emailRecoveryHash(
    req.ip || req.socket.remoteAddress || "unknown",
  );
  const now = new Date();
  const outcome = await db.transaction(async (tx) => {
    const lockKeys = [`email:${emailHash}`, `requester:${requesterHash}`].sort();
    for (const lockKey of lockKeys) {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
    }

    const since = new Date(now.getTime() - REQUEST_WINDOW_MS);
    const [emailCountRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(patientEmailPasswordResetsTable)
      .where(
        and(
          gt(patientEmailPasswordResetsTable.createdAt, since),
          eq(patientEmailPasswordResetsTable.emailHash, emailHash),
        ),
      );
    const [requesterCountRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(patientEmailPasswordResetsTable)
      .where(
        and(
          gt(patientEmailPasswordResetsTable.createdAt, since),
          eq(patientEmailPasswordResetsTable.requesterHash, requesterHash),
        ),
      );
    const [latest] = await tx
      .select({ createdAt: patientEmailPasswordResetsTable.createdAt })
      .from(patientEmailPasswordResetsTable)
      .where(eq(patientEmailPasswordResetsTable.emailHash, emailHash))
      .orderBy(desc(patientEmailPasswordResetsTable.createdAt))
      .limit(1);
    if (
      Number(emailCountRow?.count ?? 0) >= MAX_EMAIL_REQUESTS ||
      Number(requesterCountRow?.count ?? 0) >= MAX_IP_REQUESTS
    ) {
      return { blocked: true as const, retryAfterSeconds: 15 * 60 };
    }
    if (latest && now.getTime() - latest.createdAt.getTime() < RESEND_SECONDS * 1000) {
      return {
        blocked: true as const,
        retryAfterSeconds: Math.ceil(
          (RESEND_SECONDS * 1000 - (now.getTime() - latest.createdAt.getTime())) / 1000,
        ),
      };
    }

    const [patient] = await tx
      .select()
      .from(patientsTable)
      .where(sql`lower(btrim(${patientsTable.email})) = ${email}`)
      .limit(1);
    const id = randomUUID();
    const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await tx.insert(patientEmailPasswordResetsTable).values({
      id,
      patientId: patient?.isActive ? patient.id : null,
      emailHash,
      requesterHash,
      otpHash: emailOtpHash(id, otp),
      otpExpiresAt: new Date(now.getTime() + otpTtlMs()),
    });
    return {
      blocked: false as const,
      otp,
      recipient: patient?.isActive ? email : null,
    };
  });

  if (outcome.blocked) {
    res.status(429).json({
      error: "Please wait before requesting another code.",
      retryAfterSeconds: outcome.retryAfterSeconds,
    });
    return;
  }
  if (outcome.recipient) {
    const raw = encodePasswordResetEmail(
      outcome.recipient,
      outcome.otp,
      Math.ceil(otpTtlMs() / 60_000),
    );
    // Do not await provider delivery: response timing must not disclose account existence.
    void new ReplitConnectors()
      .proxy("google-mail", "/gmail/v1/users/me/messages/send", {
        method: "POST",
        body: { raw },
      })
      .then((response) => {
        if (!response.ok) req.log.error({ statusCode: response.status }, "Password reset email delivery failed");
      })
      .catch((error: unknown) => {
        req.log.error({ err: error }, "Password reset email delivery failed");
      });
  }
  res.json({
    message: GENERIC_MESSAGE,
    retryAfterSeconds: RESEND_SECONDS,
    passwordPolicy,
  });
});

router.post("/verify-otp", async (req, res): Promise<void> => {
  const body = z
    .object({ email: z.string().email().max(320), otp: z.string().regex(/^\d{6}$/) })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Email and a six-digit code are required" });
    return;
  }
  const emailHash = emailRecoveryHash(normalizeRecoveryEmail(body.data.email));
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`email:${emailHash}`}, 0))`);
    const [record] = await tx
      .select()
      .from(patientEmailPasswordResetsTable)
      .where(eq(patientEmailPasswordResetsTable.emailHash, emailHash))
      .orderBy(desc(patientEmailPasswordResetsTable.createdAt))
      .limit(1);
    if (!record || record.otpUsedAt || record.otpExpiresAt <= now || record.attemptCount >= MAX_VERIFY_ATTEMPTS) {
      return { status: "invalid" as const };
    }
    if (!hashMatches(record.otpHash, emailOtpHash(record.id, body.data.otp))) {
      const [updated] = await tx.update(patientEmailPasswordResetsTable)
        .set({ attemptCount: sql`${patientEmailPasswordResetsTable.attemptCount} + 1` })
        .where(and(eq(patientEmailPasswordResetsTable.id, record.id), isNull(patientEmailPasswordResetsTable.otpUsedAt)))
        .returning({ attemptCount: patientEmailPasswordResetsTable.attemptCount });
      return { status: (updated?.attemptCount ?? MAX_VERIFY_ATTEMPTS) >= MAX_VERIFY_ATTEMPTS ? "locked" as const : "incorrect" as const };
    }
    if (!record.patientId) {
      await tx
        .update(patientEmailPasswordResetsTable)
        .set({ otpUsedAt: now })
        .where(
          and(
            eq(patientEmailPasswordResetsTable.id, record.id),
            isNull(patientEmailPasswordResetsTable.otpUsedAt),
          ),
        );
      return { status: "invalid" as const };
    }
    const token = randomBytes(32).toString("base64url");
    const [claimed] = await tx.update(patientEmailPasswordResetsTable)
      .set({ otpUsedAt: now, resetTokenHash: resetTokenHash(token), resetExpiresAt: new Date(now.getTime() + otpTtlMs()) })
      .where(and(eq(patientEmailPasswordResetsTable.id, record.id), isNull(patientEmailPasswordResetsTable.otpUsedAt), gt(patientEmailPasswordResetsTable.otpExpiresAt, now)))
      .returning({ id: patientEmailPasswordResetsTable.id });
    return claimed ? { status: "verified" as const, token } : { status: "invalid" as const };
  });
  if (result.status === "verified") {
    res.json({ resetToken: result.token, expiresInSeconds: Math.floor(otpTtlMs() / 1000) });
    return;
  }
  res.status(result.status === "locked" ? 429 : 400).json({
    error: result.status === "locked" ? "Too many incorrect codes. Request a new code." : "This reset code is invalid or has expired. Request a new code.",
  });
});

router.post("/reset-password", async (req, res): Promise<void> => {
  const body = z.object({ resetToken: z.string().min(32).max(512), newPassword: z.string().min(1).max(200) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "resetToken and newPassword are required" });
    return;
  }
  const tokenHash = resetTokenHash(body.data.resetToken);
  const now = new Date();
  const policy = await getOrCreatePasswordPolicy();
  const validation = validatePasswordAgainstPolicy(body.data.newPassword, policy);
  if (!validation.valid) {
    res.status(422).json({ error: "Password does not meet policy requirements", messages: validation.messages });
    return;
  }
  const passwordHash = await bcrypt.hash(body.data.newPassword, 12);
  const completed = await db.transaction(async (tx) => {
    const [reset] = await tx.select().from(patientEmailPasswordResetsTable)
      .where(and(eq(patientEmailPasswordResetsTable.resetTokenHash, tokenHash), isNull(patientEmailPasswordResetsTable.resetUsedAt), gt(patientEmailPasswordResetsTable.resetExpiresAt, now))).limit(1);
    if (!reset?.patientId) return false;
    await tx.execute(sql`SELECT id FROM patients WHERE id = ${reset.patientId} FOR UPDATE`);
    const [patient] = await tx.select().from(patientsTable).where(eq(patientsTable.id, reset.patientId)).limit(1);
    if (!patient || !patient.isActive || await bcrypt.compare(body.data.newPassword, patient.passwordHash)) return false;
    const [claimed] = await tx.update(patientEmailPasswordResetsTable).set({ resetUsedAt: now })
      .where(and(eq(patientEmailPasswordResetsTable.id, reset.id), isNull(patientEmailPasswordResetsTable.resetUsedAt), gt(patientEmailPasswordResetsTable.resetExpiresAt, now))).returning({ id: patientEmailPasswordResetsTable.id });
    if (!claimed) return false;
    await tx.update(patientsTable).set({ passwordHash, sessionVersion: sql`${patientsTable.sessionVersion} + 1`, updatedAt: now }).where(eq(patientsTable.id, patient.id));
    await tx.update(patientRefreshTokensTable).set({ revokedAt: now }).where(and(eq(patientRefreshTokensTable.patientId, patient.id), isNull(patientRefreshTokensTable.revokedAt)));
    return true;
  });
  if (!completed) {
    res.status(400).json({ error: "This reset token is invalid, expired, or has already been used." });
    return;
  }
  res.json({ message: "Password reset successfully. Sign in with your new password." });
});

export default router;