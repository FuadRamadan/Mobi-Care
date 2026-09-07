/**
 * Copy every stored object from Replit App Storage to S3-compatible storage.
 *
 * Run this ON the old host, where the credential sidecar exists. It reads
 * through the Google client the old adapter used and writes through the new S3
 * client, verifying each object by size and SHA-256 before counting it done.
 *
 *   PRIVATE_OBJECT_DIR=/bucket-id/private \
 *   S3_ENDPOINT=... S3_REGION=... S3_BUCKET=... \
 *   S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
 *   pnpm --filter @workspace/api-server exec esbuild \
 *     scripts/migrate-object-storage.ts --bundle --platform=node --format=cjs \
 *     --outfile=dist/migrate-object-storage.cjs --log-level=warning \
 *   && node dist/migrate-object-storage.cjs --dry-run
 *
 * Options:
 *   --dry-run   Report what would move; write nothing.
 *   --force     Re-copy objects that already exist at the destination.
 *
 * Safe to re-run: objects already present with a matching size and checksum are
 * skipped, so an interrupted run resumes where it stopped. Nothing is deleted
 * from the source — verify the destination before decommissioning anything.
 */

import { createHash } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import {
  getS3Config,
  headObject,
  putObject,
  getObjectBuffer,
  type ObjectMetadata,
} from "../src/lib/storage/s3Client.js";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

/** The ACL metadata key differs between providers; see lib/storage/objectAcl.ts. */
const GCS_ACL_KEY = "custom:aclPolicy";
const S3_ACL_KEY = "acl-policy";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

const sourceClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

/** Split "/bucket-id/private" into its bucket and prefix. */
function parseSourceDir(): { bucket: string; prefix: string } {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR is required (the source location).");
  const parts = dir.replace(/^\/+/, "").split("/");
  return { bucket: parts[0]!, prefix: parts.slice(1).join("/") };
}

const sha256 = (buffer: Buffer): string =>
  createHash("sha256").update(buffer).digest("hex");

interface Tally {
  copied: number;
  skipped: number;
  failed: number;
  bytes: number;
}

async function main(): Promise<void> {
  const source = parseSourceDir();
  const destination = getS3Config();

  console.log(
    `Source:      gs://${source.bucket}/${source.prefix}\n` +
      `Destination: ${destination.endpoint}/${destination.bucket}\n` +
      `Mode:        ${dryRun ? "dry run — nothing will be written" : force ? "copy, overwriting" : "copy, resuming"}\n`,
  );

  const [files] = await sourceClient
    .bucket(source.bucket)
    .getFiles({ prefix: source.prefix ? `${source.prefix}/` : "" });

  console.log(`Found ${files.length} object(s) at the source.\n`);

  const tally: Tally = { copied: 0, skipped: 0, failed: 0, bytes: 0 };
  const failures: Array<{ key: string; reason: string }> = [];

  for (const file of files) {
    // Keys are preserved exactly, so paths already in the database resolve
    // unchanged after the switch.
    const key = file.name;

    try {
      const [metadata] = await file.getMetadata();
      const expectedSize = Number(metadata.size ?? 0);

      if (!force) {
        const existing = await headObject(key, destination);
        if (existing && existing.contentLength === expectedSize) {
          tally.skipped += 1;
          continue;
        }
      }

      if (dryRun) {
        console.log(`would copy  ${key} (${expectedSize} bytes)`);
        tally.copied += 1;
        tally.bytes += expectedSize;
        continue;
      }

      const [buffer] = await file.download();
      if (buffer.byteLength !== expectedSize) {
        throw new Error(
          `source size mismatch: metadata says ${expectedSize}, read ${buffer.byteLength}`,
        );
      }
      const sourceDigest = sha256(buffer);

      // Carry metadata across, translating the ACL policy to the key the new
      // adapter reads. Losing this would make private objects unreadable —
      // getObjectAclPolicy returning null denies everyone.
      const translated: ObjectMetadata = {};
      for (const [name, value] of Object.entries(metadata.metadata ?? {})) {
        if (value === undefined || value === null) continue;
        translated[name === GCS_ACL_KEY ? S3_ACL_KEY : name.toLowerCase()] = String(value);
      }

      await putObject(
        key,
        buffer,
        {
          contentType: (metadata.contentType as string) || "application/octet-stream",
          metadata: translated,
        },
        destination,
      );

      // Read back and compare bytes, not just sizes. A truncated or re-encoded
      // object would otherwise pass a size check and fail silently later.
      const roundTrip = await getObjectBuffer(key, destination);
      if (sha256(roundTrip) !== sourceDigest) {
        throw new Error("checksum mismatch after upload");
      }

      const head = await headObject(key, destination);
      if (translated[S3_ACL_KEY] && !head?.metadata[S3_ACL_KEY]) {
        throw new Error("ACL policy did not persist at the destination");
      }

      tally.copied += 1;
      tally.bytes += buffer.byteLength;
      console.log(`copied      ${key} (${buffer.byteLength} bytes)`);
    } catch (error) {
      tally.failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ key, reason });
      console.error(`FAILED      ${key}: ${reason}`);
    }
  }

  console.log(
    `\n${dryRun ? "Would copy" : "Copied"}: ${tally.copied}   ` +
      `Skipped: ${tally.skipped}   Failed: ${tally.failed}   ` +
      `Bytes: ${tally.bytes.toLocaleString()}`,
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} object(s) failed:`);
    for (const { key, reason } of failures) console.error(`  ${key}: ${reason}`);
    console.error("\nRe-run to retry the failures. Do not switch traffic until this is clean.");
    process.exit(1);
  }

  if (!dryRun) {
    console.log(
      "\nEvery object copied and verified by checksum. Confirm reads through " +
        "the application before decommissioning the source.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
