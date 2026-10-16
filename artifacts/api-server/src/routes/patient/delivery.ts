import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import { pharmaciesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { isLatitude, isLongitude } from "../../lib/geo.js";
import { roundCoordinate } from "../../lib/delivery/pricing.js";
import { DISTANCE_UNAVAILABLE, quoteByDistance } from "../../lib/delivery/distanceQuote.js";

const router = safeRouter();

// ── GET /patient/delivery/coverage ──────────────────────────────────────────
// Delivery is priced by distance now, not by zone, so there are no areas to
// shade. Kept, empty, for apps that still ask.
router.get("/coverage", async (_req: AuthRequest, res) => {
  res.json([]);
});

// ── POST /patient/delivery/quote — the delivery fee to a pinned spot ────────
// The same calculation order placement uses, so the fee shown is the fee
// charged unless it changes at midnight in between.
const quoteSchema = z.object({
  pharmacyId: z.string().uuid(),
  latitude: z.number().refine(isLatitude),
  longitude: z.number().refine(isLongitude),
});

router.post("/quote", async (req: AuthRequest, res) => {
  const body = quoteSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "pharmacyId, latitude and longitude are required" });
    return;
  }
  const [pharmacy] = await db
    .select()
    .from(pharmaciesTable)
    .where(eq(pharmaciesTable.id, body.data.pharmacyId))
    .limit(1);
  if (!pharmacy || !pharmacy.isActive) {
    res.status(404).json({ error: "Pharmacy not found or inactive" });
    return;
  }
  const quote = await quoteByDistance(pharmacy, [
    roundCoordinate(body.data.longitude),
    roundCoordinate(body.data.latitude),
  ]);
  res.json(
    quote.available
      ? {
          available: true,
          deliveryFeeMinor: quote.feeMinor,
          zoneName: quote.areaName,
          fromZoneName: null,
          message: null,
          distanceKm: quote.km,
          distanceEstimated: quote.method === "estimate",
          maxKm: quote.maxKm,
        }
      : {
          available: false,
          deliveryFeeMinor: null,
          zoneName: null,
          fromZoneName: null,
          message: quote.reason === "too_far" ? DISTANCE_UNAVAILABLE.too_far(quote.km, quote.maxKm) : DISTANCE_UNAVAILABLE.pharmacy_not_located,
          distanceKm: quote.reason === "too_far" ? quote.km : null,
          distanceEstimated: false,
          maxKm: quote.reason === "too_far" ? quote.maxKm : null,
        },
  );
});

export default router;
