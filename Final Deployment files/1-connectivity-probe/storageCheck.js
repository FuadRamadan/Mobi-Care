/**
 * Storage round-trip: does image handling actually work from this host?
 *
 * Reachability alone proves nothing — credentials can be wrong, the bucket can
 * refuse writes, the region can mismatch, and each of those surfaces as a 403
 * only when a real patient uploads a real prescription. So this writes an
 * object, reads it back, compares the bytes, checks the ACL metadata survived,
 * exercises a presigned upload the way a browser does, and deletes what it
 * made.
 *
 * Everything it writes lives under a probe-only prefix and is removed at the
 * end. It never touches application objects.
 */

import { randomUUID, createHash } from "node:crypto";
import { EMPTY_PAYLOAD_SHA256, encodeObjectPath, presign, sha256Hex, signRequest } from "./sigv4.js";

const TIMEOUT_MS = 15_000;

function config() {
  const required = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) return { missing };

  return {
    endpoint: process.env.S3_ENDPOINT.replace(/\/+$/, ""),
    region: process.env.S3_REGION,
    bucket: process.env.S3_BUCKET,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      ...(process.env.S3_SESSION_TOKEN ? { sessionToken: process.env.S3_SESSION_TOKEN } : {}),
      region: process.env.S3_REGION,
    },
    // Path-style is what R2, B2 and MinIO require and AWS accepts.
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    prefix: (process.env.S3_PRIVATE_PREFIX || "private").replace(/^\/+|\/+$/g, ""),
  };
}

function objectUrl(cfg, key) {
  const encoded = encodeObjectPath(key);
  if (cfg.forcePathStyle) return new URL(`${cfg.endpoint}/${cfg.bucket}/${encoded}`);
  const base = new URL(cfg.endpoint);
  return new URL(`${base.protocol}//${cfg.bucket}.${base.host}/${encoded}`);
}

async function send(cfg, method, key, { headers = {}, body } = {}) {
  const url = objectUrl(cfg, key);
  const payloadHash = body ? sha256Hex(body) : EMPTY_PAYLOAD_SHA256;
  const signed = signRequest({ method, url, headers, payloadHash, credentials: cfg.credentials });

  const init = { method, headers: signed, signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (body) init.body = new Uint8Array(body);
  return fetch(url, init);
}

/** Turn a non-2xx into a readable reason, including the provider's error code. */
async function reason(response) {
  const text = await response.text().catch(() => "");
  const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
  const message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1];
  return code ? `${code} (${response.status})${message ? `: ${message}` : ""}` : `HTTP ${response.status}`;
}

/**
 * Run the round-trip. Returns a probe-shaped result.
 *
 * Failures name the specific step, because "storage does not work" is not
 * actionable but "the bucket accepted the write and refused the read" is.
 */
export async function storageRoundTrip() {
  const cfg = config();
  if (cfg.missing) {
    return {
      status: "skipped",
      detail:
        `Object storage is not configured, so photo handling was not tested. ` +
        `Set ${cfg.missing.join(", ")}. Prescriptions, profile photos, courier ` +
        `and team photos and advertisements all depend on this.`,
    };
  }

  const key = `${cfg.prefix}/_probe/${randomUUID()}.bin`;
  const body = Buffer.from(`mobicare-probe-${randomUUID()}`);
  const digest = createHash("sha256").update(body).digest("hex");
  const steps = [];
  let wrote = false;

  try {
    // 1. Write, carrying the same ACL metadata key the application uses.
    const put = await send(cfg, "PUT", key, {
      headers: { "content-type": "application/octet-stream", "x-amz-meta-acl-policy": '{"owner":"probe","visibility":"private"}' },
      body,
    });
    if (!put.ok) {
      return {
        status: "fail",
        detail:
          `Could not write to the bucket: ${await reason(put)}. Check the ` +
          `credentials, the bucket name, and that the key is allowed to write.`,
      };
    }
    wrote = true;
    steps.push("write");

    // 2. Read it back and compare bytes, not just status.
    const get = await send(cfg, "GET", key);
    if (!get.ok) {
      return {
        status: "fail",
        detail:
          `Wrote the object but could not read it back: ${await reason(get)}. ` +
          `The credentials can write but not read — images would upload and ` +
          `then fail to display.`,
      };
    }
    const readBack = Buffer.from(await get.arrayBuffer());
    if (createHash("sha256").update(readBack).digest("hex") !== digest) {
      return {
        status: "fail",
        detail: "The object read back did not match what was written. Storage is corrupting data.",
      };
    }
    steps.push("read");

    // 3. The ACL policy must survive. Without it the application treats an
    //    object as having no policy, and no policy denies everyone — a patient
    //    would be locked out of their own prescription.
    const aclPolicy = get.headers.get("x-amz-meta-acl-policy");
    if (!aclPolicy) {
      return {
        status: "fail",
        detail:
          "Object metadata did not survive the round trip. The access-control " +
          "policy is stored as metadata, and without it private images are " +
          "readable by nobody, including their owner.",
      };
    }
    steps.push("metadata");

    // 4. Presigned upload, as the browser performs it for HQ media. This is the
    //    path a CORS or clock-skew problem breaks.
    const presignedKey = `${cfg.prefix}/_probe/${randomUUID()}.bin`;
    const presignedUrl = presign({
      method: "PUT",
      url: objectUrl(cfg, presignedKey),
      expiresInSeconds: 900,
      credentials: cfg.credentials,
    });
    const presignedPut = await fetch(presignedUrl, {
      method: "PUT",
      body: "presigned-probe",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!presignedPut.ok) {
      return {
        status: "fail",
        detail:
          `A presigned upload was rejected: ${await reason(presignedPut)}. ` +
          `HQ media uploads go straight from the browser to the bucket using ` +
          `these, so advertisements, courier and team photos would fail.`,
      };
    }
    steps.push("presigned upload");
    await send(cfg, "DELETE", presignedKey).catch(() => {});

    // 5. Clean up.
    const del = await send(cfg, "DELETE", key);
    if (del.ok || del.status === 404) {
      steps.push("delete");
      wrote = false;
    }

    return {
      status: "pass",
      detail:
        `Storage works end to end: ${steps.join(", ")}. Prescriptions, profile ` +
        `photos, courier and team photos and advertisements will all function.`,
    };
  } catch (error) {
    return {
      status: "fail",
      detail:
        `Storage check failed after ${steps.length > 0 ? steps.join(", ") : "no steps"}: ` +
        `${error?.message ?? String(error)}`,
    };
  } finally {
    // Never leave a probe object behind, even on an unexpected error.
    if (wrote) await send(cfg, "DELETE", key).catch(() => {});
  }
}
