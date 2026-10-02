import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@workspace/db";
import { patientRefreshTokensTable, patientsTable, type Patient } from "@workspace/db/schema";
import { safeRouter } from "../lib/safeRouter.js";
import { generateRefreshToken, refreshTokenExpiresAt, signAccessToken } from "../lib/jwt.js";
import { calculatePatientAge } from "../lib/patientAge.js";
import { recordConsent } from "../lib/patientConsent.js";
import { writeAudit } from "../lib/audit.js";
import {
  GoogleSignInError,
  googleClientIds,
  signGoogleSignupToken,
  verifyGoogleCredential,
  verifyGoogleSignupToken,
} from "../lib/googleSignIn.js";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";

/**
 * Patient sign-in with Google (mounted at /auth/google).
 *
 *   GET  /config     the Client ID for the patient app's Google button
 *   POST /           sign in with a Google credential; a Google account not
 *                    yet linked to a patient gets a sign-up token instead
 *   POST /complete   finish signing up: phone, date of birth, consent
 *   POST /link       a signed-in patient connects their Google account
 *   DELETE /link     ... or disconnects it (only if they have a password)
 *
 * An existing account is never joined to a Google account by matching email
 * or phone: only a patient already signed in can connect Google, so nobody
 * can take over an account by creating a Google account with its details.
 */

const router = safeRouter();

const credentialSchema = z.object({ credential: z.string().min(20).max(5000) });

function googleProblem(error: unknown, res: Parameters<Parameters<typeof router.post>[1]>[1]): boolean {
  if (!(error instanceof GoogleSignInError)) return false;
  res.status(401).json({ error: error.message, code: "GOOGLE_SIGN_IN_FAILED" });
  return true;
}

/** A new session for a patient, in the same shape as phone + password sign-in. */
async function patientSession(patient: Patient) {
  const { raw, hash } = generateRefreshToken();
  await db.insert(patientRefreshTokensTable).values({
    patientId: patient.id,
    tokenHash: hash,
    expiresAt: refreshTokenExpiresAt(),
  });
  const accessToken = signAccessToken({
    sub: patient.id,
    role: "patient",
    name: patient.name,
    sessionVersion: patient.sessionVersion,
  });
  return {
    accessToken,
    refreshToken: raw,
    user: { id: patient.id, role: "patient", name: patient.name, username: patient.phone, phone: patient.phone },
  };
}

router.get("/config", (_req, res) => {
  // The first ID is the web app's; null hides the button.
  res.json({ clientId: googleClientIds()[0] ?? null });
});

router.post("/", async (req, res) => {
  const body = credentialSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "The Google sign-in is missing" });
    return;
  }
  try {
    const identity = await verifyGoogleCredential(body.data.credential);
    const [patient] = await db
      .select()
      .from(patientsTable)
      .where(eq(patientsTable.googleSub, identity.sub))
      .limit(1);
    if (patient) {
      if (!patient.isActive || patient.erasedAt) {
        res.status(403).json({ error: "This account is no longer active." });
        return;
      }
      res.json({ status: "signed_in", ...(await patientSession(patient)) });
      return;
    }
    // Not a MobiCare patient yet: the phone number and date of birth come next.
    res.json({
      status: "needs_profile",
      signupToken: signGoogleSignupToken(identity),
      name: identity.name,
      email: identity.email,
    });
  } catch (error) {
    if (!googleProblem(error, res)) throw error;
  }
});

