import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import { courierPhotoUploadsTable, couriersTable, ordersTable } from "@workspace/db/schema";
import { and, eq, desc, sql, inArray, isNull } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { ObjectStorageService } from "../../lib/storage/objectStorage.js";
import { ObjectAclPolicy } from "../../lib/storage/objectAcl.js";

const router = safeRouter();
const objectStorage = new ObjectStorageService();
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const COURIER_PHOTO_PATH = /^\/objects\/courier-photos\/[0-9a-f-]{36}\.(jpg|png|webp)$/i;
const UPLOAD_TTL_MS = 15 * 60 * 1000;

function publicCourier(courier: typeof couriersTable.$inferSelect) {
  return {
    ...courier,
    photoPath: undefined,
    photoUrl: courier.photoPath
      ? `/api/couriers/${courier.id}/photo?v=${courier.updatedAt.getTime()}`
      : null,
  };
}

async function discardUpload(upload: typeof courierPhotoUploadsTable.$inferSelect, log: AuthRequest["log"]) {
  try {
    const file = await objectStorage.getObjectEntityFile(upload.objectPath);
    await file.delete({ ignoreNotFound: true });
  } catch (error) {
    if (!(error instanceof Error && error.name === "ObjectNotFoundError")) {
      log.warn(error, "Unable to remove unclaimed courier photo");
    }
  } finally {
    await db.delete(courierPhotoUploadsTable).where(eq(courierPhotoUploadsTable.id, upload.id));
  }
}

async function cleanExpiredUploads(log: AuthRequest["log"]) {
  const expired = await db.select().from(courierPhotoUploadsTable)
    .where(and(isNull(courierPhotoUploadsTable.consumedAt), sql`${courierPhotoUploadsTable.expiresAt} < now()`))
    .limit(25);
  await Promise.all(expired.map((upload) => discardUpload(upload, log)));
}

async function findCourier(id: string) {
  const [courier] = await db.select().from(couriersTable)
    .where(and(eq(couriersTable.id, id), isNull(couriersTable.deletedAt))).limit(1);
  return courier ?? null;
}

// ── GET /hq/couriers — fleet with live load ───────────────────────────────────
router.get("/", async (req: AuthRequest, res) => {
  await cleanExpiredUploads(req.log);
  const couriers = await db
    .select()
    .from(couriersTable)
    .where(isNull(couriersTable.deletedAt))
    .orderBy(desc(couriersTable.createdAt));

  const metrics = couriers.length
    ? await db
        .select({
          courierId: ordersTable.courierId,
          activeDeliveries: sql<number>`count(*) filter (where ${ordersTable.status} in ('assigned', 'picked_up', 'delivering'))::int`,
          completedDeliveries: sql<number>`count(*) filter (where ${ordersTable.status} = 'delivered')::int`,
          completedPayoutMinor: sql<number>`coalesce(sum(${ordersTable.courierPayoutMinor}) filter (where ${ordersTable.status} = 'delivered'), 0)::int`,
        })
        .from(ordersTable)
        .where(inArray(ordersTable.status, ["assigned", "picked_up", "delivering", "delivered"]))
        .groupBy(ordersTable.courierId)
    : [];
  const metricsByCourier = Object.fromEntries(
    metrics.map((row) => [row.courierId, row]),
  );

  res.json(
    couriers.map((c) => ({
      ...publicCourier(c),
      activeDeliveries: metricsByCourier[c.id]?.activeDeliveries ?? 0,
      completedDeliveries: metricsByCourier[c.id]?.completedDeliveries ?? 0,
      completedPayoutMinor: metricsByCourier[c.id]?.completedPayoutMinor ?? 0,
    })),
  );
});

// ── POST /hq/couriers — add courier ───────────────────────────────────────────
router.post("/", async (req: AuthRequest, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      phone: z.string().min(5),
      vehicleType: z
        .enum(["motorbike", "bicycle", "car", "van"])
        .default("motorbike"),
    })
    .safeParse(req.body);

  if (!body.success) {
    res
      .status(400)
      .json({ error: body.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const [existing] = await db
    .select({ id: couriersTable.id })
    .from(couriersTable)
    .where(eq(couriersTable.phone, body.data.phone))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "A courier with this phone already exists" });
    return;
  }

  const [created] = await db
    .insert(couriersTable)
    .values(body.data)
    .returning();

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "courier.create",
    entityType: "courier",
    entityId: created!.id,
    details: { name: created!.name, phone: created!.phone },
  });

  res.status(201).json({ ...publicCourier(created!), activeDeliveries: 0 });
});

