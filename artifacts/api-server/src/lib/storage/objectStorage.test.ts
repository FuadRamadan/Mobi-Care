/**
 * End-to-end tests for the S3 storage adapter.
 *
 * Runs against an in-process S3 server that stores objects in memory and, more
 * importantly, *verifies every signature* by recomputing it from the request it
 * received. A request signed incorrectly is rejected here exactly as a real
 * provider would reject it, so these tests fail on signing bugs rather than
 * deferring them to production.
 *
 * Covers the behaviour route code depends on: upload, download, ACL round trip,
 * cache headers, presigned upload, deletion, path normalisation, and refusal of
 * traversal and unknown keys.
 */

import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

const ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
const SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const REGION = "us-east-1";
const BUCKET = "mobicare-test";

interface StoredEntry {
  body: Buffer;
  contentType: string;
  metadata: Record<string, string>;
}

const store = new Map<string, StoredEntry>();
/** Requests whose signature failed verification, for assertions. */
let rejected: string[] = [];
let server: Server;
let baseUrl: string;

/** Read the request body fully. */
async function readBody(req: import("node:http").IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Recompute the signature for an inbound request and compare it to the one
 * presented. This is what makes the mock meaningful rather than permissive.
 */
async function verifySignature(
  req: import("node:http").IncomingMessage,
  url: URL,
  body: Buffer,
): Promise<boolean> {
  const { internals } = await import("./sigv4.js");
  const credentials = { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY, region: REGION };

  const presented = url.searchParams.get("X-Amz-Signature");
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    if (key !== "X-Amz-Signature") query[key] = value;
  });

  if (presented) {
    // Query-signed (presigned URL): only the listed headers are signed and the
    // payload is unsigned.
    const signedNames = (url.searchParams.get("X-Amz-SignedHeaders") ?? "host").split(";");
    const headers: Record<string, string> = {};
    for (const name of signedNames) {
      headers[name] = name === "host" ? req.headers.host! : String(req.headers[name] ?? "");
    }
    const amzDate = url.searchParams.get("X-Amz-Date")!;
    const { signature } = internals.buildSignature({
      method: req.method!,
      canonicalUri: url.pathname,
      query,
      headers,
      payloadHash: internals.UNSIGNED_PAYLOAD,
      amzDate,
      dateStamp: amzDate.slice(0, 8),
      credentials,
    });
    return signature === presented;
  }

  const authorization = req.headers.authorization ?? "";
  const match = /SignedHeaders=([^,]+), Signature=([0-9a-f]+)/.exec(authorization);
  if (!match) return false;

  const [, signedHeaders, claimed] = match;
  const headers: Record<string, string> = {};
  for (const name of signedHeaders!.split(";")) {
    headers[name] = name === "host" ? req.headers.host! : String(req.headers[name] ?? "");
  }

  const amzDate = String(req.headers["x-amz-date"]);
  const { signature } = internals.buildSignature({
    method: req.method!,
    canonicalUri: url.pathname,
    query,
    headers,
    payloadHash: String(req.headers["x-amz-content-sha256"] ?? internals.sha256Hex(body)),
    amzDate,
    dateStamp: amzDate.slice(0, 8),
    credentials,
  });
  return signature === claimed;
}

function metadataOf(headers: import("node:http").IncomingHttpHeaders): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase().startsWith("x-amz-meta-")) {
      metadata[name.slice("x-amz-meta-".length).toLowerCase()] = String(value);
    }
  }
  return metadata;
}

before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const body = await readBody(req);

    if (!(await verifySignature(req, url, body))) {
      rejected.push(`${req.method} ${url.pathname}`);
      res.writeHead(403, { "content-type": "application/xml" });
      res.end("<Error><Code>SignatureDoesNotMatch</Code><Message>bad signature</Message></Error>");
      return;
    }

    // Path-style: /<bucket>/<key>
    const key = decodeURIComponent(url.pathname.replace(`/${BUCKET}/`, ""));
    const entry = store.get(key);

    const writeHeaders = (found: StoredEntry) => ({
      "content-type": found.contentType,
      "content-length": String(found.body.length),
      etag: '"deadbeef"',
      ...Object.fromEntries(
        Object.entries(found.metadata).map(([k, v]) => [`x-amz-meta-${k}`, v]),
      ),
    });

    switch (req.method) {
      case "PUT": {
        const copySource = req.headers["x-amz-copy-source"];
        if (copySource) {
          // Metadata replace: copy onto self with new metadata.
          const sourceKey = decodeURIComponent(
            String(copySource).replace(`/${BUCKET}/`, ""),
          );
          const source = store.get(sourceKey);
          if (!source) {
            res.writeHead(404);
            res.end("<Error><Code>NoSuchKey</Code><Message>absent</Message></Error>");
            return;
          }
          store.set(key, {
            body: source.body,
            contentType: String(req.headers["content-type"] ?? source.contentType),
            metadata: metadataOf(req.headers),
          });
          res.writeHead(200, { "content-type": "application/xml" });
          res.end("<CopyObjectResult></CopyObjectResult>");
          return;
        }
        store.set(key, {
          body,
          contentType: String(req.headers["content-type"] ?? "application/octet-stream"),
          metadata: metadataOf(req.headers),
        });
        res.writeHead(200);
        res.end();
        return;
      }
      case "HEAD": {
        if (!entry) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, writeHeaders(entry));
        res.end();
        return;
      }
      case "GET": {
        if (!entry) {
          res.writeHead(404, { "content-type": "application/xml" });
          res.end("<Error><Code>NoSuchKey</Code><Message>absent</Message></Error>");
          return;
        }
        res.writeHead(200, writeHeaders(entry));
        res.end(entry.body);
        return;
      }
      case "DELETE": {
        store.delete(key);
        res.writeHead(204);
        res.end();
        return;
      }
      default:
        res.writeHead(405);
        res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  process.env.S3_ENDPOINT = baseUrl;
  process.env.S3_REGION = REGION;
  process.env.S3_BUCKET = BUCKET;
  process.env.S3_ACCESS_KEY_ID = ACCESS_KEY;
  process.env.S3_SECRET_ACCESS_KEY = SECRET_KEY;
  process.env.S3_FORCE_PATH_STYLE = "true";
  process.env.S3_PRIVATE_PREFIX = "private";
  process.env.S3_PUBLIC_PREFIX = "public";
});

