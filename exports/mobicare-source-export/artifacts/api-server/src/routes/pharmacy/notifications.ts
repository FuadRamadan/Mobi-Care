import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import { eq, and, isNull, count, desc } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";

const router = safeRouter();

// ── List notifications ────────────────────────────────────────────────────────
router.get("/", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;

  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.pharmacyId, pharmacyId))
    .orderBy(desc(notificationsTable.createdAt));

  res.json(rows);
});

// ── Unread count ──────────────────────────────────────────────────────────────
router.get("/unread-count", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;

  const [result] = await db
    .select({ count: count() })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.pharmacyId, pharmacyId),
        isNull(notificationsTable.readAt)
      )
    );

  res.json({ unreadCount: Number(result?.count ?? 0) });
});

// ── Mark as read ──────────────────────────────────────────────────────────────
router.post("/mark-read", async (req: AuthRequest, res) => {
  const pharmacyId = req.pharmacy!.sub;

  const body = z.object({
    ids: z.array(z.string().uuid()).optional(), // omit to mark all as read
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "ids must be an array of UUIDs if provided" });
    return;
  }

  const now = new Date();

  if (body.data.ids && body.data.ids.length > 0) {
    const { inArray } = await import("drizzle-orm");
    await db
      .update(notificationsTable)
      .set({ readAt: now })
      .where(
        and(
          eq(notificationsTable.pharmacyId, pharmacyId),
          isNull(notificationsTable.readAt),
          inArray(notificationsTable.id, body.data.ids)
        )
      );
  } else {
    // Mark all unread as read
    await db
      .update(notificationsTable)
      .set({ readAt: now })
      .where(
        and(
          eq(notificationsTable.pharmacyId, pharmacyId),
          isNull(notificationsTable.readAt)
        )
      );
  }

  res.json({ message: "Marked as read" });
});

export default router;
