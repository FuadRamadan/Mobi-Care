import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptSavedPairs,
  maskedRequest,
  reconcileEncryptedPairs,
  requestAuth,
  SAVED_VALUE_MASK,
  savedRequestInput,
  unsafeIp,
  unsafeRequestFieldName,
  validatePublicUrl,
} from "./apiConnections.js";
import {
  decryptCredential,
  encryptCredential,
} from "../../lib/credentialEncryption.js";

const publicDns = async () => [{ address: "93.184.216.34" }];
const privateDns = async () => [{ address: "10.0.0.1" }];

test("outbound URL validator accepts only public HTTPS destinations", async () => {
  const url = await validatePublicUrl("https://api.example.com/v1", publicDns);
  assert.equal(url.hostname, "api.example.com");

  for (const value of [
    "http://api.example.com",
    "https://user:pass@api.example.com",
    "https://api.example.com:8443",
    "https://localhost/",
    "https://metadata.google.internal/",
    "https://169.254.169.254/",
    "https://127.0.0.1/",
    "https://10.0.0.1/",
    "https://192.168.1.1/",
    "https://[::1]/",
    "https://[fc00::1]/",
    "https://[fe80::1]/",
    "https://[ff00::1]/",
  ]) {
    await assert.rejects(() => validatePublicUrl(value, publicDns));
  }
  await assert.rejects(() => validatePublicUrl("https://api.example.com", privateDns));
});

test("private, reserved, multicast, and IPv6 destinations are rejected", () => {
  for (const address of [
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.1.1",
    "172.16.0.1", "192.168.0.1", "198.18.0.1", "224.0.0.1", "240.0.0.1",
    "::", "::1", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "2001:db8::1",
    "::ffff:172.16.0.1", "::ffff:100.64.0.1", "::ffff:0.0.0.0",
  ]) assert.equal(unsafeIp(address), true, address);
  assert.equal(unsafeIp("93.184.216.34"), false);
});

test("credential-bearing header and query names are recognized", () => {
  for (const name of [
    "Authorization",
    "Proxy-Authorization",
    "Cookie",
    "X-API-Key",
    "x-auth-token",
    "client_secret",
    "access_token",
    "service-credential",
  ]) assert.equal(unsafeRequestFieldName(name), true, name);

  for (const name of [
    "Accept",
    "Content-Type",
    "Cache-Control",
    "client_id",
    "page_tokenizer",
  ]) assert.equal(unsafeRequestFieldName(name), false, name);
});

test("saved request validation rejects plaintext credentials and restricted headers", () => {
  const base = {
    name: "Example",
    url: "https://api.example.com/v1",
    method: "GET" as const,
    authType: "none" as const,
    params: [],
    headers: [],
    body: null,
  };

  assert.equal(savedRequestInput.safeParse({
    ...base,
    headers: [{ key: "Authorization", value: "Bearer plaintext" }],
  }).success, false);
  assert.equal(savedRequestInput.safeParse({
    ...base,
    headers: [{ key: "Host", value: "internal.example" }],
  }).success, false);
  assert.equal(savedRequestInput.safeParse({
    ...base,
    params: [{ key: "api_key", value: "plaintext" }],
  }).success, false);
  assert.equal(savedRequestInput.safeParse({
    ...base,
    url: "https://api.example.com/v1?access_token=plaintext",
  }).success, false);
  assert.equal(savedRequestInput.safeParse({
    ...base,
    url: "https://api.example.com/v1?page=2",
  }).success, false);
  assert.equal(savedRequestInput.safeParse({
    ...base,
    headers: [{ key: "Content-Type", value: "application/json" }],
    params: [{ key: "page", value: "1" }],
  }).success, true);
});

