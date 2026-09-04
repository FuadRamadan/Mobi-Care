import { and, asc, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { db, advertisementsTable } from "@workspace/db";
import { ListAdvertisementsResponse } from "@workspace/api-zod";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage.js";
import { safeRouter } from "../lib/safeRouter.js";

const router = safeRouter();
const objectStorage = new ObjectStorageService();

function mediaUrl(id: string) {
  return `/api/advertisements/${id}/media`;
}

function publicAdvertisement(advertisement: typeof advertisementsTable.$inferSelect) {
  return {
    id: advertisement.id,
    title: advertisement.title,
    alt: advertisement.alt,
    caption: advertisement.caption,
    mediaKind: advertisement.mediaKind,
    contentType: advertisement.contentType,
    fileSize: advertisement.fileSize,
    linkUrl: advertisement.linkUrl,
    sortOrder: advertisement.sortOrder,
    startsAt: advertisement.startsAt,
    endsAt: advertisement.endsAt,
    createdAt: advertisement.createdAt,
    mediaUrl: mediaUrl(advertisement.id),
  };
}

async function pipeObjectToResponse(objectPath: string, res: import("express").Response) {
  const file = await objectStorage.getObjectEntityFile(objectPath);
  const objectResponse = await objectStorage.downloadObject(file, 0);
  res.setHeader("Content-Type", objectResponse.headers.get("Content-Type") ?? "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
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
}

// GET /advertisements — currently displayable patient advertisements.
router.get("/", async (_req, res) => {
  const now = new Date();
  const advertisements = await db
    .select()
    .from(advertisementsTable)
    .where(
      and(
        eq(advertisementsTable.isActive, true),
        or(isNull(advertisementsTable.startsAt), lte(advertisementsTable.startsAt, now)),
        or(isNull(advertisementsTable.endsAt), gt(advertisementsTable.endsAt, now)),
      ),
    )
    .orderBy(asc(advertisementsTable.sortOrder), desc(advertisementsTable.createdAt));
  res.json(ListAdvertisementsResponse.parse(advertisements.map(publicAdvertisement)));
});

// GET /advertisements/:id/media — object access is always mediated by an ad row.
router.get("/:id/media", async (req, res) => {
  const now = new Date();
  const [advertisement] = await db
    .select({ objectPath: advertisementsTable.objectPath })
    .from(advertisementsTable)
    .where(
      and(
        eq(advertisementsTable.id, req.params.id as string),
        eq(advertisementsTable.isActive, true),
        or(isNull(advertisementsTable.startsAt), lte(advertisementsTable.startsAt, now)),
        or(isNull(advertisementsTable.endsAt), gt(advertisementsTable.endsAt, now)),
      ),
    )
    .limit(1);
  if (!advertisement) {
    res.status(404).json({ error: "Advertisement media not found" });
    return;
  }
  try {
    await pipeObjectToResponse(advertisement.objectPath, res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError && !res.headersSent) {
      res.status(404).json({ error: "Advertisement media not found" });
      return;
    }
    throw error;
  }
});

export default router;