router.post("/complete", async (req, res) => {
  const body = z
    .object({
      signupToken: z.string().min(20),
      name: z.string().trim().min(2).max(120),
      phone: z.string().trim().min(5).max(30),
      dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      acceptTermsAndPrivacy: z.literal(true),
      acceptResearchAnalytics: z.boolean().default(false),
    })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({
      error: "Your name, phone number, date of birth and acceptance of the terms and privacy notice are required",
    });
    return;
  }
  try {
    const identity = verifyGoogleSignupToken(body.data.signupToken);
    const age = calculatePatientAge(body.data.dateOfBirth);
    if (age === null) {
      res.status(400).json({ error: "Enter a valid date of birth" });
      return;
    }
    if (age < 18) {
      res.status(400).json({ error: "You must be 18 or older to register for MobiCare" });
      return;
    }
    const [phoneTaken] = await db
      .select({ id: patientsTable.id })
      .from(patientsTable)
      .where(eq(patientsTable.phone, body.data.phone))
      .limit(1);
    if (phoneTaken) {
      res.status(409).json({
        error:
          "This phone number already has a MobiCare account. Sign in with your phone number and password, then connect Google from your Profile.",
        code: "PHONE_ALREADY_REGISTERED",
      });
      return;
    }
    // The account has no password the patient knows: this is a hash of a
    // random value nobody holds. They can set a real one later.
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(patientsTable)
        .values({
          name: body.data.name,
          phone: body.data.phone,
          passwordHash,
          hasPassword: false,
          googleSub: identity.sub,
          email: identity.email,
          age,
          dateOfBirth: body.data.dateOfBirth,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) return null;
      await recordConsent(
        [
          { patientId: row.id, consentType: "terms_and_privacy", granted: true },
          { patientId: row.id, consentType: "research_analytics", granted: body.data.acceptResearchAnalytics },
        ],
        "registration",
        tx,
      );
      return row;
    });
    if (!created) {
      // The phone or this Google account was registered a moment ago.
      const [existing] = await db.select().from(patientsTable).where(eq(patientsTable.googleSub, identity.sub)).limit(1);
      if (existing) {
        res.json({ status: "signed_in", ...(await patientSession(existing)) });
        return;
      }
      res.status(409).json({ error: "This phone number already has a MobiCare account.", code: "PHONE_ALREADY_REGISTERED" });
      return;
    }
    res.status(201).json({ status: "signed_in", ...(await patientSession(created)) });
  } catch (error) {
    if (!googleProblem(error, res)) throw error;
  }
});

router.post("/link", requireAuth, async (req: AuthRequest, res) => {
  if (req.pharmacy!.role !== "patient") {
    res.status(403).json({ error: "Only patients can connect a Google account" });
    return;
  }
  const body = credentialSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "The Google sign-in is missing" });
    return;
  }
  try {
    const identity = await verifyGoogleCredential(body.data.credential);
    const patientId = req.pharmacy!.sub;
    const [other] = await db
      .select({ id: patientsTable.id })
      .from(patientsTable)
      .where(and(eq(patientsTable.googleSub, identity.sub), ne(patientsTable.id, patientId)))
      .limit(1);
    if (other) {
      res.status(409).json({ error: "This Google account is already connected to another MobiCare account." });
      return;
    }
    const [current] = await db.select({ email: patientsTable.email }).from(patientsTable).where(eq(patientsTable.id, patientId)).limit(1);
    const [updated] = await db
      .update(patientsTable)
      .set({ googleSub: identity.sub, email: current?.email || identity.email, updatedAt: new Date() })
      .where(eq(patientsTable.id, patientId))
      .returning({ id: patientsTable.id });
    if (!updated) {
      res.status(404).json({ error: "Patient profile not found" });
      return;
    }
    await writeAudit({
      actorType: "patient",
      actorId: patientId,
      actorName: req.pharmacy!.name,
      action: "patient.google_connected",
      entityType: "patient",
      entityId: patientId,
      details: {},
    });
    res.json({ googleConnected: true });
  } catch (error) {
    if (!googleProblem(error, res)) throw error;
  }
});

router.delete("/link", requireAuth, async (req: AuthRequest, res) => {
  if (req.pharmacy!.role !== "patient") {
    res.status(403).json({ error: "Only patients can disconnect a Google account" });
    return;
  }
  const patientId = req.pharmacy!.sub;
  const [patient] = await db
    .select({ hasPassword: patientsTable.hasPassword })
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId))
    .limit(1);
  if (!patient) {
    res.status(404).json({ error: "Patient profile not found" });
    return;
  }
  if (!patient.hasPassword) {
    // Otherwise the patient would have no way left to sign in.
    res.status(409).json({ error: "Set a password first, so you can still sign in without Google." });
    return;
  }
  await db
    .update(patientsTable)
    .set({ googleSub: null, updatedAt: new Date() })
    .where(and(eq(patientsTable.id, patientId), isNull(patientsTable.erasedAt)));
  await writeAudit({
    actorType: "patient",
    actorId: patientId,
    actorName: req.pharmacy!.name,
    action: "patient.google_disconnected",
    entityType: "patient",
    entityId: patientId,
    details: {},
  });
  res.json({ googleConnected: false });
});

export default router;
