import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { SerializedPasswordPolicy } from "./passwordPolicy.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET env var is required");
const SECRET: string = JWT_SECRET;

export const ACCESS_TOKEN_TTL = "15m";
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/**
 * Pharmacies stay signed in for 90 days without using the portal. The portal
 * must stay open to receive orders, so a weekly sign-out cost them orders.
 * Every use starts the 90 days again; signing out, a password change or an HQ
 * reset still ends the session at once.
 */
export const PHARMACY_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface PharmacyTokenPayload {
  sub: string;       // pharmacy id, hq staff id, or patient id
  role: "pharmacy" | "hq" | "patient";
  name: string;
  /** Pharmacy onboarded with a temp password must change it before using the API */
  mustChangePassword?: boolean;
  /**
   * Incremented on every credential reset. requireAuth compares this against
   * the live pharmacy row and rejects stale tokens immediately.
   * Present in pharmacy and patient tokens.
   */
  sessionVersion?: number;
  /** Password age metadata lets the portal render expiry UX without background API calls. */
  passwordLastChangedAt?: string;
  passwordPolicy?: SerializedPasswordPolicy;
}

export function signAccessToken(payload: PharmacyTokenPayload): string {
  return jwt.sign(payload, SECRET, { algorithm: "HS256", expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): PharmacyTokenPayload {
  // Pinned, so a token can never choose how it is checked.
  return jwt.verify(token, SECRET, { algorithms: ["HS256"] }) as unknown as PharmacyTokenPayload;
}

/** Generate a random opaque refresh token and its SHA-256 hash for storage */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(48).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

export function hashRefreshToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function refreshTokenExpiresAt(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
}

export function pharmacySessionExpiresAt(): Date {
  return new Date(Date.now() + PHARMACY_SESSION_TTL_MS);
}