// ── PATCH /hq/couriers/:id — activate/deactivate or edit ─────────────────────
router.patch("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const body = z
    .object({
      name: z.string().min(1).optional(),
      phone: z.string().min(5).optional(),
      vehicleType: z.enum(["motorbike", "bicycle", "car", "van"]).optional(),
      isActive: z.boolean().optional(),
    })
    .safeParse(req.body);

  if (!body.success || Object.keys(body.data).length === 0) {
    res.status(400).json({ error: "No valid fields provided" });
    return;
  }

  const [existing] = await db
    .select()
    .from(couriersTable)
    .where(and(eq(couriersTable.id, id), isNull(couriersTable.deletedAt)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Courier not found" });
    return;
  }

  if (body.data.phone && body.data.phone !== existing.phone) {
    const [phoneOwner] = await db
      .select({ id: couriersTable.id })
      .from(couriersTable)
      .where(eq(couriersTable.phone, body.data.phone))
      .limit(1);
    if (phoneOwner && phoneOwner.id !== id) {
      res.status(409).json({ error: "A courier with this phone already exists" });
      return;
    }
  }

  const [updated] = await db
    .update(couriersTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(couriersTable.id, id), isNull(couriersTable.deletedAt)))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "Courier changed concurrently — refresh and retry" });
    return;
  }

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "courier.update",
    entityType: "courier",
    entityId: id,
    details: { changes: body.data },
  });

  res.json(publicCourier(updated));
});

// ── POST /hq/couriers/:id/photo-upload — request direct App Storage upload ─
router.post("/:id/photo-upload", async (req: AuthRequest, res) => {
  await cleanExpiredUploads(req.log);
  const body = z.object({
    contentType: z.enum(SUPPORTED_IMAGE_TYPES),
    fileSize: z.number().int().positive().max(MAX_PHOTO_BYTES),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Use a JPG, PNG, or WebP image no larger than 5 MB" });
    return;
  }
  const courier = await findCourier(req.params.id as string);
  if (!courier) {
    res.status(404).json({ error: "Courier not found" });
    return;
  }
  const extension = body.data.contentType === "image/jpeg" ? "jpg" : body.data.contentType === "image/png" ? "png" : "webp";
  const upload = await objectStorage.getObjectEntityUploadInfo(`courier-photos/${crypto.randomUUID()}.${extension}`);
  await db.insert(courierPhotoUploadsTable).values({
    courierId: courier.id, requestedByHqStaffId: req.pharmacy!.sub,
    objectPath: upload.objectPath, contentType: body.data.contentType,
    fileSize: body.data.fileSize, expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
  });
  res.json(upload);
});

// ── PATCH /hq/couriers/:id/photo — attach a completed upload ───────────────
router.patch("/:id/photo", async (req: AuthRequest, res) => {
  await cleanExpiredUploads(req.log);
  const body = z.object({ objectPath: z.string().regex(COURIER_PHOTO_PATH, "Invalid courier photo upload path") }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid courier photo" });
    return;
  }
  const courier = await findCourier(req.params.id as string);
  if (!courier) {
    res.status(404).json({ error: "Courier not found" });
    return;
  }
  const [upload] = await db.select().from(courierPhotoUploadsTable).where(and(
    eq(courierPhotoUploadsTable.courierId, courier.id),
    eq(courierPhotoUploadsTable.requestedByHqStaffId, req.pharmacy!.sub),
    eq(courierPhotoUploadsTable.objectPath, body.data.objectPath),
    isNull(courierPhotoUploadsTable.consumedAt),
    sql`${courierPhotoUploadsTable.expiresAt} > now()`,
  )).limit(1);
  if (!upload) {
    res.status(400).json({ error: "This upload is expired or was not requested for you" });
    return;
  }
  try {
    const file = await objectStorage.getObjectEntityFile(upload.objectPath);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size ?? 0);
    const contentType = String(metadata.contentType ?? "").toLowerCase();
    if (!SUPPORTED_IMAGE_TYPES.includes(contentType as (typeof SUPPORTED_IMAGE_TYPES)[number]) || size <= 0 || size > MAX_PHOTO_BYTES || size !== upload.fileSize || contentType !== upload.contentType) {
      await discardUpload(upload, req.log);
      res.status(400).json({ error: "Uploaded file must be a JPG, PNG, or WebP image no larger than 5 MB" });
      return;
    }
    const policy: ObjectAclPolicy = { owner: req.pharmacy!.sub, visibility: "public" };
    const photoPath = await objectStorage.trySetObjectEntityAclPolicy(upload.objectPath, policy);
    const [updated] = await db.transaction(async (tx) => {
      const [result] = await tx.update(couriersTable).set({ photoPath, updatedAt: new Date() })
        .where(and(eq(couriersTable.id, courier.id), isNull(couriersTable.deletedAt))).returning();
      await tx.update(courierPhotoUploadsTable).set({ consumedAt: new Date() }).where(eq(courierPhotoUploadsTable.id, upload.id));
      return [result];
    });
    if (!updated) {
      res.status(409).json({ error: "Courier changed concurrently — refresh and retry" });
      return;
    }
    if (courier.photoPath && COURIER_PHOTO_PATH.test(courier.photoPath)) {
      try {
        const previous = await objectStorage.getObjectEntityFile(courier.photoPath);
        await previous.delete({ ignoreNotFound: true });
      } catch (error) {
        if (!(error instanceof Error && error.name === "ObjectNotFoundError")) req.log.warn(error, "Unable to remove replaced courier photo");
      }
    }
    await writeAudit({ actorType: "hq", actorId: req.pharmacy!.sub, actorName: req.pharmacy!.name, action: "courier.photo_update", entityType: "courier", entityId: courier.id, details: { name: courier.name } });
    res.json(publicCourier(updated));
  } catch (error) {
    if (error instanceof Error && error.name === "ObjectNotFoundError") {
      res.status(404).json({ error: "Uploaded photo was not found. Please upload it again." });
      return;
    }
    throw error;
  }
});

