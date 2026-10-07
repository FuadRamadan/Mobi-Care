import { safeRouter } from "../../lib/safeRouter.js";
import {
  hq,
  requireManageIntegrations,
  requireManageSettlements,
  requireViewDataInsights,
} from "../../middlewares/auth.js";
import dashboardRouter from "./dashboard.js";
import ordersRouter, { dispatchHandler } from "./orders.js";
import pharmaciesRouter from "./pharmacies.js";
import { inventoryImportRouter } from "../inventoryImport.js";
import drugsRouter from "./drugs.js";
import catalogueImportRouter from "./catalogueImport.js";
import couriersRouter from "./couriers.js";
import flagsRouter from "./flags.js";
import settlementsRouter from "./settlements.js";
import auditRouter from "./audit.js";
import notificationsRouter from "./notifications.js";
import passwordPolicyRouter from "./passwordPolicy.js";
import teamRouter from "./team.js";
import apiConnectionsRouter from "./apiConnections.js";
import insightsRouter from "./insights.js";
import pilotResetRouter from "./pilotReset.js";
import exportsRouter from "./exports.js";
import advertisementsRouter from "./advertisements.js";
import deliveryZonesRouter from "./deliveryZones.js";
import securityRouter from "./security.js";

const router = safeRouter();

// Every /hq/* route requires a valid token with role 'hq' — server-side
// enforcement is the real boundary, not the frontend role check.
router.use(...hq);

router.use("/dashboard", dashboardRouter);
router.use("/orders", ordersRouter);
// Contract alias: GET /hq/dispatch (same handler as GET /hq/orders/dispatch)
router.get("/dispatch", dispatchHandler);
router.use("/pharmacies/:pharmacyId/inventory", inventoryImportRouter("hq"));
router.use("/pharmacies", pharmaciesRouter);
router.use("/drugs", catalogueImportRouter);
router.use("/drugs", drugsRouter);
router.use("/couriers", couriersRouter);
// Reading zones is open to HQ staff; changing them checks settlements
// permission inside the router.
router.use("/delivery-zones", deliveryZonesRouter);
router.use("/flags", flagsRouter);
router.use("/settlements", requireManageSettlements, settlementsRouter);
// Registered before /insights, which would otherwise match first and 404.
// Clearing the pilot data destroys the commission ledger as well as the
// reporting data, so it takes both permissions: seeing the numbers is not the
// same authority as deciding the money records were never real.
router.use(
  "/insights/reset",
  requireViewDataInsights,
  requireManageSettlements,
  pilotResetRouter,
);
router.use("/insights", requireViewDataInsights, insightsRouter);
router.use("/exports", requireViewDataInsights, exportsRouter);
router.use("/audit", auditRouter);
router.use("/notifications", notificationsRouter);
router.use("/password-policy", passwordPolicyRouter);
router.use("/team", teamRouter);
router.use("/advertisements", advertisementsRouter);
router.use(
  "/api-connections",
  requireManageIntegrations,
  apiConnectionsRouter,
);
router.use("/security", requireManageIntegrations, securityRouter);

export default router;
