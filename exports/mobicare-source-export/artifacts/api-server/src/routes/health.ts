import { HealthCheckResponse } from "@workspace/api-zod";
import { safeRouter } from "../lib/safeRouter.js";

const router = safeRouter();

router.get("/", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
