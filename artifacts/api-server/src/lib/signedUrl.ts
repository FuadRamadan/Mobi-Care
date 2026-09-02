import crypto from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET env var is required");
const SECRET: string = JWT_SECRET;

const SIGNED_URL_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Mint a short-lived signed token for a prescription image.
 *
 * In production, pair this with an object-storage service (e.g. S3/GCS)
 * that stores prescription images encrypted at rest. The token should be
 * exchanged with the storage service for a pre-signed read URL rather than
 * serving raw bytes from this API.
 *
 * For this phase the token structure is returned so the frontend can
 * call back to /api/prescription-images/:prescriptionId?... to verify
 * integrity before the storage layer is wired up.
 */
export function mintImageToken(
  prescriptionId: string,
  variant: "preview" | "full"
): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
  const message = `${prescriptionId}:${variant}:${expiresAt}`;
  const token = crypto
    .createHmac("sha256", SECRET)
    .update(message)
    .digest("hex");
  return { token, expiresAt };
}

export function verifyImageToken(
  prescriptionId: string,
  variant: string,
  expiresAt: number,
  token: string
): boolean {
  if (Date.now() > expiresAt) return false;
  const message = `${prescriptionId}:${variant}:${expiresAt}`;
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(message)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export function mintProfileImageToken(patientId: string): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
  const token = crypto
    .createHmac("sha256", SECRET)
    .update(`${patientId}:profile:${expiresAt}`)
    .digest("hex");
  return { token, expiresAt };
}

export function verifyProfileImageToken(
  patientId: string,
  expiresAt: number,
  token: string,
): boolean {
  if (Date.now() > expiresAt) return false;
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(`${patientId}:profile:${expiresAt}`)
    .digest("hex");
  const actual = Buffer.from(token);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}
