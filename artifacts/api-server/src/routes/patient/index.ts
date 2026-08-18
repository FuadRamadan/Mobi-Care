import { Router } from "express";
import { patient } from "../../middlewares/auth.js";
import searchRouter from "./search.js";
import ordersRouter from "./orders.js";
import uploadsRouter from "./uploads.js";

const router = Router();

// All /patient/* routes require a valid patient-role access token.
// Data is always scoped to req.pharmacy.sub (the patient id) — a patient can
// never read or mutate another patient's orders.
router.use(...patient);

router.use("/search", searchRouter);
router.use("/orders", ordersRouter);
router.use("/uploads", uploadsRouter);

export default router;
