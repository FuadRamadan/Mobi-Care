import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db, prescriptionUploadsTable } from "@workspace/db";
import { AuthRequest } from "../../middlewares/auth.js";
import { objectStorageClient } from "../../lib/objectStorage.js";

const router = safeRouter();

// Local dev storage for prescription images (fallback when object storage is
// not configured). The imageKey prefix "local:" vs "cloud:" makes the storage
// backend explicit and swappable.
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads/prescriptions");

const DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_BYTES = 5 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Parse PRIVATE_OBJECT_DIR (e.g. "/bucket-id/private") into
 * { bucketName, dirPrefix } suitable for direct GCS uploads.
 */
function parsePrivateObjectDir(): { bucketName: string; dirPrefix: string } {
  const dir = process.env.PRIVATE_OBJECT_DIR ?? "";
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const parts = dir.replace(/^\//, "").split("/");
  const bucketName = parts[0]!;
  const dirPrefix = parts.slice(1).join("/");
  return { bucketName, dirPrefix };
}

/**
 * Upload a buffer directly to GCS (server-side) and return an imageKey of the
 * form "cloud:/objects/uploads/<uuid>.<ext>".
 */
async function uploadToCloud(buf: Buffer, ext: string, uuid: string): Promise<string> {
  const filename = `${uuid}.${ext}`;
  const { bucketName, dirPrefix } = parsePrivateObjectDir();
  const objectName = dirPrefix ? `${dirPrefix}/uploads/${filename}` : `uploads/${filename}`;
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);
  await file.save(buf, { contentType, resumable: false });

  // imageKey mirrors the /objects/ path the serving route understands
  return `cloud:/objects/uploads/${filename}`;
}

/**
 * POST /patient/uploads/prescription { image: "data:image/jpeg;base64,..." }
 * → { imageKey }
 *
 * The returned key is opaque to the client and later attached to an order.
 * Cloud storage (Replit App Storage) is used when PRIVATE_OBJECT_DIR is set;
 * otherwise falls back to local disk (useful for local dev without the env var).
 */
router.post("/prescription", async (req: AuthRequest, res) => {
  const body = z.object({ image: z.string().min(1) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "image (base64 data URL) is required" });
    return;
  }

  const match = DATA_URL_RE.exec(body.data.image);
  if (!match) {
    res.status(400).json({ error: "image must be a PNG, JPEG, or WebP data URL" });
    return;
  }

  const ext = match[1] === "jpeg" ? "jpg" : match[1]!;
  const buf = Buffer.from(match[2]!, "base64");
  if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) {
    res.status(400).json({ error: "image must be between 1 byte and 5 MB" });
    return;
  }

  const uuid = crypto.randomUUID();
  let imageKey: string;

  if (process.env.PRIVATE_OBJECT_DIR) {
    // Cloud path — durable across restarts
    imageKey = await uploadToCloud(buf, ext, uuid);
  } else {
    // Local fallback — MVP / local dev
    const filename = `${uuid}.${ext}`;
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(path.join(UPLOAD_DIR, filename), buf);
    imageKey = `local:${filename}`;
  }

  // Record ownership so order creation can verify the key belongs to this
  // patient and consume it exactly once (prevents forged/foreign keys).
  await db.insert(prescriptionUploadsTable).values({
    patientId: req.pharmacy!.sub,
    imageKey,
  });

  res.status(201).json({ imageKey });
});

export default router;
