/**
 * Delivery pricing by distance, for HQ: the numbers in force, changing them
 * (from the next midnight), and the calculator that tries numbers on the map
 * without saving anything.
 */
import { z } from "zod";
import { safeRouter } from "../../lib/safeRouter.js";
import { AuthRequest, requireManageSettlements } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { cancelScheduledPricing, loadPricing, schedulePricing } from "../../lib/delivery/distanceQuote.js";
import { isLatitude, isLongitude } from "../../lib/geo.js";
import { TABLE_KM, priceByKm, type KmPricing } from "../../lib/delivery/kmPricing.js";
import { roadDistance } from "../../lib/delivery/roadDistance.js";

const router = safeRouter();

const point = z.object({ latitude: z.number().refine(isLatitude), longitude: z.number().refine(isLongitude) });
const money = z.number().min(0).max(100_000);
const pricing = z.object({
  fuelPricePerLitre: money,
  kmPerLitre: z.number().min(1).max(200),
  pickupLeones: money,
  serviceRatePerKm: money,
  riderSharePercent: z.number().min(0).max(100),
  roundToLeones: z.number().min(1).max(1000),
  minimumFeeLeones: money,
  maxKm: z.number().min(0.1).max(500).nullable(),
}).partial();

// ── POST /hq/delivery-pricing/preview ───────────────────────────────────────
// { from?, to?, pricing? } → the trip's distance and price, and a table of
// prices by distance, for the settings given (defaults where left out).
router.post("/preview", async (req, res) => {
  const body = z.object({ from: point.optional(), to: point.optional(), pricing: pricing.optional() }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Check the pins and the numbers: one of them is not valid." });
    return;
  }
  // Unless told otherwise, the numbers in force now.
  const settings: KmPricing = { ...(await loadPricing()).current, ...body.data.pricing };
  const { from, to } = body.data;
  const distance = from && to
    ? await roadDistance([from.longitude, from.latitude], [to.longitude, to.latitude])
    : null;
  res.json({
    pricing: settings,
    roadDistanceAvailable: Boolean(process.env["OPENROUTESERVICE_API_KEY"]),
    distance,
    quote: distance ? priceByKm(distance.km, settings) : null,
    table: TABLE_KM.map((km) => priceByKm(km, settings)),
  });
});

// ── GET /hq/delivery-pricing/settings ───────────────────────────────────────
router.get("/settings", async (_req, res) => {
  res.json(await loadPricing());
});

// ── Everything below changes the pricing ────────────────────────────────────
router.use(requireManageSettlements);

// ── PUT /hq/delivery-pricing/settings — new numbers from the next midnight ──
router.put("/settings", async (req: AuthRequest, res) => {
  const body = pricing.required().safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Check the numbers: each must be filled in, and the rider's share between 0 and 100." });
    return;
  }
  const before = await loadPricing();
  const state = await schedulePricing(body.data, req.pharmacy!.sub);
  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "delivery_pricing.schedule",
    entityType: "delivery_pricing",
    entityId: null,
    details: { from: before.current, to: body.data, effectiveFrom: state.scheduled?.effectiveFrom },
  });
  res.json(state);
});

// ── DELETE /hq/delivery-pricing/settings/scheduled — keep today's numbers ───
router.delete("/settings/scheduled", async (req: AuthRequest, res) => {
  const cancelled = await cancelScheduledPricing();
  if (cancelled) {
    await writeAudit({ actorType: "hq", actorId: req.pharmacy!.sub, actorName: req.pharmacy!.name, action: "delivery_pricing.cancel", entityType: "delivery_pricing", entityId: null, details: {} });
  }
  res.json(await loadPricing());
});

export default router;
