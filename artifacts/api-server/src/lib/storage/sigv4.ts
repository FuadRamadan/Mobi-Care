/**
 * AWS Signature Version 4 for S3-compatible object storage.
 *
 * Written against node:crypto and fetch rather than an SDK, so the adapter adds
 * no dependencies and speaks plain HTTPS on port 443 — the only outbound port
 * the target host allows.
 *
 * Covers the two signing modes the storage adapter needs:
 *
 *   signRequest   Authorization-header signing, for calls the server makes.
 *   presign       Query-string signing, for URLs handed to a browser so it can
 *                 upload or download directly without proxying through us.
 *
 * Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv4-signing-elements.html
 */

import { createHash, createHmac } from "node:crypto";

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Set for temporary credentials (STS). Omitted for static keys. */
  sessionToken?: string;
  region: string;
}

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

const sha256Hex = (data: string | Buffer): string =>
  createHash("sha256").update(data).digest("hex");

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest();

/** Empty-body hash, precomputed — the value S3 expects for GET/HEAD/DELETE. */
export const EMPTY_PAYLOAD_SHA256 = sha256Hex("");

/**
 * RFC 3986 encoding.
 *
 * encodeURIComponent leaves ! * ' ( ) unescaped, which AWS requires escaped;
 * a mismatch here changes the canonical request and every signature with it.
 */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Encode an object key for use in a URL path.
 *
 * Each segment is encoded, but the separators are not: S3 keys may contain "/"
 * and those slashes stay literal in the canonical URI.
 */
export function encodeObjectPath(key: string): string {
  return key.split("/").map(uriEncode).join("/");
}

/** AWS timestamp pair: 20260907T131254Z and 20260907. */
function timestamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/** Query string in canonical form: sorted by encoded key, then encoded value. */
function canonicalQueryString(query: Record<string, string>): string {
  return Object.keys(query)
    .map((key) => [uriEncode(key), uriEncode(query[key] ?? "")] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

/**
 * Canonical headers block plus the matching SignedHeaders list.
 *
 * Names are lowercased and sorted; values have surrounding whitespace trimmed
 * and internal runs collapsed, as the specification requires.
 */
function canonicalHeaders(headers: Record<string, string>): {
  canonical: string;
  signed: string;
} {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    canonical: entries.map(([name, value]) => `${name}:${value}\n`).join(""),
    signed: entries.map(([name]) => name).join(";"),
  };
}

/** Derive the date/region/service scoped signing key. */
function signingKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

function buildSignature(args: {
  method: string;
  canonicalUri: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  payloadHash: string;
  amzDate: string;
  dateStamp: string;
  credentials: S3Credentials;
}): { signature: string; signedHeaders: string } {
  const { canonical, signed } = canonicalHeaders(args.headers);

  const canonicalRequest = [
    args.method,
    args.canonicalUri,
    canonicalQueryString(args.query),
    canonical,
    signed,
    args.payloadHash,
  ].join("\n");

  const scope = `${args.dateStamp}/${args.credentials.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    args.amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const key = signingKey(args.credentials.secretAccessKey, args.dateStamp, args.credentials.region);
  return { signature: hmac(key, stringToSign).toString("hex"), signedHeaders: signed };
}

/**
 * Sign a request with an Authorization header.
 *
 * Returns the headers to send, including the caller's own. `payloadHash` must
 * be the hex SHA-256 of the body — EMPTY_PAYLOAD_SHA256 for bodiless requests.
 */
export function signRequest(args: {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  payloadHash: string;
  credentials: S3Credentials;
  now?: Date;
}): Record<string, string> {
  const { amzDate, dateStamp } = timestamps(args.now ?? new Date());
  const { credentials } = args;

  const headers: Record<string, string> = {
    ...args.headers,
    host: args.url.host,
    "x-amz-content-sha256": args.payloadHash,
    "x-amz-date": amzDate,
  };
  if (credentials.sessionToken) {
    headers["x-amz-security-token"] = credentials.sessionToken;
  }

  const query: Record<string, string> = {};
  args.url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const { signature, signedHeaders } = buildSignature({
    method: args.method,
    canonicalUri: args.url.pathname,
    query,
    headers,
    payloadHash: args.payloadHash,
    amzDate,
    dateStamp,
    credentials,
  });

  const scope = `${dateStamp}/${credentials.region}/${SERVICE}/aws4_request`;
  headers["authorization"] =
    `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return headers;
}

/**
 * Produce a presigned URL a browser can use directly.
 *
 * Only the Host header is signed, so the browser need not reproduce anything
 * beyond the URL itself. The payload is unsigned, which is what allows a client
 * to PUT arbitrary bytes to a URL we minted without us seeing them first.
 */
export function presign(args: {
  method: string;
  url: URL;
  expiresInSeconds: number;
  credentials: S3Credentials;
  /** Extra headers the client must send and that are bound into the signature. */
  signedHeaders?: Record<string, string>;
  now?: Date;
}): string {
  const { amzDate, dateStamp } = timestamps(args.now ?? new Date());
  const { credentials } = args;
  const scope = `${dateStamp}/${credentials.region}/${SERVICE}/aws4_request`;

  const headers: Record<string, string> = {
    ...args.signedHeaders,
    host: args.url.host,
  };

  const query: Record<string, string> = {};
  args.url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  query["X-Amz-Algorithm"] = ALGORITHM;
  query["X-Amz-Credential"] = `${credentials.accessKeyId}/${scope}`;
  query["X-Amz-Date"] = amzDate;
  query["X-Amz-Expires"] = String(args.expiresInSeconds);
  if (credentials.sessionToken) {
    query["X-Amz-Security-Token"] = credentials.sessionToken;
  }

  const { signed } = canonicalHeaders(headers);
  query["X-Amz-SignedHeaders"] = signed;

  const { signature } = buildSignature({
    method: args.method,
    canonicalUri: args.url.pathname,
    query,
    headers,
    payloadHash: UNSIGNED_PAYLOAD,
    amzDate,
    dateStamp,
    credentials,
  });

  return `${args.url.origin}${args.url.pathname}?${canonicalQueryString(query)}&X-Amz-Signature=${signature}`;
}

/** Exported for the signature-verifying test server. */
export const internals = {
  canonicalQueryString,
  canonicalHeaders,
  signingKey,
  buildSignature,
  sha256Hex,
  timestamps,
  UNSIGNED_PAYLOAD,
};
