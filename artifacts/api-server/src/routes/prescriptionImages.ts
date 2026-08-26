/**
 * GET /api/prescription-images/:id
 *
 * Verifies the HMAC-signed URL token minted by POST /api/pharmacy/prescriptions/:id/image-url,
 * then streams the prescription image.
 *
 * Key prefix semantics:
 *   "local:<filename>"           — served from local disk (dev / legacy records)
 *   "cloud:/objects/uploads/…"   — streamed from Replit App Storage (GCS)
 */
import { safeRouter } from "../lib/safeRouter.js";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import { db, prescriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyImageToken } from "../lib/signedUrl.js";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../lib/objectStorage.js";

const router = safeRouter();

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads/prescriptions");
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const objectStorage = new ObjectStorageService();

/**
 * Parse a "cloud:/objects/uploads/<filename>" key and stream the GCS object.
 * Re-uses ObjectStorageService.getObjectEntityFile() which validates the path
 * and checks for existence, then streams via downloadObject().
 */
async function serveCloudImage(
  imageKey: string,
  res: import("express").Response,
): Promise<void> {
  // imageKey = "cloud:/objects/uploads/<uuid>.<ext>"
  const objectPath = imageKey.slice("cloud:".length); // "/objects/uploads/<uuid>.<ext>"

  // Defense-in-depth: objectPath must be inside /objects/uploads/ and be a uuid.ext filename
  const filename = objectPath.split("/").pop() ?? "";
  if (!/^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(filename)) {
    res.status(404).json({ error: "Image not found" });
    return;
  }

  const objectFile = await objectStorage.getObjectEntityFile(objectPath);
  const webResponse = await objectStorage.downloadObject(objectFile, 60);

  res.setHeader(
    "Content-Type",
    webResponse.headers.get("Content-Type") ?? "application/octet-stream",
  );
  res.setHeader(
    "Cache-Control",
    webResponse.headers.get("Cache-Control") ?? "private, max-age=60",
  );

  const reader = webResponse.body!.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}

router.get("/:id", async (req, res) => {
  const query = z
    .object({
      variant: z.enum(["preview", "full"]).default("preview"),
      expires: z.coerce.number().int(),
      sig: z.string().min(1),
    })
    .safeParse(req.query);

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

  const { imageKey } = rx;

  // ── Cloud storage (Replit App Storage / GCS) ──────────────────────────────
  if (imageKey.startsWith("cloud:")) {
    try {
      await serveCloudImage(imageKey, res as any);
    } catch (err) {
      if (err instanceof ObjectNotFoundError && !res.headersSent) {
        res.status(404).json({ error: "Image not found in cloud storage" });
        return;
      }
      throw err;
    }
    return;
  }

  // ── Local disk (legacy / dev fallback) ───────────────────────────────────
  if (imageKey.startsWith("local:")) {
    // Defense-in-depth: the stored filename must be a plain uuid.ext — never
    // allow path traversal even though keys are server-generated.
    const filename = imageKey.slice("local:".length);
    if (!/^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(filename)) {
      res.status(404).json({ error: "Image not found" });
      return;
    }

    try {
      const buf = await fs.readFile(path.join(UPLOAD_DIR, filename));
      res.setHeader(
        "Content-Type",
        CONTENT_TYPES[path.extname(filename).toLowerCase()] ??
          "application/octet-stream",
      );
      res.setHeader("Cache-Control", "private, max-age=60");
      res.send(buf);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        res.status(404).json({ error: "Image file not found" });
        return;
      }
      throw error;
    }
    return;
  }

  // Unknown prefix
  res.status(501).json({
    error: "Unsupported image key format",
    message: `imageKey prefix not recognized: ${imageKey.split(":")[0]}`,
  });
});

export default router;
