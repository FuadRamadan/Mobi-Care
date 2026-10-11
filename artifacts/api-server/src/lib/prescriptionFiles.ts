/**
 * Prescription image files: reading them for the pharmacy, and deleting them
 * once the pharmacy has its own copy.
 *
 * A prescription's image_key says where the file is:
 *   "cloud:/objects/uploads/<uuid>.<ext>"   object storage (production)
 *   "local:<uuid>.<ext>"                    local disk (development)
 *
 * The pharmacy downloads the file to its computer. PRESCRIPTION_FILE_KEEP_MS
 * after the FIRST download the file is deleted from storage and
 * file_deleted_at is set. The prescription row is kept: who it was for, which
 * pharmacy reviewed it, what was approved or rejected, and when it was
 * downloaded. Only the image goes.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db, prescriptionsTable } from "@workspace/db";
import { logger } from "./logger.js";
import { ObjectNotFoundError, ObjectStorageService } from "./storage/objectStorage.js";

export const PRESCRIPTION_FILE_KEEP_MS = 15 * 60_000;
const CLEANUP_EVERY_MS = 60_000;

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads/prescriptions");
const FILENAME_RE = /^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i;
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const objectStorage = new ObjectStorageService();

/** The file is not where its key says: never stored, or already deleted. */
export class PrescriptionFileMissing extends Error {}

export interface PrescriptionFile {
  bytes: Buffer;
  contentType: string;
  /** "png", "jpg" or "webp", for naming the downloaded file. */
  extension: string;
}

function parseKey(imageKey: string): { kind: "cloud"; objectPath: string; filename: string } | { kind: "local"; filename: string } {
  if (imageKey.startsWith("cloud:")) {
    const objectPath = imageKey.slice("cloud:".length);
    const filename = objectPath.split("/").pop() ?? "";
    // Defense-in-depth: keys are server-generated, but never follow one that
    // is not a plain uuid.ext inside /objects/uploads/.
    if (!objectPath.startsWith("/objects/uploads/") || !FILENAME_RE.test(filename)) {
      throw new PrescriptionFileMissing("Unrecognised prescription file key");
    }
    return { kind: "cloud", objectPath, filename };
  }
  if (imageKey.startsWith("local:")) {
    const filename = imageKey.slice("local:".length);
    if (!FILENAME_RE.test(filename)) throw new PrescriptionFileMissing("Unrecognised prescription file key");
    return { kind: "local", filename };
  }
  throw new PrescriptionFileMissing("Unrecognised prescription file key");
}

function extensionOf(filename: string): string {
  const ext = path.extname(filename).toLowerCase().slice(1);
  return ext === "jpeg" ? "jpg" : ext;
}

/** The image's bytes. Throws PrescriptionFileMissing when it is not stored. */
export async function readPrescriptionFile(imageKey: string): Promise<PrescriptionFile> {
  const key = parseKey(imageKey);
  const extension = extensionOf(key.filename);
  if (key.kind === "cloud") {
    let file;
    try {
      file = await objectStorage.getObjectEntityFile(key.objectPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) throw new PrescriptionFileMissing("Prescription file not found in storage");
      throw error;
    }
    const response = await objectStorage.downloadObject(file, 0);
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("Content-Type") ?? CONTENT_TYPES[`.${extension}`] ?? "application/octet-stream",
      extension,
    };
  }
  try {
    return {
      bytes: await fs.readFile(path.join(UPLOAD_DIR, key.filename)),
      contentType: CONTENT_TYPES[path.extname(key.filename).toLowerCase()] ?? "application/octet-stream",
      extension,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new PrescriptionFileMissing("Prescription file not found");
    throw error;
  }
}

/** Delete the stored image. A file that is already gone counts as deleted. */
export async function deletePrescriptionFile(imageKey: string): Promise<void> {
  let key;
  try {
    key = parseKey(imageKey);
  } catch {
    return;
  }
  if (key.kind === "cloud") {
    try {
      await objectStorage.deleteObjectEntity(key.objectPath);
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;
    }
    return;
  }
  await fs.unlink(path.join(UPLOAD_DIR, key.filename)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

/** When a file downloaded at `downloadedAt` is deleted. */
export function fileDeletesAt(downloadedAt: Date | null): Date | null {
  return downloadedAt ? new Date(downloadedAt.getTime() + PRESCRIPTION_FILE_KEEP_MS) : null;
}

/** The download/deletion state, as the pharmacy portal shows it. */
export function fileState(row: { downloadedAt: Date | null; fileDeletedAt: Date | null }) {
  return {
    downloadedAt: row.downloadedAt?.toISOString() ?? null,
    fileDeletesAt: fileDeletesAt(row.downloadedAt)?.toISOString() ?? null,
    fileDeletedAt: row.fileDeletedAt?.toISOString() ?? null,
  };
}

/**
 * Delete every file whose time is up. Each file is deleted before its row is
 * marked, so a failure leaves it to be tried again on the next run. Returns
 * how many were deleted.
 */
export async function deleteExpiredPrescriptionFiles(now: Date = new Date()): Promise<number> {
  const due = await db
    .select({ id: prescriptionsTable.id, imageKey: prescriptionsTable.imageKey })
    .from(prescriptionsTable)
    .where(
      and(
        isNotNull(prescriptionsTable.downloadedAt),
        isNull(prescriptionsTable.fileDeletedAt),
        lte(prescriptionsTable.downloadedAt, new Date(now.getTime() - PRESCRIPTION_FILE_KEEP_MS)),
      ),
    )
    .limit(100);

  let deleted = 0;
  for (const row of due) {
    try {
      await deletePrescriptionFile(row.imageKey);
      await db
        .update(prescriptionsTable)
        .set({ fileDeletedAt: new Date() })
        .where(and(eq(prescriptionsTable.id, row.id), isNull(prescriptionsTable.fileDeletedAt)));
      deleted += 1;
    } catch (err) {
      logger.error({ err, prescriptionId: row.id }, "Could not delete a downloaded prescription file; will retry");
    }
  }
  if (deleted > 0) logger.info({ deleted }, "Deleted downloaded prescription files");
  return deleted;
}

let timer: NodeJS.Timeout | null = null;

export function startPrescriptionFileCleanup(): void {
  const run = () =>
    void deleteExpiredPrescriptionFiles().catch((err) => logger.error({ err }, "Prescription file clean-up failed"));
  run();
  timer = setInterval(run, CLEANUP_EVERY_MS);
  timer.unref();
}

export function stopPrescriptionFileCleanup(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
