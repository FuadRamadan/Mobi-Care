import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db, prescriptionUploadsTable } from "@workspace/db";
import { AuthRequest } from "../../middlewares/auth.js";

const router = Router();

// Local dev storage for prescription images. In production this must be an
// encrypted object store (see routes/prescriptionImages.ts) — the imageKey
// format "local:<file>" makes the storage backend explicit and swappable.
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads/prescriptions");

const DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /patient/uploads/prescription { image: "data:image/jpeg;base64,..." }
 * → { imageKey }
 *
 * The returned key is opaque to the client and later attached to an order.
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

  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const buf = Buffer.from(match[2]!, "base64");
  if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) {
    res.status(400).json({ error: "image must be between 1 byte and 5 MB" });
    return;
  }

  const filename = `${crypto.randomUUID()}.${ext}`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, filename), buf);

  // Record ownership so order creation can verify the key belongs to this
  // patient and consume it exactly once (prevents forged/foreign keys).
  const imageKey = `local:${filename}`;
  await db.insert(prescriptionUploadsTable).values({
    patientId: req.pharmacy!.sub,
    imageKey,
  });

  res.status(201).json({ imageKey });
});

export default router;
