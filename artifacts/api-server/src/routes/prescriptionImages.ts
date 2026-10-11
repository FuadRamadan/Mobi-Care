/**
 * GET /api/prescription-images/:id
 *
 * Verifies the HMAC-signed URL token minted by POST /api/pharmacy/prescriptions/:id/image-url,
 * then sends the prescription image.
 *
 * The pharmacy portal now uses GET /api/pharmacy/prescriptions/:id/file
 * instead; this stays for links opened by portals loaded before that change.
 */
import { safeRouter } from "../lib/safeRouter.js";
import { z } from "zod";
import { db, prescriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyImageToken } from "../lib/signedUrl.js";
import { PrescriptionFileMissing, readPrescriptionFile } from "../lib/prescriptionFiles.js";

const router = safeRouter();

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
    .select({ imageKey: prescriptionsTable.imageKey, fileDeletedAt: prescriptionsTable.fileDeletedAt })
    .from(prescriptionsTable)
    .where(eq(prescriptionsTable.id, id))
    .limit(1);
  if (!rx) {
    res.status(404).json({ error: "Prescription not found" });
    return;
  }
  if (rx.fileDeletedAt) {
    res.status(410).json({ error: "This prescription was removed from MobiCare after the pharmacy downloaded it." });
    return;
  }

  try {
    const file = await readPrescriptionFile(rx.imageKey);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(file.bytes);
  } catch (error) {
    if (error instanceof PrescriptionFileMissing) {
      res.status(404).json({ error: "Image file not found" });
      return;
    }
    throw error;
  }
});

export default router;
