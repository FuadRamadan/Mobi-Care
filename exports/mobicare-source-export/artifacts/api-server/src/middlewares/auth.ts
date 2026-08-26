import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, PharmacyTokenPayload } from "../lib/jwt.js";
import { db } from "@workspace/db";
import { pharmaciesTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { getOrCreatePasswordPolicy } from "../lib/passwordPolicy.js";

export interface AuthRequest extends Request {
  pharmacy?: PharmacyTokenPayload;
}

/**
 * Verify the Bearer access token. Attaches decoded payload to req.pharmacy.
 * Rejects with 401 if token is missing or invalid.
 *
 * For pharmacy tokens: also validates that the token's sessionVersion matches
 * the live pharmacy row. This immediately invalidates all previously issued
 * access tokens after a credential reset without waiting for JWT expiry.
 */
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }
  const token = authHeader.slice(7);
  let payload: PharmacyTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired access token" });
    return;
  }

  // For pharmacy tokens, validate sessionVersion against the live row.
  // HQ and patient tokens do not use sessionVersion — skip the DB check.
  if (payload.role === "pharmacy") {
    try {
      const [[row], policy] = await Promise.all([
        db.select({
          sessionVersion: pharmaciesTable.sessionVersion,
          isActive: pharmaciesTable.isActive,
          mustChangePassword: pharmaciesTable.mustChangePassword,
          temporaryPasswordExpiresAt: pharmaciesTable.temporaryPasswordExpiresAt,
          passwordLastChangedAt: pharmaciesTable.passwordLastChangedAt,
        })
          .from(pharmaciesTable)
          .where(eq(pharmaciesTable.id, payload.sub))
          .limit(1),
        getOrCreatePasswordPolicy(),
      ]);

      if (!row || !row.isActive) {
        res.status(401).json({ error: "Account inactive or not found" });
        return;
      }
      if (payload.sessionVersion !== row.sessionVersion) {
        res.status(401).json({ error: "Session invalidated — please log in again", code: "SESSION_INVALIDATED" });
        return;
      }

      let mustChangePassword = row.mustChangePassword;
      const passwordAgeMs = Date.now() - row.passwordLastChangedAt.getTime();
      const maxPasswordAgeMs = policy.maxPasswordAgeDays * 24 * 60 * 60 * 1000;
      if (!mustChangePassword && passwordAgeMs >= maxPasswordAgeMs) {
        const [updated] = await db
          .update(pharmaciesTable)
          .set({ mustChangePassword: true, updatedAt: new Date() })
          .where(
            and(
              eq(pharmaciesTable.id, payload.sub),
              eq(pharmaciesTable.mustChangePassword, false),
            ),
          )
          .returning({ mustChangePassword: pharmaciesTable.mustChangePassword });
        mustChangePassword = updated?.mustChangePassword ?? true;
      }

      if (
        mustChangePassword &&
        row.temporaryPasswordExpiresAt &&
        row.temporaryPasswordExpiresAt.getTime() <= Date.now()
      ) {
        res.status(401).json({
          error: "Temporary password has expired. Please contact HQ for a new password reset.",
          code: "TEMPORARY_PASSWORD_EXPIRED",
        });
        return;
      }

      payload.mustChangePassword = mustChangePassword || undefined;
      req.pharmacy = payload;
      next();
    } catch {
      res.status(500).json({ error: "Authentication check failed" });
    }
    return;
  }

  req.pharmacy = payload;
  next();
}

/**
 * After requireAuth: reject if the token role is not 'pharmacy'.
 * Defence-in-depth — the frontend's own role check is not the real boundary.
 */
export function requirePharmacyRole(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (req.pharmacy?.role !== "pharmacy") {
    res.status(403).json({ error: "Pharmacy role required" });
    return;
  }
  if (req.pharmacy.mustChangePassword) {
    res.status(403).json({
      error: "Temporary password must be changed before using the portal",
      code: "PASSWORD_CHANGE_REQUIRED",
    });
    return;
  }
  next();
}

/** Convenience: combine both middleware in one array */
export const pharmacy = [requireAuth, requirePharmacyRole] as const;

/**
 * After requireAuth: reject if the token role is not 'hq'.
 * Every /hq/* route is behind this — the real security boundary is here,
 * not the frontend's login role check.
 */
export function requireHqRole(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (req.pharmacy?.role !== "hq") {
    res.status(403).json({ error: "HQ role required" });
    return;
  }
  next();
}

/** Convenience: combine both middleware in one array */
export const hq = [requireAuth, requireHqRole] as const;

/**
 * After requireAuth: reject if the token role is not 'patient'.
 * Every /patient/* route is behind this — patients can only ever act on
 * resources scoped to their own id (enforced again inside each handler).
 */
export function requirePatientRole(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (req.pharmacy?.role !== "patient") {
    res.status(403).json({ error: "Patient role required" });
    return;
  }
  next();
}

/** Convenience: combine both middleware in one array */
export const patient = [requireAuth, requirePatientRole] as const;
