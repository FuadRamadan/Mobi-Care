/**
 * AWS Signature V4 — the signing core, for the probe's storage round-trip.
 *
 * A trimmed copy of artifacts/api-server/src/lib/storage/sigv4.ts, which is the
 * implementation the application uses and is verified against AWS's published
 * example signatures. It is duplicated here on purpose: the probe is a
 * standalone app that gets zipped and uploaded on its own, so it cannot import
 * from the workspace. If the two ever disagree, the one under artifacts/ is the
 * real one.
 */

import { createHash, createHmac } from "node:crypto";

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data, "utf8").digest();

export const EMPTY_PAYLOAD_SHA256 = sha256Hex("");

/** RFC 3986: encodeURIComponent leaves ! * ' ( ) alone; AWS wants them escaped. */
function uriEncode(value) {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Encode each key segment; the "/" separators stay literal. */
export function encodeObjectPath(key) {
  return key.split("/").map(uriEncode).join("/");
}

function timestamps(now) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function canonicalQueryString(query) {
  return Object.keys(query)
    .map((k) => [uriEncode(k), uriEncode(query[k] ?? "")])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

function canonicalHeaders(headers) {
  const entries = Object.entries(headers)
    .map(([n, v]) => [n.toLowerCase(), String(v).trim().replace(/\s+/g, " ")])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    canonical: entries.map(([n, v]) => `${n}:${v}\n`).join(""),
    signed: entries.map(([n]) => n).join(";"),
  };
}

function signingKey(secret, dateStamp, region) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), SERVICE), "aws4_request");
}

function buildSignature({ method, canonicalUri, query, headers, payloadHash, amzDate, dateStamp, credentials }) {
  const { canonical, signed } = canonicalHeaders(headers);
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString(query),
    canonical,
    signed,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${credentials.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const key = signingKey(credentials.secretAccessKey, dateStamp, credentials.region);
  return { signature: hmac(key, stringToSign).toString("hex"), signedHeaders: signed, scope };
}

/** Sign a request with an Authorization header. */
export function signRequest({ method, url, headers = {}, payloadHash, credentials, now = new Date() }) {
  const { amzDate, dateStamp } = timestamps(now);

  const signed = {
    ...headers,
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (credentials.sessionToken) signed["x-amz-security-token"] = credentials.sessionToken;

  const query = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const { signature, signedHeaders, scope } = buildSignature({
    method,
    canonicalUri: url.pathname,
    query,
    headers: signed,
    payloadHash,
    amzDate,
    dateStamp,
    credentials,
  });

  signed["authorization"] =
    `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return signed;
}

/** Produce a presigned URL, as used for direct browser uploads. */
export function presign({ method, url, expiresInSeconds, credentials, now = new Date() }) {
  const { amzDate, dateStamp } = timestamps(now);
  const scope = `${dateStamp}/${credentials.region}/${SERVICE}/aws4_request`;

  const query = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  query["X-Amz-Algorithm"] = ALGORITHM;
  query["X-Amz-Credential"] = `${credentials.accessKeyId}/${scope}`;
  query["X-Amz-Date"] = amzDate;
  query["X-Amz-Expires"] = String(expiresInSeconds);
  if (credentials.sessionToken) query["X-Amz-Security-Token"] = credentials.sessionToken;
  query["X-Amz-SignedHeaders"] = "host";

  const { signature } = buildSignature({
    method,
    canonicalUri: url.pathname,
    query,
    headers: { host: url.host },
    payloadHash: UNSIGNED_PAYLOAD,
    amzDate,
    dateStamp,
    credentials,
  });

  return `${url.origin}${url.pathname}?${canonicalQueryString(query)}&X-Amz-Signature=${signature}`;
}
