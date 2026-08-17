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
  next();
}

/** Convenience: combine both middleware in one array */
export const pharmacy = [requireAuth, requirePharmacyRole] as const;
