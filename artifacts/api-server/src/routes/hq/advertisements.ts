import { and, asc, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { advertisementUploadsTable, advertisementsTable, db } from "@workspace/db";
import {
  CreateHqAdvertisementResponse,
  ListHqAdvertisementsResponse,
  RequestHqAdvertisementUploadResponse,
  UpdateHqAdvertisementResponse,
} from "@workspace/api-zod";
import { ObjectAclPolicy } from "../../lib/objectAcl.js";
import { ObjectStorageService } from "../../lib/objectStorage.js";
import { writeAudit } from "../../lib/audit.js";
import { AuthRequest } from "../../middlewares/auth.js";
import { safeRouter } from "../../lib/safeRouter.js";

const router = safeRouter();
const objectStorage = new ObjectStorageService();
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const VIDEO_TYPES = ["video/mp4"] as const;
const CONTENT_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES] as const;
const MAX_BYTES: Record<(typeof CONTENT_TYPES)[number], number> = {
  "image/jpeg": 10 * 1024 * 1024, "image/png": 10 * 1024 * 1024, "image/webp": 10 * 1024 * 1024,
  "video/mp4": 50 * 1024 * 1024,
};
const ADVERTISEMENT_PATH = /^\/objects\/advertisements\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|mp4)$/i;
const UPLOAD_TTL_MS = 15 * 60 * 1000;

const nullableText = z.string().trim().max(500).nullable().optional();
const scheduleFields = {
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
};
const linkUrl = z.string().url().refine((value) => /^https?:\/\//i.test(value), "Link URL must use http or https").nullable().optional();
const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  alt: nullableText,
  caption: nullableText,
  objectPath: z.string().regex(ADVERTISEMENT_PATH, "Invalid advertisement upload path"),
  linkUrl,
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  ...scheduleFields,
}).refine((value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, "End time must be after start time");
const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  alt: nullableText,
  caption: nullableText,
  linkUrl,
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  ...scheduleFields,
}).refine((value) => Object.keys(value).length > 0, "No changes provided")
  .refine((value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, "End time must be after start time");

function extension(contentType: (typeof CONTENT_TYPES)[number]) {
  return contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1];
}

function mediaKind(contentType: (typeof CONTENT_TYPES)[number]) {
  return contentType.startsWith("image/") ? "image" : "video";
}

function response(advertisement: typeof advertisementsTable.$inferSelect) {
  return {
    id: advertisement.id, title: advertisement.title, alt: advertisement.alt, caption: advertisement.caption,
    mediaKind: advertisement.mediaKind, contentType: advertisement.contentType, fileSize: advertisement.fileSize,
    linkUrl: advertisement.linkUrl, isActive: advertisement.isActive, sortOrder: advertisement.sortOrder,
    startsAt: advertisement.startsAt, endsAt: advertisement.endsAt, createdByHqStaffId: advertisement.createdByHqStaffId,
    createdAt: advertisement.createdAt, updatedAt: advertisement.updatedAt,
    mediaUrl: `/api/advertisements/${advertisement.id}/media`,
  };
}

async function discardUpload(upload: typeof advertisementUploadsTable.$inferSelect, log: AuthRequest["log"]) {
  try {
    const file = await objectStorage.getObjectEntityFile(upload.objectPath);
    await file.delete({ ignoreNotFound: true });
  } catch (error) {
    if (!(error instanceof Error && error.name === "ObjectNotFoundError")) log.warn(error, "Unable to remove unclaimed advertisement media");
  } finally {
    await db.delete(advertisementUploadsTable).where(eq(advertisementUploadsTable.id, upload.id));
  }
}

async function cleanExpiredUploads(log: AuthRequest["log"]) {
  const uploads = await db.select().from(advertisementUploadsTable)
    .where(and(isNull(advertisementUploadsTable.consumedAt), lt(advertisementUploadsTable.expiresAt, new Date()))).limit(25);
  await Promise.all(uploads.map((upload) => discardUpload(upload, log)));
}

router.get("/", async (req: AuthRequest, res) => {
  await cleanExpiredUploads(req.log);
  const advertisements = await db.select().from(advertisementsTable)
    .orderBy(asc(advertisementsTable.sortOrder), desc(advertisementsTable.createdAt));
  res.json(ListHqAdvertisementsResponse.parse(advertisements.map(response)));
});

router.post("/upload", async (req: AuthRequest, res) => {
  await cleanExpiredUploads(req.log);
  const body = z.object({ contentType: z.enum(CONTENT_TYPES), fileSize: z.number().int().positive() }).safeParse(req.body);
  if (!body.success || body.data.fileSize > MAX_BYTES[body.data.contentType]) {
    res.status(400).json({ error: "Use a JPG, PNG, or WebP image up to 10 MB, or an MP4 video up to 50 MB" });
    return;
  }
  const upload = await objectStorage.getObjectEntityUploadInfo(`advertisements/${crypto.randomUUID()}.${extension(body.data.contentType)}`);
  const [uploadClaim] = await db
    .insert(advertisementUploadsTable)
    .values({
      requestedByHqStaffId: req.pharmacy!.sub,
      objectPath: upload.objectPath,
      contentType: body.data.contentType,
      fileSize: body.data.fileSize,
      expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
    })
    .returning({ id: advertisementUploadsTable.id });
  await writeAudit({ actorType: "hq", actorId: req.pharmacy!.sub, actorName: req.pharmacy!.name,
    action: "advertisement.upload_requested", entityType: "advertisement_upload", entityId: uploadClaim!.id, details: { contentType: body.data.contentType, fileSize: body.data.fileSize } });
  res.json(RequestHqAdvertisementUploadResponse.parse(upload));
});

