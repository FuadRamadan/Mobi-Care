import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db, prescriptionUploadsTable } from "@workspace/db";
import { AuthRequest } from "../../middlewares/auth.js";
import {
  isObjectStorageConfigured,
  ObjectStorageService,
} from "../../lib/objectStorage.js";

const router = safeRouter();
const objectStorage = new ObjectStorageService();

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
 * Upload a buffer to durable object storage and return an imageKey of the form
 * "cloud:/objects/uploads/<uuid>.<ext>".
 */
async function uploadToCloud(
  buf: Buffer,
  ext: string,
  uuid: string,
): Promise<string> {
  const objectPath = await objectStorage.uploadObjectEntity(
    `uploads/${uuid}.${ext}`,
    buf,
    MIME_TYPES[ext] ?? "application/octet-stream",
  );
  // imageKey mirrors the /objects/ path the serving route understands
  return `cloud:${objectPath}`;
}

/**
 * POST /patient/uploads/prescription { image: "data:image/jpeg;base64,..." }
 * → { imageKey }
 *
 * The returned key is opaque to the client and later attached to an order.
 * Durable object storage is used when it is configured; otherwise this falls
 * back to local disk, which is useful in development but does not survive a
 * restart.
 */
router.post("/prescription", async (req: AuthRequest, res) => {
  const body = z.object({ image: z.string().min(1) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "image (base64 data URL) is required" });
    return;
  }

  const match = DATA_URL_RE.exec(body.data.image);
  if (!match) {
    res
      .status(400)
      .json({ error: "image must be a PNG, JPEG, or WebP data URL" });
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

  if (isObjectStorageConfigured()) {
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
