import { safeRouter } from "../lib/safeRouter.js";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import { db, patientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyProfileImageToken } from "../lib/signedUrl.js";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";

const router = safeRouter();
const PROFILE_UPLOAD_DIR = path.resolve(process.cwd(), "uploads/profiles");
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
const objectStorage = new ObjectStorageService();

router.get("/:id", async (req, res) => {
  const query = z.object({ expires: z.coerce.number().int(), sig: z.string().min(1) }).safeParse(req.query);
  if (!query.success || !verifyProfileImageToken(req.params.id as string, query.data.expires, query.data.sig)) {
    res.status(403).json({ error: "Invalid or expired profile image URL" });
    return;
  }
  const [patient] = await db
    .select({ profileImageKey: patientsTable.profileImageKey })
    .from(patientsTable)
    .where(eq(patientsTable.id, req.params.id as string))
    .limit(1);
  if (!patient?.profileImageKey) {
    res.status(404).json({ error: "Profile image not found" });
    return;
  }

  if (patient.profileImageKey.startsWith("cloud:")) {
    const filename = patient.profileImageKey.split("/").pop() ?? "";
    if (!/^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(filename)) {
      res.status(404).json({ error: "Profile image not found" });
      return;
    }
    try {
      const file = await objectStorage.getObjectEntityFile(`/objects/profile-uploads/${filename}`);
      const response = await objectStorage.downloadObject(file, 60);
      res.setHeader("Content-Type", response.headers.get("Content-Type") ?? "application/octet-stream");
      const reader = response.body!.getReader();
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
        res.status(404).json({ error: "Profile image not found" });
        return;
      }
      throw error;
    }
    return;
  }

  const filename = patient.profileImageKey.replace("local:", "");
  if (!/^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(filename)) {
    res.status(404).json({ error: "Profile image not found" });
    return;
  }
  try {
    res.setHeader("Content-Type", CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(await fs.readFile(path.join(PROFILE_UPLOAD_DIR, filename)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      res.status(404).json({ error: "Profile image not found" });
      return;
    }
    throw error;
  }
});

export default router;