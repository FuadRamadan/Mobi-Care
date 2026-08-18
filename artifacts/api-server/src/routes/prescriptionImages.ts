/**
 * GET /api/prescription-images/:id
 *
 * Verifies the HMAC-signed URL token minted by POST /api/pharmacy/prescriptions/:id/image-url,
 * then streams the prescription image. `local:` keys are served from local
 * disk (dev/MVP storage); in production this would stream from an encrypted
 * object store (e.g. S3 SSE-KMS) — the key prefix makes the backend swappable.
 */
import { Router } from "express";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import { db, prescriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyImageToken } from "../lib/signedUrl.js";

const router = Router();

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads/prescriptions");
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

router.get("/:id", async (req, res) => {
  const query = z.object({
    variant: z.enum(["preview", "full"]).default("preview"),
    expires: z.coerce.number().int(),
    sig: z.string().min(1),
  }).safeParse(req.query);

  if (!query.success) {
    res.status(400).json({ error: "Invalid or missing signed URL parameters" });
    return;
  }

  const { variant, expires, sig } = query.data;
  const id = req.params.id as string;

  if (!verifyImageToken(id, variant, expires, sig)) {
    res.status(403).json({ error: "Invalid or expired image URL" });
    return;
  }

  // Signature is valid — token proves the caller is authorised.
  const [rx] = await db
    .select({ imageKey: prescriptionsTable.imageKey })
    .from(prescriptionsTable)
    .where(eq(prescriptionsTable.id, id))
    .limit(1);
  if (!rx) {
    res.status(404).json({ error: "Prescription not found" });
    return;
  }

  if (!rx.imageKey.startsWith("local:")) {
    res.status(501).json({
      error: "Object storage not yet configured",
      message: "Only local: image keys are servable in this phase.",
    });
    return;
  }

  // Defense-in-depth: the stored filename must be a plain uuid.ext — never
  // allow path traversal even though keys are server-generated.
  const filename = rx.imageKey.slice("local:".length);
  if (!/^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(filename)) {
    res.status(404).json({ error: "Image not found" });
    return;
  }

  try {
    const buf = await fs.readFile(path.join(UPLOAD_DIR, filename));
    res.setHeader("Content-Type", CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(buf);
  } catch {
    res.status(404).json({ error: "Image file not found" });
  }
});

export default router;
