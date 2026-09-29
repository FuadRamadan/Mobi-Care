import { and, asc, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { db, advertisementMediaTable, advertisementsTable, type AdvertisementMedia } from "@workspace/db";
import { ListAdvertisementsResponse } from "@workspace/api-zod";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/storage/objectStorage.js";
import { safeRouter } from "../lib/safeRouter.js";
import { loadExtraMedia, mediaList } from "../lib/advertisementMedia.js";

const router = safeRouter();
const objectStorage = new ObjectStorageService();

function mediaUrl(id: string) {
  return `/api/advertisements/${id}/media`;
}

function publicAdvertisement(
  advertisement: typeof advertisementsTable.$inferSelect,
  extras: AdvertisementMedia[] = [],
) {
  return {
    id: advertisement.id,
    title: advertisement.title,
    alt: advertisement.alt,
    caption: advertisement.caption,
    organisation: advertisement.organisation,
    body: advertisement.body,
    media: mediaList(advertisement, extras),
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
  const extras = await loadExtraMedia(advertisements.map((advertisement) => advertisement.id));
  res.json(
    ListAdvertisementsResponse.parse(
      advertisements.map((advertisement) => publicAdvertisement(advertisement, extras.get(advertisement.id))),
    ),
  );
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

// GET /advertisements/:id/media/:mediaId — an extra picture, served only while
// its promotion is displayable.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/:id/media/:mediaId", async (req, res) => {
  if (!UUID.test(req.params.id as string) || !UUID.test(req.params.mediaId as string)) {
    res.status(404).json({ error: "Advertisement media not found" });
    return;
  }
  const now = new Date();
  const [media] = await db
    .select({ objectPath: advertisementMediaTable.objectPath })
    .from(advertisementMediaTable)
    .innerJoin(advertisementsTable, eq(advertisementsTable.id, advertisementMediaTable.advertisementId))
    .where(
      and(
        eq(advertisementMediaTable.id, req.params.mediaId as string),
        eq(advertisementsTable.id, req.params.id as string),
        eq(advertisementsTable.isActive, true),
        or(isNull(advertisementsTable.startsAt), lte(advertisementsTable.startsAt, now)),
        or(isNull(advertisementsTable.endsAt), gt(advertisementsTable.endsAt, now)),
      ),
    )
    .limit(1);
  if (!media) {
    res.status(404).json({ error: "Advertisement media not found" });
    return;
  }
  try {
    await pipeObjectToResponse(media.objectPath, res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError && !res.headersSent) {
      res.status(404).json({ error: "Advertisement media not found" });
      return;
    }
    throw error;
  }
});

export default router;