import assert from "node:assert/strict";
import test from "node:test";
import {
  emailOtpHash,
  emailRecoveryHash,
  encodePasswordResetEmail,
  normalizeRecoveryEmail,
  resetTokenHash,
} from "./patientEmailReset.js";

test("normalizes recovery email before hashing", () => {
  const normalized = normalizeRecoveryEmail("  Patient@Example.COM ");
  assert.equal(normalized, "patient@example.com");
  assert.equal(
    emailRecoveryHash(normalized),
    emailRecoveryHash("patient@example.com"),
  );
});

test("hashes OTPs and reset tokens without retaining plaintext", () => {
  process.env.SESSION_SECRET = "email-reset-test-secret";
  const otpHash = emailOtpHash(
    "00000000-0000-0000-0000-000000000001",
    "123456",
  );
  assert.match(otpHash, /^[a-f0-9]{64}$/);
  assert.equal(otpHash.includes("123456"), false);

  const tokenHash = resetTokenHash("single-use-reset-token");
  assert.match(tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(tokenHash.includes("single-use-reset-token"), false);
});

test("encodes a branded Gmail API message without exposing the OTP in the payload wrapper", () => {
  const raw = encodePasswordResetEmail("patient@example.com", "654321", 10);
  assert.match(raw, /^[A-Za-z0-9_-]+$/);

  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(decoded, /^From: MobiCare <mobicaresl00@gmail\.com>/);
  assert.match(decoded, /Subject: Your MobiCare Password Reset Code/);
  assert.match(decoded, /Your verification code is: 654321/);
  assert.match(decoded, /expires in 10 minutes/);
  assert.match(decoded, /safely ignore this email/);
});