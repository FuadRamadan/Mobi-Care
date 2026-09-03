import { safeRouter } from "../../lib/safeRouter.js";
import { z } from "zod";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db, patientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AuthRequest } from "../../middlewares/auth.js";
import { mintProfileImageToken } from "../../lib/signedUrl.js";
import { objectStorageClient } from "../../lib/objectStorage.js";
import { calculatePatientAge } from "../../lib/patientAge.js";

const router = safeRouter();
const PROFILE_UPLOAD_DIR = path.resolve(process.cwd(), "uploads/profiles");
const DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_BYTES = 5 * 1024 * 1024;
const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function parsePrivateObjectDir(): { bucketName: string; dirPrefix: string } {
  const dir = process.env.PRIVATE_OBJECT_DIR ?? "";
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const parts = dir.replace(/^\//, "").split("/");
  return { bucketName: parts[0]!, dirPrefix: parts.slice(1).join("/") };
}

async function storeProfileImage(image: string): Promise<string> {
  const match = DATA_URL_RE.exec(image);
  if (!match) throw new Error("PROFILE_IMAGE_FORMAT");
  const ext = match[1] === "jpeg" ? "jpg" : match[1]!;
  const buf = Buffer.from(match[2]!, "base64");
  if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) {
    throw new Error("PROFILE_IMAGE_SIZE");
  }
  const filename = `${crypto.randomUUID()}.${ext}`;

  if (process.env.PRIVATE_OBJECT_DIR) {
    const { bucketName, dirPrefix } = parsePrivateObjectDir();
    const objectName = dirPrefix
      ? `${dirPrefix}/profile-uploads/${filename}`
      : `profile-uploads/${filename}`;
    await objectStorageClient
      .bucket(bucketName)
      .file(objectName)
      .save(buf, { contentType: MIME_TYPES[ext], resumable: false });
    return `cloud:/objects/profile-uploads/${filename}`;
  }

  await fs.mkdir(PROFILE_UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(PROFILE_UPLOAD_DIR, filename), buf);
  return `local:${filename}`;
}

function profileResponse(patient: typeof patientsTable.$inferSelect) {
  const signed = patient.profileImageKey
    ? mintProfileImageToken(patient.id)
    : null;
  return {
    id: patient.id,
    name: patient.name,
    phone: patient.phone,
    dateOfBirth: patient.dateOfBirth,
    age: patient.dateOfBirth
      ? calculatePatientAge(patient.dateOfBirth) ?? patient.age
      : patient.age,
    nin: patient.nin,
    address: patient.address,
    email: patient.email,
    nationality: patient.nationality,
    profileImageUrl: signed
      ? `/api/patient-profile-images/${patient.id}?expires=${signed.expiresAt}&sig=${signed.token}`
      : null,
    profileComplete: Boolean(
      patient.address?.trim() &&
        patient.email?.trim() &&
        patient.nationality?.trim(),
    ),
  };
}

router.get("/", async (req: AuthRequest, res) => {
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.id, req.pharmacy!.sub))
    .limit(1);
  if (!patient) {
    res.status(404).json({ error: "Patient profile not found" });
    return;
  }
  res.json(profileResponse(patient));
});

router.patch("/", async (req: AuthRequest, res) => {
  const body = z
    .object({
      name: z.string().trim().min(2).max(120).optional(),
      nin: z.string().trim().max(40).nullable().optional(),
      address: z.string().trim().max(300).nullable().optional(),
      email: z.string().trim().email().max(254).nullable().optional(),
      nationality: z.string().trim().max(80).nullable().optional(),
    })
    .strict()
    .refine((value) => Object.values(value).some((field) => field !== undefined))
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({
      error:
        "Provide at least one valid editable profile field. Date of birth and age cannot be changed.",
    });
    return;
  }
  const values = body.data;
  const [updated] = await db
    .update(patientsTable)
    .set({
      ...(values.name !== undefined ? { name: values.name } : {}),
      ...(values.nin !== undefined ? { nin: values.nin || null } : {}),
      ...(values.address !== undefined ? { address: values.address || null } : {}),
      ...(values.email !== undefined ? { email: values.email || null } : {}),
      ...(values.nationality !== undefined
        ? { nationality: values.nationality || null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(patientsTable.id, req.pharmacy!.sub))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Patient profile not found" });
    return;
  }
  res.json(profileResponse(updated));
});

router.put("/photo", async (req: AuthRequest, res) => {
  const body = z.object({ image: z.string().min(1) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "A profile image is required" });
    return;
  }
  let imageKey: string;
  try {
    imageKey = await storeProfileImage(body.data.image);
  } catch (error) {
    const message =
      error instanceof Error && error.message === "PROFILE_IMAGE_SIZE"
        ? "Profile image must be between 1 byte and 5 MB"
        : "Profile image must be a PNG, JPEG, or WebP image";
    res.status(400).json({ error: message });
    return;
  }
  const [updated] = await db
    .update(patientsTable)
    .set({ profileImageKey: imageKey, updatedAt: new Date() })
    .where(eq(patientsTable.id, req.pharmacy!.sub))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Patient profile not found" });
    return;
  }
  res.json(profileResponse(updated));
});

export default router;