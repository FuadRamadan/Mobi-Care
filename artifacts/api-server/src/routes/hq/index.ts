import { Router } from "express";
import { hq } from "../../middlewares/auth.js";
import dashboardRouter from "./dashboard.js";
import ordersRouter, { dispatchHandler } from "./orders.js";
import pharmaciesRouter from "./pharmacies.js";
import drugsRouter from "./drugs.js";
import couriersRouter from "./couriers.js";
import flagsRouter from "./flags.js";
import settlementsRouter from "./settlements.js";
import auditRouter from "./audit.js";
import notificationsRouter from "./notifications.js";
import passwordPolicyRouter from "./passwordPolicy.js";
import teamRouter from "./team.js";

const router = Router();

// Every /hq/* route requires a valid token with role 'hq' — server-side
// enforcement is the real boundary, not the frontend role check.
router.use(...hq);

router.use("/dashboard", dashboardRouter);
router.use("/orders", ordersRouter);
// Contract alias: GET /hq/dispatch (same handler as GET /hq/orders/dispatch)
router.get("/dispatch", dispatchHandler);
router.use("/pharmacies", pharmaciesRouter);
router.use("/drugs", drugsRouter);
router.use("/couriers", couriersRouter);
router.use("/flags", flagsRouter);
router.use("/settlements", settlementsRouter);
router.use("/audit", auditRouter);
router.use("/notifications", notificationsRouter);
router.use("/password-policy", passwordPolicyRouter);
router.use("/team", teamRouter);

export default router;
