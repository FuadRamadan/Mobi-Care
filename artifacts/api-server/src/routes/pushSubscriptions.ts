/**
 * Turning browser notifications (Web Push) on and off, for the patient app
 * and the pharmacy portal. See lib/webPush.ts.
 */
import { z } from "zod";
import { safeRouter } from "../lib/safeRouter.js";
import type { AuthRequest } from "../middlewares/auth.js";
import { isPushEndpoint, removeSubscription, saveSubscription, webPushPublicKey } from "../lib/webPush.js";

type Owner = { patientId: string } | { pharmacyId: string };

const subscriptionBody = z.object({
  endpoint: z.string().refine(isPushEndpoint),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

/** GET /push/public-key: the key browsers subscribe with, or null when off. */
export const pushConfigRouter = safeRouter();
pushConfigRouter.get("/public-key", (_req, res) => {
  res.json({ publicKey: webPushPublicKey() });
});

/** POST / (turn on in this browser) and POST /remove (turn off). */
export function pushSubscriptionsRouter(ownerOf: (req: AuthRequest) => Owner) {
  const router = safeRouter();
  router.post("/", async (req: AuthRequest, res) => {
    if (!webPushPublicKey()) {
      res.status(503).json({ error: "Notifications are not available right now." });
      return;
    }
    const body = subscriptionBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "This browser cannot receive notifications." });
      return;
    }
    await saveSubscription(ownerOf(req), { ...body.data, userAgent: req.get("user-agent") });
    res.status(204).end();
  });
  router.post("/remove", async (req: AuthRequest, res) => {
    const body = z.object({ endpoint: z.string().min(1).max(1000) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "endpoint is required" });
      return;
    }
    await removeSubscription(ownerOf(req), body.data.endpoint);
    res.status(204).end();
  });
  return router;
}
