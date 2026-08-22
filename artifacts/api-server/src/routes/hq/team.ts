import { safeRouter } from "../../lib/safeRouter.js";
import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db, teamMembersTable, teamPhotoUploadsTable } from "@workspace/db";
import { ObjectStorageService } from "../../lib/objectStorage.js";
import { ObjectAclPolicy } from "../../lib/objectAcl.js";
import { writeAudit } from "../../lib/audit.js";
import { ensureTeamMembers } from "../../lib/teamMembers.js";
import { AuthRequest } from "../../middlewares/auth.js";

const router = safeRouter();
const objectStorage = new ObjectStorageService();
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const TEAM_PHOTO_PATH = /^\/objects\/team-photos\/[0-9a-f-]{36}\.(jpg|png|webp)$/i;
const UPLOAD_TTL_MS = 15 * 60 * 1000;

function publicMember(member: typeof teamMembersTable.$inferSelect) {
  return {
    id: member.id,
    name: member.name,
    role: member.role,
    photoUrl: member.photoPath
      ? `/api/team/${member.id}/photo?v=${member.updatedAt.getTime()}`
      : null,
  };
}

async function findMember(id: string) {
  const [member] = await db
    .select()
    .from(teamMembersTable)
    .where(eq(teamMembersTable.id, id))
    .limit(1);
  return member ?? null;
}

async function discardUpload(
  upload: typeof teamPhotoUploadsTable.$inferSelect,
): Promise<void> {
  try {
    const file = await objectStorage.getObjectEntityFile(upload.objectPath);
    await file.delete({ ignoreNotFound: true });
  } catch (error) {
    if (!(error instanceof Error && error.name === "ObjectNotFoundError")) {
      console.error("Unable to remove unclaimed team photo", error);
    }
  } finally {
    await db.delete(teamPhotoUploadsTable).where(eq(teamPhotoUploadsTable.id, upload.id));
  }
}

/** Removes abandoned signed-upload targets so they cannot accumulate in storage. */
async function cleanExpiredUploads(): Promise<void> {
  const expiredUploads = await db
    .select()
    .from(teamPhotoUploadsTable)
    .where(
      and(
        isNull(teamPhotoUploadsTable.consumedAt),
        lt(teamPhotoUploadsTable.expiresAt, new Date()),
      ),
    )
    .limit(25);
  await Promise.all(expiredUploads.map(discardUpload));
}

// ── GET /hq/team ───────────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
  await cleanExpiredUploads();
  await ensureTeamMembers();
  const members = await db
    .select()
    .from(teamMembersTable)
    .orderBy(asc(teamMembersTable.sortOrder));
  res.json(members.map(publicMember));
});

// ── POST /hq/team/:id/photo-upload — request direct object-storage upload ─
router.post("/:id/photo-upload", async (req: AuthRequest, res) => {
  await cleanExpiredUploads();
  const body = z.object({
    contentType: z.enum(SUPPORTED_IMAGE_TYPES),
    fileSize: z.number().int().positive().max(MAX_PHOTO_BYTES),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({
      error: "Use a JPG, PNG, or WebP image no larger than 5 MB",
    });
    return;
  }

  const member = await findMember(req.params.id as string);
  if (!member) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }

  const extension = body.data.contentType === "image/jpeg"
    ? "jpg"
    : body.data.contentType === "image/png"
      ? "png"
      : "webp";
  const upload = await objectStorage.getObjectEntityUploadInfo(
    `team-photos/${crypto.randomUUID()}.${extension}`,
  );
  await db.insert(teamPhotoUploadsTable).values({
    teamMemberId: member.id,
    requestedByHqStaffId: req.pharmacy!.sub,
    objectPath: upload.objectPath,
    contentType: body.data.contentType,
    fileSize: body.data.fileSize,
    expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
  });
  res.json(upload);
});

// ── PATCH /hq/team/:id/photo — attach completed upload to member ───────────
router.patch("/:id/photo", async (req: AuthRequest, res) => {
  await cleanExpiredUploads();
  const body = z.object({
    objectPath: z.string().regex(
      TEAM_PHOTO_PATH,
      "Invalid team photo upload path",
    ),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid team photo" });
    return;
  }

  const member = await findMember(req.params.id as string);
  if (!member) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }

  try {
    const [upload] = await db
      .select()
      .from(teamPhotoUploadsTable)
      .where(
        and(
          eq(teamPhotoUploadsTable.teamMemberId, member.id),
          eq(teamPhotoUploadsTable.requestedByHqStaffId, req.pharmacy!.sub),
          eq(teamPhotoUploadsTable.objectPath, body.data.objectPath),
          isNull(teamPhotoUploadsTable.consumedAt),
          gt(teamPhotoUploadsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!upload) {
      res.status(400).json({ error: "This upload is expired or was not requested for you" });
      return;
    }

    const file = await objectStorage.getObjectEntityFile(body.data.objectPath);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size ?? 0);
    const contentType = String(metadata.contentType ?? "").toLowerCase();
    if (
      !SUPPORTED_IMAGE_TYPES.includes(contentType as (typeof SUPPORTED_IMAGE_TYPES)[number]) ||
      size <= 0 ||
      size > MAX_PHOTO_BYTES ||
      size !== upload.fileSize ||
      contentType !== upload.contentType
    ) {
      await discardUpload(upload);
      res.status(400).json({ error: "Uploaded file must be a JPG, PNG, or WebP image no larger than 5 MB" });
      return;
    }

    const policy: ObjectAclPolicy = {
      owner: req.pharmacy!.sub,
      visibility: "public",
    };
    const photoPath = await objectStorage.trySetObjectEntityAclPolicy(
      body.data.objectPath,
      policy,
    );
    const [updated] = await db.transaction(async (tx) => {
      const [result] = await tx
        .update(teamMembersTable)
        .set({ photoPath, updatedAt: new Date() })
        .where(eq(teamMembersTable.id, member.id))
        .returning();
      await tx
        .update(teamPhotoUploadsTable)
        .set({ consumedAt: new Date() })
        .where(eq(teamPhotoUploadsTable.id, upload.id));
      return [result];
    });

    // Replaced UUID-named uploads are no longer reachable after the update.
    if (member.photoPath && TEAM_PHOTO_PATH.test(member.photoPath)) {
      try {
        const previousFile = await objectStorage.getObjectEntityFile(member.photoPath);
        await previousFile.delete({ ignoreNotFound: true });
      } catch (error) {
        if (!(error instanceof Error && error.name === "ObjectNotFoundError")) {
          req.log.warn(error, "Unable to remove replaced team photo");
        }
      }
    }

    await writeAudit({
      actorType: "hq",
      actorId: req.pharmacy!.sub,
      actorName: req.pharmacy!.name,
      action: "team_member.photo_update",
      entityType: "team_member",
      entityId: member.id,
      details: { name: member.name },
    });

    res.json(publicMember(updated!));
  } catch (error) {
    if (error instanceof Error && error.name === "ObjectNotFoundError") {
      res.status(404).json({ error: "Uploaded photo was not found. Please upload it again." });
      return;
    }
    throw error;
  }
});

export default router;