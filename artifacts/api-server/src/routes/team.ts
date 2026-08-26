import { safeRouter } from "../lib/safeRouter.js";
import { asc, eq } from "drizzle-orm";
import { db, teamMembersTable } from "@workspace/db";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage.js";
import { ensureTeamMembers } from "../lib/teamMembers.js";

const router = safeRouter();
const objectStorage = new ObjectStorageService();

function photoUrl(member: typeof teamMembersTable.$inferSelect): string | null {
  if (!member.photoPath) return null;
  return `/api/team/${member.id}/photo?v=${member.updatedAt.getTime()}`;
}

async function pipeObjectToResponse(
  objectPath: string,
  res: import("express").Response,
): Promise<void> {
  const file = await objectStorage.getObjectEntityFile(objectPath);
  const objectResponse = await objectStorage.downloadObject(file, 86_400);
  res.setHeader(
    "Content-Type",
    objectResponse.headers.get("Content-Type") ?? "image/jpeg",
  );
  res.setHeader(
    "Cache-Control",
    objectResponse.headers.get("Cache-Control") ?? "public, max-age=86400",
  );

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

// ── GET /team — public roster used by the About page ───────────────────────
router.get("/", async (_req, res) => {
  await ensureTeamMembers();
  const members = await db
    .select()
    .from(teamMembersTable)
    .orderBy(asc(teamMembersTable.sortOrder));

  res.json(
    members.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      photoUrl: photoUrl(member),
    })),
  );
});

// ── GET /team/:id/photo — public, storage-backed portrait ─────────────────
router.get("/:id/photo", async (req, res) => {
  const [member] = await db
    .select({ photoPath: teamMembersTable.photoPath })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.id, req.params.id as string))
    .limit(1);

  if (!member?.photoPath) {
    res.status(404).json({ error: "Team photo not found" });
    return;
  }

  try {
    await pipeObjectToResponse(member.photoPath, res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError && !res.headersSent) {
      res.status(404).json({ error: "Team photo not found" });
      return;
    }
    throw error;
  }
});

export default router;
