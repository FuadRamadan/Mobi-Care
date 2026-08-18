import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, PharmacyTokenPayload } from "../lib/jwt.js";

export interface AuthRequest extends Request {
  pharmacy?: PharmacyTokenPayload;
}

/**
 * Verify the Bearer access token. Attaches decoded payload to req.pharmacy.
 * Rejects with 401 if token is missing or invalid.
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    req.pharmacy = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token" });
  }
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
