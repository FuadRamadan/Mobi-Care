import { z } from "zod";
import { db } from "@workspace/db";
import { pharmaciesTable, pharmacyCashoutsTable } from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";
import { safeRouter } from "../../lib/safeRouter.js";
import { AuthRequest } from "../../middlewares/auth.js";
import { monimeEnabled } from "../../lib/monime/config.js";
import {
  cancelCashout,
  cashoutView,
  payoutDestinations,
  pharmacyBalance,
  PayoutRefused,
  recentReleases,
  requestCashout,
} from "../../lib/monime/payouts.js";
import {
  CASHOUT_APPROVAL_THRESHOLD_MINOR,
  MIN_CASHOUT_MINOR,
  PAYOUT_FEE_BASIS_POINTS,
} from "../../lib/monime/payoutRules.js";

const router = safeRouter();

function refused(res: import("express").Response, err: unknown): boolean {
  if (!(err instanceof PayoutRefused)) return false;
  res.status(err.httpStatus).json({ error: err.message, code: err.code, ...err.details });
  return true;
}

// ── GET /pharmacy/payouts: balance, where cash-outs go, history ─────────────
// From the pharmacy's side only: its own share of each order, never the
// patient's service fee or total.
router.get("/", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;
  const [pharmacy] = await db.select().from(pharmaciesTable).where(eq(pharmaciesTable.id, pharmacyId)).limit(1);
  if (!pharmacy) {
    res.status(404).json({ error: "Pharmacy not found" });
    return;
  }
  const [balance, releases, cashouts] = await Promise.all([
    pharmacyBalance(pharmacyId),
    recentReleases(pharmacyId),
    db
      .select()
      .from(pharmacyCashoutsTable)
      .where(eq(pharmacyCashoutsTable.pharmacyId, pharmacyId))
      .orderBy(desc(pharmacyCashoutsTable.createdAt))
      .limit(30),
  ]);
  const hasActivity = releases.length > 0 || cashouts.length > 0 || balance.waitingMinor > 0;
  res.json({
    enabled: monimeEnabled() || hasActivity,
    canCashOut: monimeEnabled(),
    balance,
    destinations: payoutDestinations(pharmacy),
    feeBasisPoints: PAYOUT_FEE_BASIS_POINTS,
    minCashoutMinor: MIN_CASHOUT_MINOR,
    approvalThresholdMinor: CASHOUT_APPROVAL_THRESHOLD_MINOR,
    releases,
    cashouts: cashouts.map(cashoutView),
  });
});

// ── POST /pharmacy/payouts/cashouts: cash out to a registered number ─────────
// The pharmacy picks a network and an amount; the number is always the one HQ
// registered, never one sent in the request.
router.post("/cashouts", async (req: AuthRequest, res) => {
  const body = z
    .object({ amountMinor: z.number().int().positive(), provider: z.enum(["m17", "m18"]) })
    .strict()
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Choose a network and an amount" });
    return;
  }
  try {
    const cashout = await requestCashout(req.pharmacy!.sub, body.data);
    res.status(201).json(cashoutView(cashout));
  } catch (err) {
    if (!refused(res, err)) throw err;
  }
});

// ── POST /pharmacy/payouts/cashouts/:id/cancel: withdraw while awaiting approval
router.post("/cashouts/:id/cancel", async (req: AuthRequest, res) => {
  const id = String(req.params.id);
  if (!z.string().uuid().safeParse(id).success) {
    res.status(404).json({ error: "Cash-out not found" });
    return;
  }
  try {
    res.json(cashoutView(await cancelCashout(id, req.pharmacy!.sub)));
  } catch (err) {
    if (!refused(res, err)) throw err;
  }
});

export default router;
