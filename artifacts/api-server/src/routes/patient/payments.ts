import { safeRouter } from "../../lib/safeRouter.js";
import {
  SERVICE_FEE_BASIS_POINTS,
  SPLIT_PATIENT_SERVICE_FEE_BASIS_POINTS,
} from "../../lib/financialAllocation.js";
import { monimeEnabled } from "../../lib/monime/config.js";
import { monimeHealth } from "../../lib/monime/service.js";

const router = safeRouter();

// ── GET /patient/payments/config: how this site takes payment ────────────────
// The cart shows the matching service fee and payment wording before an order
// is placed. The order itself is always priced on the server.
router.get("/config", (_req, res) => {
  const viaMonime = monimeEnabled();
  res.json({
    provider: viaMonime ? "monime" : "direct",
    serviceFeeBasisPoints: viaMonime
      ? SPLIT_PATIENT_SERVICE_FEE_BASIS_POINTS
      : SERVICE_FEE_BASIS_POINTS,
    available: viaMonime ? monimeHealth().ok : true,
  });
});

export default router;
