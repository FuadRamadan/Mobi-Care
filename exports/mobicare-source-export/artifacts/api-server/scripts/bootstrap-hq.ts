/**
 * Bootstrap the first HQ staff account — HQ has NO self-registration path.
 *
 * Usage:
 *   HQ_ADMIN_USERNAME=admin HQ_ADMIN_PASSWORD='...' HQ_ADMIN_NAME='Ops Lead' \
 *     pnpm --filter @workspace/api-server exec tsx scripts/bootstrap-hq.ts
 *
 * Idempotent: if the username already exists, it exits without changes.
 */
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { hqStaffTable, auditLogTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const username = process.env.HQ_ADMIN_USERNAME;
  const password = process.env.HQ_ADMIN_PASSWORD;
  const name = process.env.HQ_ADMIN_NAME ?? "HQ Administrator";

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

  if (existing) {
    console.log(`HQ account '${username}' already exists — nothing to do.`);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [created] = await db
    .insert(hqStaffTable)
    .values({ username, name, passwordHash })
    .returning({ id: hqStaffTable.id });

  await db.insert(auditLogTable).values({
    actorType: "system",
    actorName: "bootstrap-hq script",
    action: "hq_staff.bootstrap",
    entityType: "hq_staff",
    entityId: created!.id,
    details: { username, name },
  });

  console.log(`Created HQ account '${username}' (${created!.id}).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
