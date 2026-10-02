import crypto from "node:crypto";
import jwt from "jsonwebtoken";

/**
 * "Sign in with Google" for patients.
 *
 * The patient app shows Google's own button. When the patient picks their
 * account, Google hands the page a signed ID token (a JWT) naming the Google
 * account. The page sends it here and this module checks it really came from
 * Google, for MobiCare, and has not expired, before anyone is signed in:
 * signature against Google's published keys, issuer, audience (MobiCare's
 * Client ID) and expiry.
 */

/**
 * MobiCare's Google Client ID (public: it appears in every page with a Google
 * button). Set GOOGLE_CLIENT_ID to override; several IDs may be given,
 * separated by commas, for example when the phone app gets its own.
 */
export const DEFAULT_GOOGLE_CLIENT_ID = "";

const GOOGLE_ISSUERS: [string, string] = ["accounts.google.com", "https://accounts.google.com"];
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";

export function googleClientIds(): string[] {
  return (process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/** Where Google's signing keys are read from. Only tests may point it elsewhere. */
function certsUrl(): string {
  const override = process.env.GOOGLE_CERTS_URL;
  return override && process.env.NODE_ENV !== "production" ? override : GOOGLE_CERTS_URL;
}

export class GoogleSignInError extends Error {}

export interface GoogleIdentity {
  /** Google's permanent ID for the account. */
  sub: string;
  /** Only set when Google has verified the address. */
  email: string | null;
  name: string | null;
}

/** One of Google's published signing keys, as JSON Web Key fields. */
type GoogleJwk = { kid?: string; kty?: string; n?: string; e?: string; alg?: string; use?: string };

type KeyCache = { keys: Map<string, crypto.KeyObject>; expiresAt: number };
let cache: KeyCache | null = null;

async function loadKeys(): Promise<KeyCache> {
  const res = await fetch(certsUrl());
  if (!res.ok) throw new GoogleSignInError(`Google's keys could not be fetched (${res.status})`);
  const body = (await res.json()) as { keys?: Array<GoogleJwk> };
  const keys = new Map<string, crypto.KeyObject>();
  for (const jwk of body.keys ?? []) {
    if (jwk.kid) keys.set(jwk.kid, crypto.createPublicKey({ key: jwk as crypto.JsonWebKeyInput["key"], format: "jwk" }));
  }
  // Google rotates its keys; honour how long it says these stay valid.
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  return { keys, expiresAt: Date.now() + Math.min(maxAge, 24 * 3600) * 1000 };
}

async function keyFor(kid: string): Promise<crypto.KeyObject> {
  if (!cache || cache.expiresAt < Date.now() || !cache.keys.has(kid)) cache = await loadKeys();
  const key = cache.keys.get(kid);
  if (!key) throw new GoogleSignInError("The Google sign-in was signed with an unknown key");
  return key;
}

/** Forget cached keys (tests). */
export function resetGoogleKeyCache(): void {
  cache = null;
}

/** Checks a Google ID token and returns who it names. Throws GoogleSignInError if it is not valid. */
export async function verifyGoogleCredential(credential: string): Promise<GoogleIdentity> {
  const audience = googleClientIds();
  if (!audience.length) throw new GoogleSignInError("Google sign-in is not set up");
  const decoded = jwt.decode(credential, { complete: true });
  if (!decoded || typeof decoded.payload === "string" || decoded.header.alg !== "RS256" || !decoded.header.kid) {
    throw new GoogleSignInError("That is not a Google sign-in");
  }
  const key = await keyFor(decoded.header.kid);
  let claims: jwt.JwtPayload;
  try {
    claims = jwt.verify(credential, key, {
      algorithms: ["RS256"],
      audience: audience as [string, ...string[]],
      issuer: GOOGLE_ISSUERS,
      clockTolerance: 60,
    }) as jwt.JwtPayload;
  } catch (error) {
    throw new GoogleSignInError(`The Google sign-in could not be confirmed: ${(error as Error).message}`);
  }
  if (typeof claims.sub !== "string" || !claims.sub) throw new GoogleSignInError("The Google sign-in names no account");
  const emailVerified = claims.email_verified === true || claims.email_verified === "true";
  return {
    sub: claims.sub,
    email: emailVerified && typeof claims.email === "string" ? claims.email.toLowerCase() : null,
    name: typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : null,
  };
}

// ── The step between Google sign-in and a new account ───────────────────────

/**
 * A new patient signs in with Google, then gives their phone number and date
 * of birth before the account exists. This short-lived token carries the
 * checked Google identity across that step, so the browser cannot swap in
 * someone else's.
 */
const SIGNUP_PURPOSE = "google-signup";
const SIGNUP_TTL = "20m";

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET env var is required");
  return value;
}

export function signGoogleSignupToken(identity: GoogleIdentity): string {
  return jwt.sign({ purpose: SIGNUP_PURPOSE, ...identity }, secret(), { expiresIn: SIGNUP_TTL });
}

export function verifyGoogleSignupToken(token: string): GoogleIdentity {
  let claims: jwt.JwtPayload;
  try {
    claims = jwt.verify(token, secret()) as jwt.JwtPayload;
  } catch {
    throw new GoogleSignInError("This sign-up has expired. Tap Continue with Google again.");
  }
  if (claims.purpose !== SIGNUP_PURPOSE || typeof claims.sub !== "string") {
    throw new GoogleSignInError("This sign-up has expired. Tap Continue with Google again.");
  }
  return { sub: claims.sub, email: claims.email ?? null, name: claims.name ?? null };
}
