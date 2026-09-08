import { safeRouter } from "../../lib/safeRouter.js";
import { patient } from "../../middlewares/auth.js";
import searchRouter from "./search.js";
import ordersRouter from "./orders.js";
import uploadsRouter from "./uploads.js";
import notificationsRouter from "./notifications.js";
import profileRouter from "./profile.js";
import privacyRouter from "./privacy.js";
import { requireCurrentConsent } from "../../lib/patientConsent.js";

const router = safeRouter();

// All /patient/* routes require a valid patient-role access token.
// Data is always scoped to req.pharmacy.sub (the patient id) — a patient can
// never read or mutate another patient's orders.
router.use(...patient);

// Consent, export and erasure are reachable whatever the consent state. A
// patient who has withdrawn consent, or who has not yet accepted a new policy
// version, must still be able to see what is held about them and remove it.
router.use("/privacy", privacyRouter);

// Everything else may be read freely, but nothing new is created for a patient
// who has not accepted the current terms. The gate lets GET through; see
// lib/patientConsent.ts.
router.use(requireCurrentConsent());

router.use("/search", searchRouter);
router.use("/orders", ordersRouter);
router.use("/uploads", uploadsRouter);
router.use("/notifications", notificationsRouter);
router.use("/profile", profileRouter);

export default router;
