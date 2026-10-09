import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import { pharmaciesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { isLatitude, isLongitude } from "../../lib/geo.js";
import { roundCoordinate, UNAVAILABLE_MESSAGES } from "../../lib/delivery/pricing.js";
import { loadZones, pricedZones, quoteForPharmacy } from "../../lib/delivery/zones.js";

const router = safeRouter();

// ── GET /patient/delivery/coverage — the areas MobiCare delivers to ─────────
// Outlines only, so checkout can shade them on the map.
router.get("/coverage", async (_req: AuthRequest, res) => {
  const zones = pricedZones(await loadZones());
  res.json(zones.map((zone) => ({ name: zone.name, boundary: zone.boundary })));
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
  const quote = await quoteForPharmacy(pharmacy, [
    roundCoordinate(body.data.longitude),
    roundCoordinate(body.data.latitude),
  ]);
  res.json(
    quote.available
      ? {
          available: true,
          deliveryFeeMinor: quote.feeMinor,
          zoneName: quote.zoneName,
          fromZoneName: quote.pricing === "cross_zone" ? quote.pharmacyZoneName : null,
          message: null,
        }
      : {
          available: false,
          deliveryFeeMinor: null,
          zoneName: null,
          fromZoneName: null,
          message: UNAVAILABLE_MESSAGES[quote.reason],
        },
  );
});

export default router;
