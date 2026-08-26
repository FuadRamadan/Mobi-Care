import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { hqNotificationsTable } from "@workspace/db/schema";
import { AuthRequest } from "../../middlewares/auth.js";

const router = safeRouter();

router.get("/", async (req: AuthRequest, res): Promise<void> => {
  const hqStaffId = req.pharmacy!.sub;
  const notifications = await db
    .select()
    .from(hqNotificationsTable)
    .where(eq(hqNotificationsTable.hqStaffId, hqStaffId))
    .orderBy(desc(hqNotificationsTable.createdAt))
    .limit(50);

  res.json(notifications);
});

router.get("/unread-count", async (req: AuthRequest, res): Promise<void> => {
  const hqStaffId = req.pharmacy!.sub;
  const [result] = await db
    .select({ count: count() })
    .from(hqNotificationsTable)
    .where(
      and(
        eq(hqNotificationsTable.hqStaffId, hqStaffId),
        isNull(hqNotificationsTable.readAt),
      ),
    );

  res.json({ unreadCount: Number(result?.count ?? 0) });
});

router.post("/mark-read", async (req: AuthRequest, res): Promise<void> => {
  const hqStaffId = req.pharmacy!.sub;
  const body = z
    .object({ ids: z.array(z.string().uuid()).optional() })
    .safeParse(req.body);

  if (!body.success) {
    res
      .status(400)
      .json({ error: "ids must be an array of UUIDs if provided" });
    return;
  }

  const unreadForStaff = and(
    eq(hqNotificationsTable.hqStaffId, hqStaffId),
    isNull(hqNotificationsTable.readAt),
  );

  if (body.data.ids?.length) {
    await db
      .update(hqNotificationsTable)
      .set({ readAt: new Date() })
      .where(
        and(unreadForStaff, inArray(hqNotificationsTable.id, body.data.ids)),
      );
  } else {
    await db
      .update(hqNotificationsTable)
      .set({ readAt: new Date() })
      .where(unreadForStaff);
  }

  res.json({ message: "Marked as read" });
});

export default router;
