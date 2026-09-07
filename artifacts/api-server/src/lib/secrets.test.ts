/**
 * Startup secret validation.
 *
 * The case that matters most is the last one: the JWT_SECRET that was committed
 * to .replit is public, and remains in git history where anyone with the
 * repository can read it. Rotation is the only real fix, and this check is what
 * stops the retired value being put back into service by a copy-paste.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  assertSecretsAreSafe,
  InsecureSecretError,
  internals,
} from "./secrets.js";

const strong = () => "a".repeat(64);
const other = () => "b".repeat(64);

/** A minimal production environment with everything in order. */
const goodEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  JWT_SECRET: strong(),
  SESSION_SECRET: other(),
});

test("accepts independent, long secrets", () => {
  assert.doesNotThrow(() => assertSecretsAreSafe(goodEnv()));
});

test("is not enforced outside production", () => {
  // Development and the test suite use short fixture values on purpose.
  assert.doesNotThrow(() =>
    assertSecretsAreSafe({
      NODE_ENV: "development",
      JWT_SECRET: "short",
      SESSION_SECRET: "short",
    }),
  );
});

test("rejects missing secrets", () => {
  assert.throws(
    () => assertSecretsAreSafe({ NODE_ENV: "production" }),
    (error: Error) => {
      assert.ok(error instanceof InsecureSecretError);
      assert.match(error.message, /JWT_SECRET is not set/);
      assert.match(error.message, /SESSION_SECRET is not set/);
      return true;
    },
  );
});

test("rejects secrets that are too short to resist brute force", () => {
  assert.throws(
    () => assertSecretsAreSafe({ ...goodEnv(), JWT_SECRET: "abc123" }),
    /JWT_SECRET is 6 characters/,
  );
});

test("rejects placeholder values left over from .env.example", () => {
  assert.throws(
    () =>
      assertSecretsAreSafe({
        ...goodEnv(),
        JWT_SECRET: "replace-with-at-least-32-random-bytes",
      }),
    /looks like a placeholder/,
  );
});

test("rejects reusing one secret for both purposes", () => {
  // They protect different things, and SESSION_SECRET is far more costly to
  // rotate — sharing a value couples those lifetimes together.
  assert.throws(
    () =>
      assertSecretsAreSafe({
        NODE_ENV: "production",
        JWT_SECRET: strong(),
        SESSION_SECRET: strong(),
      }),
    /identical/,
  );
});

test("reports every problem at once, not just the first", () => {
  try {
    assertSecretsAreSafe({ NODE_ENV: "production", JWT_SECRET: "x" });
    assert.fail("should have thrown");
  } catch (error) {
    const message = (error as Error).message;
    assert.match(message, /JWT_SECRET is 1 characters/);
    assert.match(message, /SESSION_SECRET is not set/);
  }
});

test("the committed .replit secret is registered as compromised", () => {
  // Pinned by digest, never by value: writing the secret here would put it
  // back into the repository, which is the thing being undone. This is the
  // SHA-256 of the JWT_SECRET that appeared in .replit.
  assert.ok(
    internals.KNOWN_COMPROMISED_DIGESTS.has(
      "2fb304ccf18cb4273475ab6dceba6c58d2d42d52c4b6b0e829c2d147c04f9365",
    ),
    "the leaked JWT_SECRET must stay registered so it cannot be reused",
  );
});

test("a registered compromised secret is refused under either name", () => {
  const value = "a-value-that-is-long-enough-to-pass-the-length-check";
  const digest = createHash("sha256").update(value).digest("hex");
  internals.KNOWN_COMPROMISED_DIGESTS.set(digest, "a secret used in this test");

  try {
    assert.throws(
      () => assertSecretsAreSafe({ ...goodEnv(), JWT_SECRET: value }),
      /JWT_SECRET matches a secret used in this test/,
    );
    assert.throws(
      () => assertSecretsAreSafe({ ...goodEnv(), SESSION_SECRET: value }),
      /SESSION_SECRET matches a secret used in this test/,
    );
  } finally {
    internals.KNOWN_COMPROMISED_DIGESTS.delete(digest);
  }
});
