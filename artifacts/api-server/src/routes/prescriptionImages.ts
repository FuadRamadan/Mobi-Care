/**
 * GET /api/prescription-images/:id
 *
 * Verifies the HMAC-signed URL token minted by POST /api/pharmacy/prescriptions/:id/image-url.
 * In production this route would stream from an encrypted object store (e.g. S3 SSE-KMS).
 * For this phase it validates the signature and returns a 501 indicating the storage
 * layer still needs to be wired up — integration is ready, storage is not.
 */
import { Router } from "express";
import { z } from "zod";
import { verifyImageToken } from "../lib/signedUrl.js";

const router = Router();

router.get("/:id", (req, res) => {
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
  const { id } = req.params;

  if (!verifyImageToken(id, variant, expires, sig)) {
    res.status(403).json({ error: "Invalid or expired image URL" });
    return;
  }

  // Signature is valid — token proves the caller is authorised.
  // TODO: fetch from encrypted object store using the prescription's imageKey.
  res.status(501).json({
    error: "Object storage not yet configured",
    message:
      "Signature verified. Wire up an encrypted object store (e.g. S3 SSE-KMS) and return a presigned read URL from here.",
  });
});

export default router;