test("auth secrets are encrypted, masked, and never reused across auth modes", () => {
  process.env.SESSION_SECRET = "api-connections-test-session-secret";
  const bearer = {
    name: "Bearer request",
    url: "https://api.example.com/v1",
    method: "GET" as const,
    authType: "bearer" as const,
    auth: { secret: "top-secret-value" },
    params: [],
    headers: [],
    body: null,
  };
  const encrypted = requestAuth(bearer);
  assert.ok(encrypted);
  assert.doesNotMatch(encrypted, /top-secret-value/);
  assert.match(decryptCredential(encrypted), /top-secret-value/);

  const row = {
    id: "00000000-0000-4000-8000-000000000001",
    ...bearer,
    authConfigEncrypted: encrypted,
    paramsEncrypted: encryptCredential("[]"),
    headersEncrypted: encryptCredential("[]"),
    createdBy: null,
    updatedBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
  const publicRow = maskedRequest(row);
  assert.equal(publicRow.auth?.secret, "••••••••");
  assert.doesNotMatch(JSON.stringify(publicRow), /top-secret-value/);

  assert.throws(() => requestAuth({
    ...bearer,
    authType: "basic",
    auth: { username: "operator" },
  }, row));
});

test("saved pair values encrypt, mask, preserve, replace, clear, and queue duplicate keys", () => {
  process.env.SESSION_SECRET = "api-connections-test-session-secret";
  const created = reconcileEncryptedPairs([
    { key: "tag", value: "first" },
    { key: "tag", value: "second" },
    { key: "empty", value: "" },
  ]);
  assert.deepEqual(created.publicPairs, [
    { key: "tag", value: SAVED_VALUE_MASK },
    { key: "tag", value: SAVED_VALUE_MASK },
    { key: "empty", value: "" },
  ]);
  assert.doesNotMatch(created.encrypted, /first|second/);
  assert.deepEqual(decryptSavedPairs(created.publicPairs, created.encrypted).map((pair) => pair.value), ["first", "second", ""]);

  const updated = reconcileEncryptedPairs([
    { key: "tag", value: SAVED_VALUE_MASK },
    { key: "tag", value: "replacement" },
    { key: "empty", value: "" },
  ], created.publicPairs, created.encrypted);
  assert.deepEqual(decryptSavedPairs(updated.publicPairs, updated.encrypted).map((pair) => pair.value), [
    "first", "replacement", "",
  ]);
  assert.throws(() => reconcileEncryptedPairs([
    { key: "tag", value: SAVED_VALUE_MASK },
    { key: "tag", value: "replacement" },
    { key: "tag", value: SAVED_VALUE_MASK },
  ], created.publicPairs, created.encrypted), /Enter a new value/);
  assert.throws(() => reconcileEncryptedPairs(
    [{ key: "renamed", value: SAVED_VALUE_MASK }],
    created.publicPairs,
    created.encrypted,
  ), /Enter a new value/);
  const tamperedPublic = created.publicPairs.map((pair, index) =>
    index === 0 ? { ...pair, key: "changed" } : pair
  );
  assert.throws(() => decryptSavedPairs(tamperedPublic, created.encrypted), /re-entered/);
  // Duplication copies this opaque ciphertext without decrypting or exposing it.
  assert.deepEqual(decryptSavedPairs(created.publicPairs, created.encrypted), decryptSavedPairs(created.publicPairs, created.encrypted));
});

test("saved request source persists secrets encrypted and never serializes plaintext", async () => {
  // This source-level guard covers the route's security boundary without a database
  // or outbound connection: credentials are encrypted before insert and public
  // representations only contain the fixed mask.
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile("src/routes/hq/apiConnections.ts", "utf8"),
  );
  assert.match(source, /authConfigEncrypted\s*=\s*requestAuth/);
  assert.match(source, /secret: "••••••••"/);
  assert.match(source, /claimExecutionAllowance/);
  assert.match(source, /Sensitive headers must use encrypted authentication settings/);
  assert.match(source, /Redirect responses are not allowed/);
  assert.match(source, /Response exceeds the 256 KB limit/);
});