import { safeRouter } from "../lib/safeRouter.js";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import pharmacyRouter from "./pharmacy/index.js";
import hqRouter from "./hq/index.js";
import patientRouter from "./patient/index.js";
import notificationsRouter from "./pharmacy/notifications.js";
import prescriptionImagesRouter from "./prescriptionImages.js";
import teamRouter from "./team.js";
import { pharmacy } from "../middlewares/auth.js";

const router = safeRouter();

router.use("/healthz", healthRouter);
router.use("/auth", authRouter);
router.use("/pharmacy", pharmacyRouter);
router.use("/hq", hqRouter);
router.use("/patient", patientRouter);

// /notifications is not prefixed with /pharmacy in the frontend API contract
// but still requires pharmacy auth
router.use("/notifications", ...pharmacy, notificationsRouter);

router.use("/prescription-images", prescriptionImagesRouter);
router.use("/team", teamRouter);

export default router;
