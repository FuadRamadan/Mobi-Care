/**
 * Signature correctness, checked against the worked examples AWS publishes for
 * S3 SigV4. These fix the exact expected signature for a known key, time and
 * request, so any drift in canonicalisation, encoding or key derivation shows
 * up here rather than as an opaque 403 from the provider.
 *
 * Source: AWS "Examples of the complete Signature Version 4 signing process".
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_PAYLOAD_SHA256,
  encodeObjectPath,
  presign,
  signRequest,
  type S3Credentials,
} from "./sigv4.js";

// The credentials AWS uses throughout its signing examples. Not real.
const credentials: S3Credentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
};

const signingTime = new Date("2013-05-24T00:00:00Z");
const host = "examplebucket.s3.amazonaws.com";

/** Pull the Signature= value out of an Authorization header. */
function signatureOf(headers: Record<string, string>): string {
  const match = /Signature=([0-9a-f]+)/.exec(headers["authorization"] ?? "");
  assert.ok(match, "Authorization header should carry a signature");
  return match[1]!;
}

test("GET Object matches the published signature", () => {
  const headers = signRequest({
    method: "GET",
    url: new URL(`https://${host}/test.txt`),
    headers: { range: "bytes=0-9" },
    payloadHash: EMPTY_PAYLOAD_SHA256,
    credentials,
    now: signingTime,
  });

  assert.equal(
    signatureOf(headers),
    "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
});

test("PUT Object matches the published signature", () => {
  // "/test$file.text" — the example exists to pin percent-encoding of the path.
  const url = new URL(`https://${host}/${encodeObjectPath("test$file.text")}`);
  assert.equal(url.pathname, "/test%24file.text");

  const headers = signRequest({
    method: "PUT",
    url,
    headers: {
      date: "Fri, 24 May 2013 00:00:00 GMT",
      "x-amz-storage-class": "REDUCED_REDUNDANCY",
    },
    payloadHash:
      "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
    credentials,
    now: signingTime,
  });

  assert.equal(
    signatureOf(headers),
    "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
  );
});

test("presigned GET matches the published signature", () => {
  const url = presign({
    method: "GET",
    url: new URL(`https://${host}/test.txt`),
    expiresInSeconds: 86400,
    credentials,
    now: signingTime,
  });

  const parsed = new URL(url);
  assert.equal(
    parsed.searchParams.get("X-Amz-Signature"),
    "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
  );
  assert.equal(parsed.searchParams.get("X-Amz-SignedHeaders"), "host");
  assert.equal(parsed.searchParams.get("X-Amz-Expires"), "86400");
});

test("object paths encode segments but keep separators", () => {
  assert.equal(encodeObjectPath("a/b/c.jpg"), "a/b/c.jpg");
  assert.equal(encodeObjectPath("uploads/my file.jpg"), "uploads/my%20file.jpg");
  // encodeURIComponent leaves these alone; AWS requires them escaped.
  assert.equal(encodeObjectPath("a!b*c'd(e)f"), "a%21b%2Ac%27d%28e%29f");
  // Unreserved characters must survive untouched.
  assert.equal(encodeObjectPath("a-b_c.d~e"), "a-b_c.d~e");
});

test("session tokens are signed, not merely attached", () => {
  const withToken = signRequest({
    method: "GET",
    url: new URL(`https://${host}/test.txt`),
    payloadHash: EMPTY_PAYLOAD_SHA256,
    credentials: { ...credentials, sessionToken: "TOKEN" },
    now: signingTime,
  });

  assert.equal(withToken["x-amz-security-token"], "TOKEN");
  assert.match(withToken["authorization"]!, /x-amz-security-token/);
  assert.notEqual(
    signatureOf(withToken),
    "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
});