after(() => {
  server.close();
});

beforeEach(() => {
  store.clear();
  rejected = [];
});

/** Import lazily so the environment is configured before the module reads it. */
async function service() {
  const { ObjectStorageService } = await import("./objectStorage.js");
  return new ObjectStorageService();
}

test("uploads and downloads an object, signature accepted", async () => {
  const { objectStorageClient } = await import("./objectStorage.js");
  await objectStorageClient
    .bucket(BUCKET)
    .file("private/uploads/photo.jpg")
    .save(Buffer.from("image-bytes"), { contentType: "image/jpeg" });

  assert.deepEqual(rejected, [], "no request should fail signature verification");

  const storage = await service();
  const file = await storage.getObjectEntityFile("/objects/uploads/photo.jpg");
  assert.equal(file.key, "private/uploads/photo.jpg");

  const response = await storage.downloadObject(file, 60);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.equal(await response.text(), "image-bytes");
});

test("private objects are not cacheable by shared caches", async () => {
  const storage = await service();
  const { objectStorageClient } = await import("./objectStorage.js");
  await objectStorageClient
    .bucket(BUCKET)
    .file("private/uploads/rx.jpg")
    .save(Buffer.from("prescription"), { contentType: "image/jpeg" });

  // No policy at all — must not be treated as public.
  let file = await storage.getObjectEntityFile("/objects/uploads/rx.jpg");
  let response = await storage.downloadObject(file, 60);
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=60");
  await response.body?.cancel();

  await storage.trySetObjectEntityAclPolicy("/objects/uploads/rx.jpg", {
    owner: "patient-1",
    visibility: "private",
  });
  file = await storage.getObjectEntityFile("/objects/uploads/rx.jpg");
  response = await storage.downloadObject(file, 60);
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=60");
  await response.body?.cancel();

  await storage.trySetObjectEntityAclPolicy("/objects/uploads/rx.jpg", {
    owner: "patient-1",
    visibility: "public",
  });
  file = await storage.getObjectEntityFile("/objects/uploads/rx.jpg");
  response = await storage.downloadObject(file, 60);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
  await response.body?.cancel();
});

test("ACL round-trips through object metadata and gates access", async () => {
  const storage = await service();
  const { objectStorageClient } = await import("./objectStorage.js");
  await objectStorageClient
    .bucket(BUCKET)
    .file("private/uploads/rx.jpg")
    .save(Buffer.from("prescription"), { contentType: "image/jpeg" });

  await storage.trySetObjectEntityAclPolicy("/objects/uploads/rx.jpg", {
    owner: "patient-1",
    visibility: "private",
  });

  const file = await storage.getObjectEntityFile("/objects/uploads/rx.jpg");

  assert.equal(
    await storage.canAccessObjectEntity({ userId: "patient-1", objectFile: file }),
    true,
    "owner may read their own prescription",
  );
  assert.equal(
    await storage.canAccessObjectEntity({ userId: "patient-2", objectFile: file }),
    false,
    "another patient may not",
  );
  assert.equal(
    await storage.canAccessObjectEntity({ objectFile: file }),
    false,
    "an anonymous caller may not",
  );
});

test("an object with no policy is readable by nobody", async () => {
  const storage = await service();
  const { objectStorageClient } = await import("./objectStorage.js");
  await objectStorageClient
    .bucket(BUCKET)
    .file("private/uploads/orphan.jpg")
    .save(Buffer.from("x"), { contentType: "image/jpeg" });

  const file = await storage.getObjectEntityFile("/objects/uploads/orphan.jpg");
  assert.equal(await storage.canAccessObjectEntity({ userId: "anyone", objectFile: file }), false);
});

