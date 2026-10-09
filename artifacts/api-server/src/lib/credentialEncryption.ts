import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";

function keyFrom(secret: string): Buffer {
  return createHash("sha256")
    .update("mobicare-provider-credentials:")
    .update(secret)
    .digest();
}

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required to protect provider credentials");
  }
  return keyFrom(secret);
}

/**
 * The key from before a rotation, set as SESSION_SECRET_PREVIOUS only while
 * stored credentials are moved to the new key (see reencryptIfPrevious).
 */
function previousKey(): Buffer | null {
  const secret = process.env.SESSION_SECRET_PREVIOUS;
  return secret ? keyFrom(secret) : null;
}

export function encryptCredential(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptCredential(payload: string): string {
  try {
    return decryptWith(encryptionKey(), payload);
  } catch (error) {
    const previous = previousKey();
    if (!previous) throw error;
    return decryptWith(previous, payload);
  }
}

/**
 * For a value stored under SESSION_SECRET_PREVIOUS, the same value encrypted
 * under the current SESSION_SECRET; null when it already uses the current key
 * (or no previous key is set). Used once at startup after a rotation.
 */
export function reencryptIfPrevious(payload: string): string | null {
  const previous = previousKey();
  if (!previous) return null;
  try {
    decryptWith(encryptionKey(), payload);
    return null;
  } catch {
    return encryptCredential(decryptWith(previous, payload));
  }
}

function decryptWith(key: Buffer, payload: string): string {
  const [version, ivEncoded, tagEncoded, encryptedEncoded] = payload.split(".");
  if (
    version !== VERSION ||
    !ivEncoded ||
    !tagEncoded ||
    !encryptedEncoded
  ) {
    throw new Error("Unsupported encrypted credential format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}