// ── DELETE /hq/couriers/:id/photo — detach and remove photo ────────────────
router.delete("/:id/photo", async (req: AuthRequest, res) => {
  const courier = await findCourier(req.params.id as string);
  if (!courier) {
    res.status(404).json({ error: "Courier not found" });
    return;
  }
  if (!courier.photoPath) {
    res.status(404).json({ error: "Courier photo not found" });
    return;
  }
  const [updated] = await db.update(couriersTable).set({ photoPath: null, updatedAt: new Date() })
    .where(and(eq(couriersTable.id, courier.id), eq(couriersTable.photoPath, courier.photoPath))).returning();
  if (!updated) {
    res.status(409).json({ error: "Courier changed concurrently — refresh and retry" });
    return;
  }
  if (COURIER_PHOTO_PATH.test(courier.photoPath)) {
    try {
      const file = await objectStorage.getObjectEntityFile(courier.photoPath);
      await file.delete({ ignoreNotFound: true });
    } catch (error) {
      if (!(error instanceof Error && error.name === "ObjectNotFoundError")) req.log.warn(error, "Unable to remove courier photo");
    }
  }
  await writeAudit({ actorType: "hq", actorId: req.pharmacy!.sub, actorName: req.pharmacy!.name, action: "courier.photo_remove", entityType: "courier", entityId: courier.id, details: { name: courier.name } });
  res.json(publicCourier(updated));
});

// ── DELETE /hq/couriers/:id — retire a courier from the fleet ─────────────────
router.delete("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;

  const result = await db.transaction(async (tx) => {
    // Assignment also locks this row. That makes retire-vs-assign deterministic:
    // once retired, no new assignment can commit against this courier.
    const [existing] = await tx
      .select({ id: couriersTable.id, name: couriersTable.name })
      .from(couriersTable)
      .where(and(eq(couriersTable.id, id), isNull(couriersTable.deletedAt)))
      .for("update")
      .limit(1);
    if (!existing) return { kind: "not_found" as const };

    const [load] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.courierId, id),
          inArray(ordersTable.status, ["assigned", "picked_up", "delivering"]),
        ),
      );
    if ((load?.count ?? 0) > 0) return { kind: "active" as const };

    const now = new Date();
    const [retired] = await tx
      .update(couriersTable)
      .set({ isActive: false, deletedAt: now, updatedAt: now })
      .where(and(eq(couriersTable.id, id), isNull(couriersTable.deletedAt)))
      .returning({ id: couriersTable.id });

    return retired
      ? { kind: "retired" as const, courier: existing }
      : { kind: "conflict" as const };
  });

  if (result.kind === "not_found") {
    res.status(404).json({ error: "Courier not found" });
    return;
  }
  if (result.kind === "active") {
    res.status(409).json({
      error: "Cannot delete a courier with active deliveries. Reassign those orders first.",
    });
    return;
  }
  if (result.kind === "conflict") {
    res.status(409).json({ error: "Courier changed concurrently — refresh and retry" });
    return;
  }

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "courier.delete",
    entityType: "courier",
    entityId: id,
    details: { name: result.courier.name },
  });

  res.json({ message: "Courier deleted" });
});

export default router;
