import fs from "node:fs/promises";
import path from "node:path";
import { db, teamMembersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { objectStorageClient } from "../src/lib/objectStorage.js";
import { setObjectAclPolicy } from "../src/lib/objectAcl.js";
import { DEFAULT_TEAM_MEMBERS } from "../src/lib/teamMembers.js";

const workspaceRoot = process.env.INIT_CWD ?? process.cwd();
const privateObjectDir = process.env.PRIVATE_OBJECT_DIR ?? "";

if (!privateObjectDir) {
  throw new Error("PRIVATE_OBJECT_DIR is required to seed team photos");
}

const [bucketName, ...privatePathParts] = privateObjectDir.replace(/^\//, "").split("/");
if (!bucketName) throw new Error("Invalid PRIVATE_OBJECT_DIR");
const privatePrefix = privatePathParts.join("/").replace(/\/$/, "");

const photos = [
  { slug: "abdullah-osman-koroma", source: "artifacts/mobicare-gateway/public/team-abdullah.jpg" },
  { slug: "fuad-ramadan-sesay", source: "artifacts/mobicare-gateway/public/team-fuad.jpg" },
  { slug: "alhaji-samura", source: "artifacts/mobicare-gateway/public/team-alhaji.jpg" },
  { slug: "alpha-aziz-jalloh", source: "artifacts/mobicare-gateway/public/team-alpha.jpg" },
  { slug: "mamie-saio-johnson", source: "attached_assets/images_(3)_1787066235337.jfif" },
] as const;

async function main() {
  for (const member of DEFAULT_TEAM_MEMBERS) {
    await db
      .insert(teamMembersTable)
      .values(member)
      .onConflictDoNothing({ target: teamMembersTable.slug });
  }

  for (const photo of photos) {
    const bytes = await fs.readFile(path.resolve(workspaceRoot, photo.source));
    const objectName = `${privatePrefix ? `${privatePrefix}/` : ""}team-photos/${photo.slug}.jpg`;
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.save(bytes, {
      contentType: "image/jpeg",
      resumable: false,
      metadata: { cacheControl: "public, max-age=86400" },
    });
    await setObjectAclPolicy(file, { owner: "system", visibility: "public" });
    await db
      .update(teamMembersTable)
      .set({
        photoPath: `/objects/team-photos/${photo.slug}.jpg`,
        updatedAt: new Date(),
      })
      .where(eq(teamMembersTable.slug, photo.slug));
  }

  console.log("Seeded team photos in object storage.");
}

main().catch((error) => {
  console.error("Unable to seed team photos", error);
  process.exit(1);
});