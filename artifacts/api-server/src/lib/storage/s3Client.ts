/**
 * Minimal S3 client over fetch.
 *
 * Covers only what MobiCare's storage adapter needs. Written directly against
 * the REST API rather than an SDK for two reasons: it adds no dependencies to
 * a workspace that pins them carefully, and it keeps every call plain HTTPS on
 * port 443 — the only outbound port the target host permits.
 *
 * Works with any S3-compatible provider (AWS S3, Cloudflare R2, Backblaze B2,
 * MinIO). Configuration comes from the environment; see the deployment notes
 * in "Final Deployment files/PLATFORM-NOTES.md".
 */

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  EMPTY_PAYLOAD_SHA256,
  encodeObjectPath,
  presign,
  signRequest,
  type S3Credentials,
} from "./sigv4.js";

export interface S3Config {
  /** Service origin, e.g. https://s3.eu-west-1.amazonaws.com */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /**
   * Put the bucket in the path (https://host/bucket/key) rather than the
   * hostname. Required by R2, B2 and MinIO; optional on AWS. Defaults on,
   * because it is the form every provider accepts.
   */
  forcePathStyle: boolean;
}

export class S3Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "S3Error";
  }
}

/** Thrown for 404s so callers can distinguish "absent" from "broken". */
export class S3NotFoundError extends S3Error {
  constructor(key: string) {
    super(404, "NoSuchKey", `Object not found: ${key}`);
    this.name = "S3NotFoundError";
  }
}

let cached: S3Config | null = null;

/** Read configuration from the environment, once. */
export function getS3Config(): S3Config {
  if (cached) return cached;

  const required = {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => `S3_${name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`);
  if (missing.length > 0) {
    throw new Error(
      `Object storage is not configured. Missing: ${missing.join(", ")}.`,
    );
  }

  cached = {
    endpoint: required.endpoint!.replace(/\/+$/, ""),
    region: required.region!,
    bucket: required.bucket!,
    accessKeyId: required.accessKeyId!,
    secretAccessKey: required.secretAccessKey!,
    ...(process.env.S3_SESSION_TOKEN ? { sessionToken: process.env.S3_SESSION_TOKEN } : {}),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  };
  return cached;
}

/** Discard the cached configuration. Tests only. */
export function resetS3Config(): void {
  cached = null;
}

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT &&
      process.env.S3_REGION &&
      process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY,
  );
}

function credentialsOf(config: S3Config): S3Credentials {
  return {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
    region: config.region,
  };
}

/**
 * Build the URL for an object key.
 *
 * The key is percent-encoded per segment here, so URL parsing does not alter
 * the path afterwards — the signature is computed over exactly these bytes.
 */
export function objectUrl(config: S3Config, key: string): URL {
  const encoded = encodeObjectPath(key);
  if (config.forcePathStyle) {
    return new URL(`${config.endpoint}/${config.bucket}/${encoded}`);
  }
  const url = new URL(config.endpoint);
  return new URL(`${url.protocol}//${config.bucket}.${url.host}/${encoded}`);
}

/** User metadata carried as x-amz-meta-* headers. */
export type ObjectMetadata = Record<string, string>;

const META_PREFIX = "x-amz-meta-";

function metadataHeaders(metadata: ObjectMetadata): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      `${META_PREFIX}${key.toLowerCase()}`,
      value,
    ]),
  );
}

function readMetadata(headers: Headers): ObjectMetadata {
  const metadata: ObjectMetadata = {};
  headers.forEach((value, name) => {
    if (name.toLowerCase().startsWith(META_PREFIX)) {
      metadata[name.slice(META_PREFIX.length).toLowerCase()] = value;
    }
  });
  return metadata;
}

/** Turn a non-2xx response into a typed error, reading the XML error code. */
async function toError(response: Response, key: string): Promise<S3Error> {
  if (response.status === 404) return new S3NotFoundError(key);
  const body = await response.text().catch(() => "");
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? "Unknown";
  const message = /<Message>([^<]+)<\/Message>/.exec(body)?.[1] ?? response.statusText;
  return new S3Error(response.status, code, `S3 ${code} (${response.status}): ${message}`);
}

const REQUEST_TIMEOUT_MS = 30_000;

async function send(
  method: string,
  url: URL,
  config: S3Config,
  options: { headers?: Record<string, string>; body?: Buffer } = {},
): Promise<Response> {
  const payloadHash = options.body
    ? createHash("sha256").update(options.body).digest("hex")
    : EMPTY_PAYLOAD_SHA256;

  const headers = signRequest({
    method,
    url,
    ...(options.headers ? { headers: options.headers } : {}),
    payloadHash,
    credentials: credentialsOf(config),
  });

  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
  if (options.body) {
    // Node's fetch accepts a Uint8Array body; Buffer is one.
    init.body = new Uint8Array(options.body);
  }
  return fetch(url, init);
}

