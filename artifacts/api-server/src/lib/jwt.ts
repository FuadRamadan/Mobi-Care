import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET env var is required");
const SECRET: string = JWT_SECRET;

export const ACCESS_TOKEN_TTL = "15m";
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface PharmacyTokenPayload {
  sub: string;       // pharmacy id or hq staff id
  role: "pharmacy" | "hq";
  name: string;
  /** Pharmacy onboarded with a temp password must change it before using the API */
  mustChangePassword?: boolean;
}

export function signAccessToken(payload: PharmacyTokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): PharmacyTokenPayload {
  return jwt.verify(token, SECRET) as unknown as PharmacyTokenPayload;
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
