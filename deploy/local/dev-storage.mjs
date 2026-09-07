/**
 * S3-compatible object storage for local development.
 *
 * Lets photos work locally — prescriptions, profile pictures, courier and team
 * photos, advertisements — without an account anywhere. The API talks to this
 * exactly as it will talk to S3, R2 or B2 in production: same adapter, same
 * signing, same presigned uploads. Nothing dev-only is compiled into the app.
 *
 * Objects are kept on disk under --dir so they survive a restart, which is what
 * you want when checking that an uploaded photo is still there afterwards.
 *
 * Deliberately does NOT verify signatures. It is bound to localhost and exists
 * to make development easy; the real providers do the verifying, and the
 * signing itself is covered by tests. Never expose this.
 *
 *   node deploy/local/dev-storage.mjs --port 9000 --dir .local-storage
 */

import { createServer } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const PORT = Number(option("port", "9000"));
const ROOT = path.resolve(option("dir", ".local-storage"));
const BUCKET = option("bucket", "mobicare-media");

/** Map an object key to a file, refusing anything that escapes the root. */
function resolveKey(key) {
  const target = path.resolve(ROOT, key);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;
  return target;
}

/** Metadata lives beside the object; S3 keeps it on the object itself. */
const metaPath = (file) => `${file}.meta.json`;

async function readMeta(file) {
  try {
    return JSON.parse(await readFile(metaPath(file), "utf8"));
  } catch {
    return { contentType: "application/octet-stream", metadata: {} };
  }
}

function collectMetadata(headers) {
  const metadata = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase().startsWith("x-amz-meta-")) {
      metadata[name.slice("x-amz-meta-".length).toLowerCase()] = String(value);
    }
  }
  return metadata;
}

function metadataHeaders(meta) {
  return Object.fromEntries(
    Object.entries(meta.metadata ?? {}).map(([k, v]) => [`x-amz-meta-${k}`, v]),
  );
}

const xmlError = (code, message) =>
  `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Browsers upload directly here with a presigned PUT, so preflight must pass.
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,PUT,HEAD,DELETE,OPTIONS",
      "access-control-allow-headers": "*",
      "access-control-max-age": "86400",
    });
    res.end();
    return;
  }
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-expose-headers", "*");

  if (url.pathname === "/__health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", bucket: BUCKET, root: ROOT }));
    return;
  }

  // Path-style addressing: /<bucket>/<key>
  const withoutBucket = url.pathname.replace(new RegExp(`^/${BUCKET}/?`), "");
  const key = decodeURIComponent(withoutBucket);
  const file = key ? resolveKey(key) : null;

  if (!file) {
    res.writeHead(400, { "content-type": "application/xml" });
    res.end(xmlError("InvalidRequest", "Missing or unsafe object key"));
    return;
  }

  try {
    switch (req.method) {
      case "PUT": {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);

        const copySource = req.headers["x-amz-copy-source"];
        if (copySource) {
          // Metadata replace: S3 does this as a copy onto the same key.
          const sourceKey = decodeURIComponent(
            String(copySource).replace(new RegExp(`^/?${BUCKET}/`), ""),
          );
          const sourceFile = resolveKey(sourceKey);
          if (!sourceFile) {
            res.writeHead(404, { "content-type": "application/xml" });
            res.end(xmlError("NoSuchKey", "Source not found"));
            return;
          }
          const existing = await readMeta(sourceFile);
          const content = await readFile(sourceFile);
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, content);
          await writeFile(
            metaPath(file),
            JSON.stringify({
              contentType: String(req.headers["content-type"] ?? existing.contentType),
              metadata: collectMetadata(req.headers),
            }),
          );
          res.writeHead(200, { "content-type": "application/xml" });
          res.end("<CopyObjectResult></CopyObjectResult>");
          return;
        }

        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, body);
        await writeFile(
          metaPath(file),
          JSON.stringify({
            contentType: String(req.headers["content-type"] ?? "application/octet-stream"),
            metadata: collectMetadata(req.headers),
          }),
        );
        res.writeHead(200);
        res.end();
        return;
      }

      case "HEAD":
      case "GET": {
        const info = await stat(file).catch(() => null);
        if (!info?.isFile()) {
          res.writeHead(404, { "content-type": "application/xml" });
          res.end(req.method === "GET" ? xmlError("NoSuchKey", "Not found") : undefined);
          return;
        }
        const meta = await readMeta(file);
        res.writeHead(200, {
          "content-type": meta.contentType,
          "content-length": String(info.size),
          etag: `"${info.mtimeMs.toString(16)}-${info.size.toString(16)}"`,
          ...metadataHeaders(meta),
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(await readFile(file));
        return;
      }

      case "DELETE": {
        await rm(file, { force: true });
        await rm(metaPath(file), { force: true });
        res.writeHead(204);
        res.end();
        return;
      }

      default:
        res.writeHead(405, { "content-type": "application/xml" });
        res.end(xmlError("MethodNotAllowed", `${req.method} is not supported`));
    }
  } catch (error) {
    res.writeHead(500, { "content-type": "application/xml" });
    res.end(xmlError("InternalError", error?.message ?? String(error)));
  }
});

await mkdir(ROOT, { recursive: true });
server.listen(PORT, "127.0.0.1", () => {
  console.log(`dev object storage on http://127.0.0.1:${PORT} (bucket ${BUCKET}, files in ${ROOT})`);
});
