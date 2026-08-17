import { Router } from "express";
import { pharmacy } from "../../middlewares/auth.js";
import ordersRouter from "./orders.js";
import inventoryRouter from "./inventory.js";
import catalogueRouter from "./catalogue.js";
import prescriptionsRouter from "./prescriptions.js";
import notificationsRouter from "./notifications.js";
import analyticsRouter from "./analytics.js";

const router = Router();

// All /pharmacy/* routes require a valid pharmacy-role access token.
// Data is always scoped to req.pharmacy.sub — never trust a pharmacyId from the client.
router.use(...pharmacy);

router.use("/orders", ordersRouter);
router.use("/inventory", inventoryRouter);
router.use("/catalogue", catalogueRouter);
router.use("/prescriptions", prescriptionsRouter);
router.use("/notifications", notificationsRouter);
router.use("/analytics", analyticsRouter);

export default router;
