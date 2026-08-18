import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { patientNotificationsTable } from "@workspace/db/schema";
import { eq, and, isNull, desc, inArray } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";

const router = Router();

// ── GET /patient/notifications — list notifications for the authenticated patient ──
router.get("/", async (req: AuthRequest, res) => {
  const patientId = req.pharmacy!.sub;

  const notifications = await db
    .select()
    .from(patientNotificationsTable)
    .where(eq(patientNotificationsTable.patientId, patientId))
    .orderBy(desc(patientNotificationsTable.createdAt))
    .limit(50);

  res.json(notifications);
});

// ── GET /patient/notifications/unread-count ───────────────────────────────────
router.get("/unread-count", async (req: AuthRequest, res) => {
  const patientId = req.pharmacy!.sub;

  const rows = await db
    .select({ id: patientNotificationsTable.id })
    .from(patientNotificationsTable)
    .where(
      and(
        eq(patientNotificationsTable.patientId, patientId),
        isNull(patientNotificationsTable.readAt)
      )
    );

  res.json({ unreadCount: rows.length });
});

// ── POST /patient/notifications/mark-read ────────────────────────────────────
// Body: { ids?: string[] } — omit ids to mark ALL as read
router.post("/mark-read", async (req: AuthRequest, res) => {
  const patientId = req.pharmacy!.sub;
  const body = z
    .object({ ids: z.array(z.string().uuid()).optional() })
    .safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "ids must be an array of UUIDs if provided" });
    return;
  }

  const now = new Date();

  if (body.data.ids && body.data.ids.length > 0) {
    await db
      .update(patientNotificationsTable)
      .set({ readAt: now })
      .where(
        and(
          eq(patientNotificationsTable.patientId, patientId),
          inArray(patientNotificationsTable.id, body.data.ids),
          isNull(patientNotificationsTable.readAt)
        )
      );
  } else {
    // Mark all unread notifications as read
    await db
      .update(patientNotificationsTable)
      .set({ readAt: now })
      .where(
        and(
          eq(patientNotificationsTable.patientId, patientId),
          isNull(patientNotificationsTable.readAt)
        )
      );
  }

  res.json({ ok: true });
});

export default router;
