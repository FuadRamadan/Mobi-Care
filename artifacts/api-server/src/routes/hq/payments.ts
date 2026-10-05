import { safeRouter } from "../../lib/safeRouter.js";
import { businessDateNow } from "../../lib/commissionSettlements.js";
import { hqOnlineFigures, validRange } from "../../lib/onlinePaymentFigures.js";
import { z } from "zod";
import { monimeEnabled } from "../../lib/monime/config.js";
import {
  approveCashout,
  cashoutView,
  hqPayoutsOverview,
  PayoutRefused,
  rejectCashout,
  retryTransfer,
} from "../../lib/monime/payouts.js";
import { AuthRequest } from "../../middlewares/auth.js";

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

// ── Payouts (Monime phase 2) ───────────────────────────────────────────────

function refused(res: import("express").Response, err: unknown): boolean {
  if (!(err instanceof PayoutRefused)) return false;
  res.status(err.httpStatus).json({ error: err.message, code: err.code, ...err.details });
  return true;
}
const validId = (id: string) => z.string().uuid().safeParse(id).success;
const actorOf = (req: AuthRequest) => ({ id: req.pharmacy!.sub, name: req.pharmacy!.name });

// GET /hq/payments/payouts: pharmacy balances, cash-outs to approve, recent
// cash-outs, money that couldn't be released, and Monime's own balances.
router.get("/payouts", async (_req, res) => {
  res.json({ enabled: monimeEnabled(), ...(await hqPayoutsOverview()) });
});

router.post("/cashouts/:id/approve", async (req: AuthRequest, res) => {
  const id = String(req.params.id);
  if (!validId(id)) {
    res.status(404).json({ error: "Cash-out not found" });
    return;
  }
  try {
    res.json(cashoutView(await approveCashout(id, actorOf(req))));
  } catch (err) {
    if (!refused(res, err)) throw err;
  }
});

router.post("/cashouts/:id/reject", async (req: AuthRequest, res) => {
  const id = String(req.params.id);
  const body = z.object({ reason: z.string().trim().min(3).max(300) }).safeParse(req.body);
  if (!validId(id) || !body.success) {
    res.status(400).json({ error: "Give a short reason the pharmacy will see" });
    return;
  }
  try {
    res.json(cashoutView(await rejectCashout(id, body.data.reason, actorOf(req))));
  } catch (err) {
    if (!refused(res, err)) throw err;
  }
});

router.post("/transfers/:id/retry", async (req: AuthRequest, res) => {
  const id = String(req.params.id);
  if (!validId(id)) {
    res.status(404).json({ error: "Transfer not found" });
    return;
  }
  try {
    const row = await retryTransfer(id, actorOf(req));
    res.json({ transferId: row.id, status: row.status, attempt: row.attempt });
  } catch (err) {
    if (!refused(res, err)) throw err;
  }
});

export default router;
