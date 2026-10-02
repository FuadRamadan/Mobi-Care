import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import {
  GoogleSignInError,
  resetGoogleKeyCache,
  signGoogleSignupToken,
  verifyGoogleCredential,
  verifyGoogleSignupToken,
} from "./googleSignIn";

// Stand-ins for Google: a key pair whose public half is "published", and one
// that is not (a forger's).
const google = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const forger = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-key-1";
const CLIENT_ID = "1234-test.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_ID = CLIENT_ID;

globalThis.fetch = (async () =>
  new Response(JSON.stringify({ keys: [{ ...google.publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }] }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
  })) as typeof fetch;

function credential(claims: Record<string, unknown>, key = google.privateKey, options: jwt.SignOptions = {}) {
  return jwt.sign(
    { sub: "1000001", email: "Aminata@Example.com", email_verified: true, name: "Aminata Kamara", ...claims },
    key,
    { algorithm: "RS256", keyid: KID, audience: CLIENT_ID, issuer: "https://accounts.google.com", expiresIn: "1h", ...options },
  );
}

test("a Google sign-in for MobiCare is accepted", async () => {
  resetGoogleKeyCache();
  assert.deepEqual(await verifyGoogleCredential(credential({})), {
    sub: "1000001",
    email: "aminata@example.com",
    name: "Aminata Kamara",
  });
});

test("an email Google has not verified is not taken", async () => {
  const identity = await verifyGoogleCredential(credential({ email_verified: false }));
  assert.equal(identity.email, null);
});

test("sign-ins for another app, from another issuer, expired or forged are refused", async () => {
  await assert.rejects(verifyGoogleCredential(credential({}, google.privateKey, { audience: "someone-else.apps.googleusercontent.com" })), GoogleSignInError);
  await assert.rejects(verifyGoogleCredential(credential({}, google.privateKey, { issuer: "https://evil.example" })), GoogleSignInError);
  await assert.rejects(verifyGoogleCredential(credential({}, google.privateKey, { expiresIn: -300 })), GoogleSignInError);
  await assert.rejects(verifyGoogleCredential(credential({}, forger.privateKey)), GoogleSignInError);
  await assert.rejects(verifyGoogleCredential("not-a-token-at-all-really"), GoogleSignInError);
});

test("the sign-up step carries the checked identity and cannot be altered", () => {
  const token = signGoogleSignupToken({ sub: "1000001", email: "aminata@example.com", name: "Aminata Kamara" });
  assert.equal(verifyGoogleSignupToken(token).sub, "1000001");
  const [header, payload, signature] = token.split(".");
  const altered = JSON.parse(Buffer.from(payload!, "base64url").toString());
  altered.sub = "2000002";
  assert.throws(() => verifyGoogleSignupToken(`${header}.${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${signature}`), GoogleSignInError);
});
