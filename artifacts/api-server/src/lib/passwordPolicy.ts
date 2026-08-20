/**
 * Shared pharmacy password-policy helper.
 *
 * Security invariants enforced here:
 * - Plaintext passwords NEVER leave the calling function scope.
 * - No plaintext is persisted, logged, or returned from any helper.
 * - Only bcrypt hashes are written to the database.
 */

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import {
  pharmacyPasswordPolicyTable,
  pharmacyPasswordHistoryTable,
  type PharmacyPasswordPolicy,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

// ── Singleton policy ──────────────────────────────────────────────────────────

/**
 * Load the singleton policy row, creating it with defaults if it does not exist.
 * Safe to call concurrently — uses INSERT … ON CONFLICT DO NOTHING.
 */
export async function getOrCreatePasswordPolicy(): Promise<PharmacyPasswordPolicy> {
  // Try to load first (fast path, avoids upsert in the common case)
  const [existing] = await db
    .select()
    .from(pharmacyPasswordPolicyTable)
    .where(eq(pharmacyPasswordPolicyTable.id, 1))
    .limit(1);

  if (existing) return existing;

  // Insert with defaults; if another request beat us, ignore the conflict
  await db
    .insert(pharmacyPasswordPolicyTable)
    .values({ id: 1 })
    .onConflictDoNothing({ target: pharmacyPasswordPolicyTable.id });

  const [row] = await db
    .select()
    .from(pharmacyPasswordPolicyTable)
    .where(eq(pharmacyPasswordPolicyTable.id, 1))
    .limit(1);

  return row!;
}

// ── Password validation ───────────────────────────────────────────────────────

export interface PasswordValidationResult {
  valid: boolean;
  /** Human-readable actionable messages explaining what is wrong */
  messages: string[];
}

/**
 * Validate a proposed new password against the current policy.
 * Does NOT persist anything — purely in-memory.
 */
export function validatePasswordAgainstPolicy(
  password: string,
  policy: PharmacyPasswordPolicy,
): PasswordValidationResult {
  const messages: string[] = [];

  if (password.length < policy.minPasswordLength) {
    messages.push(
      `Password must be at least ${policy.minPasswordLength} characters long.`,
    );
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    messages.push("Password must contain at least one uppercase letter.");
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    messages.push("Password must contain at least one lowercase letter.");
  }
  if (policy.requireNumber && !/[0-9]/.test(password)) {
    messages.push("Password must contain at least one number.");
  }
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) {
    messages.push(
      "Password must contain at least one symbol (e.g. @, #, !, $).",
    );
  }

  return { valid: messages.length === 0, messages };
}

// ── History check ─────────────────────────────────────────────────────────────

/**
 * Check whether the proposed password matches the current hash or any of the
 * recent history hashes (up to policy.passwordHistoryCount entries).
 *
 * Returns true if the password has been used before (re-use detected).
 */
export async function isPasswordReused(
  password: string,
  currentHash: string,
  pharmacyId: string,
  policy: PharmacyPasswordPolicy,
): Promise<boolean> {
  // Always check the current password first
  if (await bcrypt.compare(password, currentHash)) return true;

  // Load the most recent history entries
  const history = await db
    .select({ passwordHash: pharmacyPasswordHistoryTable.passwordHash })
    .from(pharmacyPasswordHistoryTable)
    .where(eq(pharmacyPasswordHistoryTable.pharmacyId, pharmacyId))
    .orderBy(desc(pharmacyPasswordHistoryTable.sequence))
    .limit(policy.passwordHistoryCount);

  for (const row of history) {
    if (await bcrypt.compare(password, row.passwordHash)) return true;
  }

  return false;
}

// ── Temporary password generation ─────────────────────────────────────────────

/**
 * Generate a cryptographically secure temporary password using Node's
 * crypto.randomBytes — never Math.random().
 *
 * The returned plaintext MUST stay in the calling scope; it is returned
 * exactly once and must never be logged or persisted.
 */
export function generateTemporaryPassword(): string {
  // 18 bytes → 24 base64url chars; meets default minLength=12 and complexity
  // requirements because base64url uses A-Z, a-z, 0-9, -, _
  // We append a fixed symbol + digit suffix so the generated value always
  // satisfies uppercase, lowercase, number and symbol policies.
  const base = crypto.randomBytes(14).toString("base64url"); // 19 chars
  // Ensure the generated password meets all character-class requirements
  // regardless of the random bytes outcome.
  const suffix =
    String.fromCharCode(65 + (crypto.randomBytes(1)[0]! % 26)) + // uppercase
    String.fromCharCode(97 + (crypto.randomBytes(1)[0]! % 26)) + // lowercase
    String(crypto.randomBytes(1)[0]! % 10) + // digit
    "!"; // symbol
  return base + suffix;
}

/**
 * Calculate the expiry Date for a temporary password based on the policy.
 */
export function calculateTempPasswordExpiry(policy: PharmacyPasswordPolicy): Date {
  return new Date(
    Date.now() + policy.temporaryPasswordExpiryHours * 60 * 60 * 1000,
  );
}

// ── History pruning ───────────────────────────────────────────────────────────

/**
 * Append the given hash to the pharmacy's password history.
 * Call this INSIDE a transaction after updating the pharmacy row.
 * Pass the drizzle transaction object as `tx` when inside a transaction.
 */
export async function appendPasswordHistory(
  pharmacyId: string,
  oldHash: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any = db,
): Promise<void> {
  await tx.insert(pharmacyPasswordHistoryTable).values({
    pharmacyId,
    passwordHash: oldHash,
  });
}
