import { safeRouter } from "../../lib/safeRouter.js";
import { eq } from "drizzle-orm";
import { db, pharmaciesTable } from "@workspace/db";
import { pharmacy } from "../../middlewares/auth.js";
import ordersRouter from "./orders.js";
import inventoryRouter from "./inventory.js";
import { inventoryImportRouter } from "../inventoryImport.js";
import catalogueRouter from "./catalogue.js";
import prescriptionsRouter from "./prescriptions.js";
import notificationsRouter from "./notifications.js";
import analyticsRouter from "./analytics.js";
import payoutsRouter from "./payouts.js";
import prescriptionRequestsRouter from "./prescriptionRequests.js";
import { touchPharmacy } from "../../lib/prescriptionRequests.js";
import { pushSubscriptionsRouter } from "../pushSubscriptions.js";
import type { AuthRequest } from "../../middlewares/auth.js";

const router = safeRouter();

// All /pharmacy/* routes require a valid pharmacy-role access token.
// Data is always scoped to req.pharmacy.sub — never trust a pharmacyId from the client.
router.use(...pharmacy);

// The portal polls while it is open: record that, so prescription requests
// go only to pharmacies that are actually watching (lib/prescriptionRequests.ts).
router.use((req: AuthRequest, _res, next) => {
  if (req.pharmacy?.sub) void touchPharmacy(req.pharmacy.sub).catch(() => {});
  next();
});

// GET /pharmacy/me: the account details the portal shows (Profile, the
// sidebar). A new tab has only the sign-in token, which does not carry them.
router.get("/me", async (req: AuthRequest, res) => {
  const [p] = await db.select().from(pharmaciesTable).where(eq(pharmaciesTable.id, req.pharmacy!.sub)).limit(1);
  if (!p) { res.status(404).json({ error: "Not found" }); return; }
  res.json({
    id: p.id,
    role: "pharmacy",
    name: p.name,
    username: p.username,
    phone: p.phone,
    controlledSubstanceAuthorized: p.controlledSubstanceAuthorized,
    mustChangePassword: p.mustChangePassword,
    passwordLastChangedAt: p.passwordLastChangedAt.toISOString(),
  });
});

router.use("/orders", ordersRouter);
// Before the listing routes, so /inventory/export is not read as a listing id.
router.use("/inventory", inventoryImportRouter("pharmacy"));
router.use("/inventory", inventoryRouter);
router.use("/catalogue", catalogueRouter);
router.use("/prescriptions", prescriptionsRouter);
router.use("/notifications", notificationsRouter);
router.use("/analytics", analyticsRouter);
router.use("/payouts", payoutsRouter);
router.use("/prescription-requests", prescriptionRequestsRouter);
router.use("/push-subscriptions", pushSubscriptionsRouter((req: AuthRequest) => ({ pharmacyId: req.pharmacy!.sub })));

export default router;
