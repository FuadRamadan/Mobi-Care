import express, { type Express } from "express";
import { handleWebhook } from "../lib/monime/service.js";
import { logger } from "../lib/logger.js";

/**
 * POST /api/webhooks/monime: Monime's notifications.
 *
 * Mounted before the JSON body parser, so the body arrives exactly as Monime
 * sent it (the signature, once checked, is over the raw bytes).
 */
export function mountMonimeWebhook(app: Express): void {
  app.post(
    "/api/webhooks/monime",
    express.raw({ type: "*/*", limit: "256kb" }),
    async (req, res) => {
      try {
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
        const result = await handleWebhook(body, req.headers);
        res.status(result.status).json(result.body);
      } catch (err) {
        logger.error({ err }, "Monime webhook failed");
        res.status(500).json({ error: "Processing failed" });
      }
    },
  );
}
