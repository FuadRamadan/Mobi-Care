import { safeRouter } from "../../lib/safeRouter.js";
import { businessDateNow } from "../../lib/commissionSettlements.js";
import { hqOnlineFigures, validRange } from "../../lib/onlinePaymentFigures.js";
import { monimeEnabled } from "../../lib/monime/config.js";

const router = safeRouter();

// ── GET /hq/payments/online: MobiCare's online-payment figures ───────────────
// Per day (by payment date): money collected, refunds, the patients' service
// fees, the pharmacies' commission, delivery fees, Monime's fees and
// MobiCare's net. Plus money still waiting on orders, money owed to
// pharmacies, and refunds to pay by hand.
router.get("/online", async (req, res) => {
  const today = businessDateNow();
  const range = validRange(req.query.start ?? today, req.query.end ?? today);
  if (!range) {
    res.status(400).json({ error: "start and end must be YYYY-MM-DD, start first, at most 92 days apart" });
    return;
  }
  const figures = await hqOnlineFigures(range.start, range.end);
  res.json({ enabled: monimeEnabled(), today, ...figures });
});

export default router;
