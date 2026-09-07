/**
 * Startup validation for signing and encryption secrets.
 *
 * Called from the server entrypoint, so a misconfigured deployment fails
 * immediately and loudly rather than running with a weak or publicly known
 * signing key. Not called from app.ts, so tests can drive the app with short
 * fixture secrets.
 *
 * What each secret protects:
 *
 *   JWT_SECRET      Signs access tokens (lib/jwt.ts) and the signed image URLs
 *                   that serve prescriptions and profile photos
 *                   (lib/signedUrl.ts). Rotating it invalidates live sessions
 *                   and outstanding image links — users log in again, nothing
 *                   is lost.
 *
 *   SESSION_SECRET  Derives the AES key that encrypts stored provider
 *                   credentials (lib/credentialEncryption.ts) and the HMAC key
 *                   for password-reset codes (routes/auth.ts). Rotating it
 *                   makes stored provider credentials permanently
 *                   undecryptable and voids in-flight reset codes. Rotate it
 *                   only deliberately, and re-enter provider credentials in HQ
 *                   afterwards.
 */

import { createHash } from "node:crypto";

/** Below this, a signing key is brute-forceable. 32 bytes as hex is 64 chars. */
const MINIMUM_LENGTH = 32;

/**
 * SHA-256 of secrets known to be public, so a leaked value can never be put
 * back into service by accident.
 *
 * The digest is stored rather than the secret: recording the value here would
 * republish the very thing being retired.
 *
 * - The JWT_SECRET committed to `.replit` and present in git history from
 *   commit 2d6245b until it was removed.
 */
const KNOWN_COMPROMISED_DIGESTS = new Map<string, string>([
  [
    "2fb304ccf18cb4273475ab6dceba6c58d2d42d52c4b6b0e829c2d147c04f9365",
    "the JWT_SECRET that was committed to .replit",
  ],
]);

export class InsecureSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsecureSecretError";
  }
}

function check(name: string, value: string | undefined): string[] {
  const problems: string[] = [];

  if (!value) {
    problems.push(`${name} is not set.`);
    return problems;
  }

  if (value.length < MINIMUM_LENGTH) {
    problems.push(
      `${name} is ${value.length} characters; at least ${MINIMUM_LENGTH} are required. ` +
        `Generate one with: openssl rand -hex 32`,
    );
  }

  const digest = createHash("sha256").update(value).digest("hex");
  const known = KNOWN_COMPROMISED_DIGESTS.get(digest);
  if (known) {
    problems.push(
      `${name} matches ${known}. That value is public and must never be used. ` +
        `Generate a new one with: openssl rand -hex 32`,
    );
  }

  if (/^(replace|change|example|test|secret|password|placeholder)/i.test(value)) {
    problems.push(
      `${name} looks like a placeholder rather than a generated secret.`,
    );
  }

  return problems;
}

/**
 * Validate every secret the API signs or encrypts with.
 *
 * Throws listing every problem at once, so an operator fixes the whole set in
 * one pass instead of discovering them one restart at a time.
 *
 * Enforced only when NODE_ENV is production. Development and test runs use
 * throwaway values deliberately.
 */
export function assertSecretsAreSafe(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env["NODE_ENV"] !== "production") return;

  const problems = [
    ...check("JWT_SECRET", env["JWT_SECRET"]),
    ...check("SESSION_SECRET", env["SESSION_SECRET"]),
  ];

  if (env["JWT_SECRET"] && env["JWT_SECRET"] === env["SESSION_SECRET"]) {
    problems.push(
      "JWT_SECRET and SESSION_SECRET are identical. They protect different " +
        "things and must be independent values, so that rotating one does not " +
        "force rotating the other.",
    );
  }

  if (problems.length > 0) {
    throw new InsecureSecretError(
      `Refusing to start with unsafe secrets:\n  - ${problems.join("\n  - ")}`,
    );
  }
}

/** Exported for tests. */
export const internals = { MINIMUM_LENGTH, KNOWN_COMPROMISED_DIGESTS };
