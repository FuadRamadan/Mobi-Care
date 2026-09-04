/**
 * Bootstrap the first HQ staff account — HQ has NO self-registration path.
 *
 * Usage:
 *   HQ_ADMIN_USERNAME=admin HQ_ADMIN_PASSWORD='...' HQ_ADMIN_NAME='Ops Lead' \
 *     pnpm --filter @workspace/api-server exec tsx scripts/bootstrap-hq.ts
 *
 * Idempotent: creates the configured admin when missing, or securely
 * synchronizes and reactivates the existing configured account.
 */
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { hqStaffTable, auditLogTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const username = process.env.HQ_ADMIN_USERNAME?.trim();
  const password = process.env.HQ_ADMIN_PASSWORD;
  const name = process.env.HQ_ADMIN_NAME?.trim() || "HQ Administrator";

  if (!username || !password) {
    console.error("HQ_ADMIN_USERNAME and HQ_ADMIN_PASSWORD env vars are required");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("HQ_ADMIN_PASSWORD must be at least 8 characters");
    process.exit(1);
  }

  const [existing] = await db
    .select({ id: hqStaffTable.id })
    .from(hqStaffTable)
    .where(eq(hqStaffTable.username, username))
    .limit(1);

  const passwordHash = await bcrypt.hash(password, 12);
  if (existing) {
    await db
      .update(hqStaffTable)
      .set({
        name,
        passwordHash,
        isActive: true,
        canManageIntegrations: true,
        canManageSettlements: true,
        canViewDataInsights: true,
        updatedAt: new Date(),
      })
      .where(eq(hqStaffTable.id, existing.id));

    await db.insert(auditLogTable).values({
      actorType: "system",
      actorName: "bootstrap-hq script",
      action: "hq_staff.bootstrap_sync",
      entityType: "hq_staff",
      entityId: existing.id,
      details: {
        reactivated: true,
        passwordResetFromSecret: true,
        permissionsSynchronized: true,
      },
    });

    console.log("Configured HQ administrator synchronized and activated.");
    process.exit(0);
  }

  const [created] = await db
    .insert(hqStaffTable)
    .values({
      username,
      name,
      passwordHash,
      isActive: true,
      canManageIntegrations: true,
      canManageSettlements: true,
      canViewDataInsights: true,
    })
    .returning({ id: hqStaffTable.id });

  await db.insert(auditLogTable).values({
    actorType: "system",
    actorName: "bootstrap-hq script",
    action: "hq_staff.bootstrap",
    entityType: "hq_staff",
    entityId: created!.id,
    details: { username, name },
  });

  console.log("Configured HQ administrator created and activated.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