router.post("/", async (req: AuthRequest, res) => {
  await cleanExpiredUploads(req.log);
  const body = createSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid advertisement" }); return; }
  const [upload] = await db.select().from(advertisementUploadsTable).where(and(
    eq(advertisementUploadsTable.requestedByHqStaffId, req.pharmacy!.sub), eq(advertisementUploadsTable.objectPath, body.data.objectPath),
    isNull(advertisementUploadsTable.consumedAt), gt(advertisementUploadsTable.expiresAt, new Date()),
  )).limit(1);
  if (!upload) { res.status(400).json({ error: "This upload is expired or was not requested for you" }); return; }
  try {
    const file = await objectStorage.getObjectEntityFile(upload.objectPath);
    const [metadata] = await file.getMetadata();
    const actualType = String(metadata.contentType ?? "").toLowerCase();
    const actualSize = Number(metadata.size ?? 0);
    if (!CONTENT_TYPES.includes(actualType as (typeof CONTENT_TYPES)[number]) || actualType !== upload.contentType || actualSize !== upload.fileSize || actualSize <= 0 || actualSize > MAX_BYTES[upload.contentType as (typeof CONTENT_TYPES)[number]]) {
      await discardUpload(upload, req.log);
      res.status(400).json({ error: "Uploaded file metadata does not match the requested media" });
      return;
    }
    await objectStorage.trySetObjectEntityAclPolicy(upload.objectPath, { owner: req.pharmacy!.sub, visibility: "public" } satisfies ObjectAclPolicy);
    const created = await db.transaction(async (tx) => {
      // Locking the claim makes consume-and-create a single-use operation even
      // when two requests race with the same signed upload target.
      const [claimed] = await tx.select().from(advertisementUploadsTable).where(
        eq(advertisementUploadsTable.id, upload.id),
      ).for("update").limit(1);
      if (
        !claimed ||
        claimed.consumedAt ||
        claimed.requestedByHqStaffId !== req.pharmacy!.sub ||
        claimed.expiresAt <= new Date()
      ) {
        return null;
      }
      const [advertisement] = await tx.insert(advertisementsTable).values({
        title: body.data.title, alt: body.data.alt ?? null, caption: body.data.caption ?? null, objectPath: upload.objectPath,
        contentType: upload.contentType, fileSize: upload.fileSize, mediaKind: mediaKind(upload.contentType as (typeof CONTENT_TYPES)[number]),
        linkUrl: body.data.linkUrl ?? null, isActive: body.data.isActive ?? true, sortOrder: body.data.sortOrder ?? 0,
        startsAt: body.data.startsAt ?? null, endsAt: body.data.endsAt ?? null, createdByHqStaffId: req.pharmacy!.sub,
      }).returning();
      await tx.update(advertisementUploadsTable).set({ consumedAt: new Date() }).where(eq(advertisementUploadsTable.id, upload.id));
      return advertisement!;
    });
    if (!created) {
      res.status(400).json({ error: "This upload is expired or was already used" });
      return;
    }
    await writeAudit({ actorType: "hq", actorId: req.pharmacy!.sub, actorName: req.pharmacy!.name, action: "advertisement.create", entityType: "advertisement", entityId: created.id, details: { title: created.title, mediaKind: created.mediaKind } });
    res.status(201).json(CreateHqAdvertisementResponse.parse(response(created)));
  } catch (error) {
    if (error instanceof Error && error.name === "ObjectNotFoundError") { res.status(404).json({ error: "Uploaded media was not found. Please upload it again." }); return; }
    throw error;
  }
});

router.patch("/:id", async (req: AuthRequest, res) => {
  const body = patchSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid advertisement" }); return; }
  const [existing] = await db.select().from(advertisementsTable).where(eq(advertisementsTable.id, req.params.id as string)).limit(1);
  if (!existing) { res.status(404).json({ error: "Advertisement not found" }); return; }
  const startsAt = body.data.startsAt === undefined ? existing.startsAt : body.data.startsAt;
  const endsAt = body.data.endsAt === undefined ? existing.endsAt : body.data.endsAt;
  if (startsAt && endsAt && endsAt <= startsAt) { res.status(400).json({ error: "End time must be after start time" }); return; }
  const [updated] = await db.update(advertisementsTable).set({ ...body.data, updatedAt: new Date() }).where(eq(advertisementsTable.id, existing.id)).returning();
  await writeAudit({ actorType: "hq", actorId: req.pharmacy!.sub, actorName: req.pharmacy!.name, action: "advertisement.update", entityType: "advertisement", entityId: existing.id, details: { fields: Object.keys(body.data) } });
  res.json(UpdateHqAdvertisementResponse.parse(response(updated!)));
});

router.delete("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const [existing] = await db
    .update(advertisementsTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(advertisementsTable.id, id))
    .returning();
  if (!existing) { res.status(404).json({ error: "Advertisement not found" }); return; }
  try {
    const file = await objectStorage.getObjectEntityFile(existing.objectPath);
    await file.delete({ ignoreNotFound: true });
  } catch (error) {
    if (!(error instanceof Error && error.name === "ObjectNotFoundError")) {
      req.log.warn(error, "Unable to remove advertisement media; advertisement remains inactive for retry");
      res.status(503).json({ error: "Media cleanup is temporarily unavailable. The advertisement was deactivated; retry deletion shortly." });
      return;
    }
  }
  await db.delete(advertisementsTable).where(eq(advertisementsTable.id, id));
  await writeAudit({ actorType: "hq", actorId: req.pharmacy!.sub, actorName: req.pharmacy!.name, action: "advertisement.delete", entityType: "advertisement", entityId: existing.id, details: { title: existing.title } });
  res.json({ message: "Advertisement deleted" });
});

export default router;