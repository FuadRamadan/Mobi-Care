import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import { patientNotificationsTable, patientsTable } from "@workspace/db/schema";
import { eq, and, isNull, desc, inArray } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";

const router = safeRouter();

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

// ── PUT /patient/notifications/push-token — register/clear device push token ─
router.put("/push-token", async (req: AuthRequest, res) => {
  const patientId = req.pharmacy!.sub;
  const body = z
    .object({ expoPushToken: z.string().min(1).max(200).nullable() })
    .safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "expoPushToken must be a non-empty string or null" });
    return;
  }

  await db
    .update(patientsTable)
    .set({ expoPushToken: body.data.expoPushToken, updatedAt: new Date() })
    .where(eq(patientsTable.id, patientId));

  res.json({ message: "Push token updated" });
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