test("a corrupt policy denies rather than opens access", async () => {
  const storage = await service();
  store.set("private/uploads/bad.jpg", {
    body: Buffer.from("x"),
    contentType: "image/jpeg",
    metadata: { "acl-policy": "{not json" },
  });

  const file = await storage.getObjectEntityFile("/objects/uploads/bad.jpg");
  assert.equal(await storage.canAccessObjectEntity({ userId: "patient-1", objectFile: file }), false);
});

test("presigned upload URL is accepted by the provider", async () => {
  const storage = await service();
  const { uploadUrl, objectPath } = await storage.getObjectEntityUploadInfo(
    "advertisements/banner.png",
  );

  assert.equal(objectPath, "/objects/advertisements/banner.png");
  assert.match(uploadUrl, /X-Amz-Signature=/);
  assert.match(uploadUrl, /X-Amz-Expires=900/);

  const upload = await fetch(uploadUrl, { method: "PUT", body: "png-bytes" });
  assert.equal(upload.status, 200, "provider should accept the presigned PUT");
  assert.deepEqual(rejected, [], "presigned signature must verify");

  const file = await storage.getObjectEntityFile(objectPath);
  const response = await storage.downloadObject(file);
  assert.equal(await response.text(), "png-bytes");
});

test("a tampered presigned URL is rejected", async () => {
  const storage = await service();
  const { uploadUrl } = await storage.getObjectEntityUploadInfo("advertisements/banner.png");

  // Repoint the URL at a different key, keeping the signature.
  const tampered = uploadUrl.replace("banner.png", "evil.png");
  const upload = await fetch(tampered, { method: "PUT", body: "x" });
  assert.equal(upload.status, 403);
  assert.equal(store.has("private/advertisements/evil.png"), false);
});

test("missing objects raise ObjectNotFoundError", async () => {
  const storage = await service();
  const { ObjectNotFoundError } = await import("./objectStorage.js");
  await assert.rejects(
    () => storage.getObjectEntityFile("/objects/uploads/absent.jpg"),
    ObjectNotFoundError,
  );
});

test("paths outside /objects/ and traversal attempts are refused", async () => {
  const storage = await service();
  const { ObjectNotFoundError } = await import("./objectStorage.js");

  for (const bad of [
    "uploads/photo.jpg",
    "/other/uploads/photo.jpg",
    "/objects/../private/secret.jpg",
    "/objects/..%2Fsecret.jpg".replace("%2F", "/"),
  ]) {
    await assert.rejects(
      () => storage.getObjectEntityFile(bad),
      ObjectNotFoundError,
      `should refuse ${bad}`,
    );
  }
});

test("upload URLs normalise back to stored object paths", async () => {
  const storage = await service();

  const { uploadUrl, objectPath } = await storage.getObjectEntityUploadInfo("team/alpha.jpg");
  assert.equal(storage.normalizeObjectEntityPath(uploadUrl), objectPath);

  // Already-normalised paths pass through untouched.
  assert.equal(storage.normalizeObjectEntityPath("/objects/team/alpha.jpg"), "/objects/team/alpha.jpg");

  // Legacy Google Cloud URLs from the previous provider still reduce.
  assert.equal(
    storage.normalizeObjectEntityPath(
      "https://storage.googleapis.com/bucket-id/private/team/alpha.jpg",
    ),
    "/objects/team/alpha.jpg",
  );
});

test("public objects are found across configured prefixes", async () => {
  const storage = await service();
  store.set("public/logo.png", {
    body: Buffer.from("logo"),
    contentType: "image/png",
    metadata: {},
  });

  const found = await storage.searchPublicObject("logo.png");
  assert.ok(found, "should find the object under the public prefix");
  assert.equal(found.key, "public/logo.png");

  assert.equal(await storage.searchPublicObject("absent.png"), null);
});

test("deleting an object entity removes it", async () => {
  const storage = await service();
  const { objectStorageClient, ObjectNotFoundError } = await import("./objectStorage.js");
  await objectStorageClient
    .bucket(BUCKET)
    .file("private/uploads/gone.jpg")
    .save(Buffer.from("x"), { contentType: "image/jpeg" });

  await storage.deleteObjectEntity("/objects/uploads/gone.jpg");
  await assert.rejects(
    () => storage.getObjectEntityFile("/objects/uploads/gone.jpg"),
    ObjectNotFoundError,
  );
});

test("keys with spaces and unicode survive signing and round-trip", async () => {
  const storage = await service();
  const { objectStorageClient } = await import("./objectStorage.js");
  const key = "private/uploads/Dr Koroma’s scan (1).jpg";

  await objectStorageClient
    .bucket(BUCKET)
    .file(key)
    .save(Buffer.from("scan"), { contentType: "image/jpeg" });

  assert.deepEqual(rejected, [], "encoded keys must still verify");

  const file = await storage.getObjectEntityFile("/objects/uploads/Dr Koroma’s scan (1).jpg");
  const response = await storage.downloadObject(file);
  assert.equal(await response.text(), "scan");
});
