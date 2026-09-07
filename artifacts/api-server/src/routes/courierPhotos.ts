import { safeRouter } from "../lib/safeRouter.js";
import { eq } from "drizzle-orm";
import { db, couriersTable } from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/storage/objectStorage.js";

const router = safeRouter();
const objectStorage = new ObjectStorageService();

/** Public, deliberately narrow route for portraits exposed in patient orders. */
router.get("/:id/photo", async (req, res) => {
  const [courier] = await db.select({ photoPath: couriersTable.photoPath })
    .from(couriersTable).where(eq(couriersTable.id, req.params.id as string)).limit(1);
  if (!courier?.photoPath) {
    res.status(404).json({ error: "Courier photo not found" });
    return;
  }
  try {
    const file = await objectStorage.getObjectEntityFile(courier.photoPath);
    const objectResponse = await objectStorage.downloadObject(file, 86_400);
    res.setHeader("Content-Type", objectResponse.headers.get("Content-Type") ?? "image/jpeg");
    res.setHeader("Cache-Control", objectResponse.headers.get("Cache-Control") ?? "public, max-age=86400");
    const reader = objectResponse.body!.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError && !res.headersSent) {
      res.status(404).json({ error: "Courier photo not found" });
      return;
    }
    throw error;
  }
});

export default router;