export interface ObjectHead {
  contentType: string;
  contentLength: number | null;
  etag: string | null;
  metadata: ObjectMetadata;
}

/** HEAD an object. Returns null when it does not exist. */
export async function headObject(key: string, config = getS3Config()): Promise<ObjectHead | null> {
  const response = await send("HEAD", objectUrl(config, key), config);
  if (response.status === 404) return null;
  if (!response.ok) throw await toError(response, key);

  const length = response.headers.get("content-length");
  return {
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    contentLength: length === null ? null : Number(length),
    etag: response.headers.get("etag"),
    metadata: readMetadata(response.headers),
  };
}

export async function objectExists(key: string, config = getS3Config()): Promise<boolean> {
  return (await headObject(key, config)) !== null;
}

export async function putObject(
  key: string,
  body: Buffer,
  options: { contentType?: string; metadata?: ObjectMetadata } = {},
  config = getS3Config(),
): Promise<void> {
  const response = await send("PUT", objectUrl(config, key), config, {
    headers: {
      "content-type": options.contentType ?? "application/octet-stream",
      ...metadataHeaders(options.metadata ?? {}),
    },
    body,
  });
  if (!response.ok) throw await toError(response, key);
}

export interface ObjectBody extends ObjectHead {
  /** Response body stream. Consume or cancel it — do not leave it open. */
  stream: ReadableStream<Uint8Array>;
}

export async function getObject(key: string, config = getS3Config()): Promise<ObjectBody> {
  const response = await send("GET", objectUrl(config, key), config);
  if (!response.ok) throw await toError(response, key);
  if (!response.body) throw new S3Error(502, "EmptyBody", `No body returned for ${key}`);

  const length = response.headers.get("content-length");
  return {
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    contentLength: length === null ? null : Number(length),
    etag: response.headers.get("etag"),
    metadata: readMetadata(response.headers),
    stream: response.body,
  };
}

/** Read a whole object into memory. For small files only. */
export async function getObjectBuffer(key: string, config = getS3Config()): Promise<Buffer> {
  const object = await getObject(key, config);
  const chunks: Buffer[] = [];
  for await (const chunk of Readable.fromWeb(object.stream as never)) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string, config = getS3Config()): Promise<void> {
  const response = await send("DELETE", objectUrl(config, key), config);
  // S3 returns 204 for a successful delete and also for an absent key.
  if (!response.ok && response.status !== 404) throw await toError(response, key);
}

/**
 * Replace an object's user metadata.
 *
 * S3 metadata is fixed at write time, so the only way to change it is to copy
 * the object onto itself with REPLACE. This rewrites the object: it is not a
 * cheap header update, and it changes the ETag.
 */
export async function setObjectMetadata(
  key: string,
  metadata: ObjectMetadata,
  config = getS3Config(),
): Promise<void> {
  const existing = await headObject(key, config);
  if (!existing) throw new S3NotFoundError(key);

  const source = config.forcePathStyle
    ? `/${config.bucket}/${encodeObjectPath(key)}`
    : `/${config.bucket}/${encodeObjectPath(key)}`;

  const response = await send("PUT", objectUrl(config, key), config, {
    headers: {
      "x-amz-copy-source": source,
      "x-amz-metadata-directive": "REPLACE",
      "content-type": existing.contentType,
      ...metadataHeaders(metadata),
    },
  });
  if (!response.ok) throw await toError(response, key);
}

/** A presigned URL the client uses to upload directly. */
export function presignPut(
  key: string,
  expiresInSeconds: number,
  options: { contentType?: string } = {},
  config = getS3Config(),
): string {
  return presign({
    method: "PUT",
    url: objectUrl(config, key),
    expiresInSeconds,
    credentials: credentialsOf(config),
    // Binding Content-Type into the signature forces the client to send the
    // type we authorised, rather than any type it likes.
    ...(options.contentType ? { signedHeaders: { "content-type": options.contentType } } : {}),
  });
}

/** A presigned URL the client uses to download directly. */
export function presignGet(
  key: string,
  expiresInSeconds: number,
  config = getS3Config(),
): string {
  return presign({
    method: "GET",
    url: objectUrl(config, key),
    expiresInSeconds,
    credentials: credentialsOf(config),
  });
}
