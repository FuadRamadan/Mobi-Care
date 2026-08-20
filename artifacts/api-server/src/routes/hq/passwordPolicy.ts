import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { pharmacyPasswordPolicyTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { getOrCreatePasswordPolicy } from "../../lib/passwordPolicy.js";

const router = Router();

// ── GET /hq/password-policy ───────────────────────────────────────────────────
router.get("/", async (_req, res) => {
  const policy = await getOrCreatePasswordPolicy();
  res.json(policy);
});

// ── PATCH /hq/password-policy ─────────────────────────────────────────────────
router.patch("/", async (req: AuthRequest, res) => {
  const body = z.object({
    maxPasswordAgeDays: z.number().int().min(1).max(365).optional(),
    minPasswordLength: z.number().int().min(8).max(128).optional(),
    requireUppercase: z.boolean().optional(),
    requireLowercase: z.boolean().optional(),
    requireNumber: z.boolean().optional(),
    requireSymbol: z.boolean().optional(),
    passwordHistoryCount: z.number().int().min(0).max(24).optional(),
    temporaryPasswordExpiryHours: z.number().int().min(1).max(168).optional(),
  }).safeParse(req.body);

  if (!body.success || Object.keys(body.data).length === 0) {
    res.status(400).json({ error: body.error?.issues[0]?.message ?? "No valid fields provided" });
    return;
  }

  // Ensure singleton exists before updating
  await getOrCreatePasswordPolicy();

  const now = new Date();
  const [updated] = await db
    .update(pharmacyPasswordPolicyTable)
    .set({ ...body.data, updatedAt: now })
    .where(eq(pharmacyPasswordPolicyTable.id, 1))
    .returning();

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "password_policy.update",
    entityType: "password_policy",
    details: { policyId: 1, changes: body.data },
  });

  res.json(updated!);
});

export default router;
