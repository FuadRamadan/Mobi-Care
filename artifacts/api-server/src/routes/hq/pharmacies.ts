import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { pharmaciesTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";

const router = Router();

function publicPharmacy(p: typeof pharmaciesTable.$inferSelect) {
  const { passwordHash: _ph, ...rest } = p;
  return rest;
}

// ── GET /hq/pharmacies ────────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
  const rows = await db.select().from(pharmaciesTable).orderBy(desc(pharmaciesTable.createdAt));
  res.json(rows.map(publicPharmacy));
});

// ── POST /hq/pharmacies — onboard a pharmacy, returns one-time temp password ──
router.post("/", async (req: AuthRequest, res) => {
  const body = z.object({
    name: z.string().min(1),
    username: z.string().min(3).regex(/^[a-z0-9_.-]+$/i, "username may only contain letters, numbers, and _.-"),
    phone: z.string().min(5).optional(),
    address: z.string().optional(),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const [existing] = await db
    .select({ id: pharmaciesTable.id })
    .from(pharmaciesTable)
    .where(eq(pharmaciesTable.username, body.data.username))
    .limit(1);
  if (existing) { res.status(409).json({ error: "Username already taken" }); return; }

  // One-time temp password — returned ONCE in this response, stored only as a hash.
  const tempPassword = crypto.randomBytes(9).toString("base64url");
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const [created] = await db
    .insert(pharmaciesTable)
    .values({
      name: body.data.name,
      username: body.data.username,
      phone: body.data.phone ?? null,
      address: body.data.address ?? null,
      passwordHash,
      mustChangePassword: true,
    })
    .returning();

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "pharmacy.onboard",
    entityType: "pharmacy",
    entityId: created!.id,
    details: { name: created!.name, username: created!.username },
  });

  res.status(201).json({ pharmacy: publicPharmacy(created!), tempPassword });
});

// ── PATCH /hq/pharmacies/:id — licence verification / tier-1 gate / status ────
router.patch("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const body = z.object({
    isActive: z.boolean().optional(),
    controlledSubstanceAuthorized: z.boolean().optional(),
    name: z.string().min(1).optional(),
    phone: z.string().min(5).nullable().optional(),
    address: z.string().nullable().optional(),
  }).safeParse(req.body);

  if (!body.success || Object.keys(body.data).length === 0) {
    res.status(400).json({ error: "No valid fields provided" });
    return;
  }

  const [existing] = await db.select().from(pharmaciesTable)
    .where(eq(pharmaciesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Pharmacy not found" }); return; }

  const [updated] = await db
    .update(pharmaciesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(pharmaciesTable.id, id))
    .returning();

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "pharmacy.update",
    entityType: "pharmacy",
    entityId: id,
    details: { changes: body.data },
  });

  res.json(publicPharmacy(updated!));
});

export default router;
